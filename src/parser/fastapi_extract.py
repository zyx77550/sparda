import sys
import os
import ast
import json

class RouteSpecExtractor:
    def __init__(self, entry_file, project_root):
        self.entry_file = os.path.abspath(entry_file)
        self.project_root = os.path.abspath(project_root)
        self.routes = []
        self.skipped = []
        self.visited = set()
        # Maps absolute file paths to a dict of locally defined Pydantic models
        # model_name -> {field_name: {type, required}}
        self.models = {}
        # mounts: list of tuples (parent_prefix, file_path, router_var_name)
        self.mounts = []
        self.entry_app_vars = []


    def get_rel_path(self, abs_path):
        return os.path.relpath(abs_path, self.project_root).replace(os.path.sep, '/')

    def clean_docstring(self, doc):
        if not doc:
            return ""
        lines = [line.strip() for line in doc.splitlines()]
        return " ".join([l for l in lines[:3] if l]).strip()

    def _is_depends(self, default_node):
        """Returns True if the default value is a Depends(...) call."""
        return (
            isinstance(default_node, ast.Call) and
            ((isinstance(default_node.func, ast.Name) and default_node.func.id == 'Depends') or
             (isinstance(default_node.func, ast.Attribute) and default_node.func.attr == 'Depends'))
        )

    def _collect_all_imports(self, start_file):
        to_visit = [start_file]
        collected = set()
        visited_imports = set()
        
        while to_visit:
            curr = to_visit.pop(0)
            if curr in visited_imports:
                continue
            visited_imports.add(curr)
            
            if not os.path.exists(curr):
                continue
            
            try:
                with open(curr, 'r', encoding='utf-8') as f:
                    src = f.read()
                tree = ast.parse(src, filename=curr)
            except:
                continue
                
            for node in ast.walk(tree):
                resolved = None
                if isinstance(node, ast.ImportFrom):
                    dots = '.' * node.level if node.level > 0 else ''
                    module_with_dots = f"{dots}{node.module}" if node.module else dots
                    
                    for name_node in node.names:
                        if node.module:
                            full_mod = f"{module_with_dots}.{name_node.name}"
                        else:
                            full_mod = f"{module_with_dots}{name_node.name}"
                        resolved = self.resolve_import(curr, full_mod)
                        if resolved and resolved not in collected:
                            collected.add(resolved)
                            to_visit.append(resolved)
                    
                    resolved = self.resolve_import(curr, module_with_dots)
                    if resolved and resolved not in collected:
                        collected.add(resolved)
                        to_visit.append(resolved)
                        
                elif isinstance(node, ast.Import):
                    for name_node in node.names:
                        resolved = self.resolve_import(curr, name_node.name)
                        if resolved and resolved not in collected:
                            collected.add(resolved)
                            to_visit.append(resolved)
                            
        return collected

    def preload_models(self):
        """Pre-scan all reachable files for Pydantic models before route extraction."""
        for abs_path in self._collect_all_imports(self.entry_file):
            if abs_path not in self.models:
                try:
                    with open(abs_path, 'r', encoding='utf-8') as f:
                        src = f.read()
                    tree = ast.parse(src, filename=abs_path)
                    self.extract_pydantic_models(tree, abs_path)
                except:
                    pass

    def resolve_import(self, from_file, module_name):
        if not module_name:
            return None
        parts = module_name.split('.')
        
        # Relative import (starts with .)
        if module_name.startswith('.'):
            dots = 0
            for char in module_name:
                if char == '.':
                    dots += 1
                else:
                    break
            clean_module = module_name[dots:]
            base_dir = os.path.dirname(from_file)
            for _ in range(dots - 1):
                base_dir = os.path.dirname(base_dir)
            parts = clean_module.split('.') if clean_module else []
            cand = os.path.join(base_dir, *parts)
        else:
            # Try project-level absolute import
            cand = os.path.join(self.project_root, *parts)
            if not (os.path.isfile(cand + '.py') or os.path.isdir(cand)):
                # Fallback to local import relative to file dir
                cand = os.path.join(os.path.dirname(from_file), *parts)

        # Check file or __init__.py package
        for p in [cand + '.py', os.path.join(cand, '__init__.py')]:
            if os.path.isfile(p):
                return os.path.abspath(p)
        return None

    def get_lit_value(self, node):
        if isinstance(node, ast.Constant):
            return node.value
        # Compatibility with older python versions
        elif isinstance(node, ast.Str):
            return node.s
        return None

    def parse_type_annotation(self, node):
        """Returns (type_str, required_bool)"""
        if node is None:
            return ('string', False)
        
        # Simple Name: int, str, float, bool
        if isinstance(node, ast.Name):
            t_map = {'str': 'string', 'int': 'integer', 'float': 'number', 'bool': 'boolean'}
            return (t_map.get(node.id, node.id), True)
            
        # typing.Optional[X] or Union[X, None] or Attribute types
        if isinstance(node, ast.Subscript):
            # Optional[X] or Union[X, None]
            value_id = ""
            if isinstance(node.value, ast.Name):
                value_id = node.value.id
            elif isinstance(node.value, ast.Attribute):
                value_id = node.value.attr
                
            if value_id in ('Optional', 'Union'):
                # Under Python 3.9+, slice is the index node. Older versions wrapped in Index node.
                slice_node = node.slice
                if isinstance(slice_node, ast.Index):
                    slice_node = slice_node.value
                
                # If Union, we might have multiple types (e.g. Union[str, int, None])
                if isinstance(slice_node, ast.Tuple):
                    types = [self.parse_type_annotation(el) for el in slice_node.elts]
                    # Find first non-None type
                    non_none = [t for t in types if t[0] != 'None']
                    if non_none:
                        return (non_none[0][0], False)
                else:
                    sub_type, _ = self.parse_type_annotation(slice_node)
                    return (sub_type, False)
                    
        # Python 3.10+ Union Type: X | None
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.BitOr):
            left_type, left_req = self.parse_type_annotation(node.left)
            right_type, right_req = self.parse_type_annotation(node.right)
            if left_type == 'None':
                return (right_type, False)
            if right_type == 'None':
                return (left_type, False)
            return (left_type, left_req)

        # None constant
        if isinstance(node, ast.Constant) and node.value is None:
            return ('None', False)

        return ('string', True)

    def extract_pydantic_models(self, tree, abs_file):
        file_models = {}
        for node in tree.body:
            if isinstance(node, ast.ClassDef):
                is_pydantic = False
                for base in node.bases:
                    if isinstance(base, ast.Name) and base.id == 'BaseModel':
                        is_pydantic = True
                    elif isinstance(base, ast.Attribute) and base.attr == 'BaseModel':
                        is_pydantic = True
                if is_pydantic:
                    fields = {}
                    for item in node.body:
                        if isinstance(item, ast.AnnAssign) and isinstance(item.target, ast.Name):
                            field_name = item.target.id
                            field_type, required = self.parse_type_annotation(item.annotation)
                            # Check if it has default value (not required)
                            if item.value is not None:
                                required = False
                            fields[field_name] = {'type': field_type, 'required': required}
                    file_models[node.name] = fields
        self.models[abs_file] = file_models

    def parse_file(self, abs_file, prefix='', depth=0):
        if depth > 2 or abs_file in self.visited:
            return
        self.visited.add(abs_file)

        if not os.path.exists(abs_file):
            return

        try:
            with open(abs_file, 'r', encoding='utf-8') as f:
                src = f.read()
            tree = ast.parse(src, filename=abs_file)
        except Exception as e:
            self.skipped.append({
                'reason': f"Parse error: {str(e)}",
                'file': self.get_rel_path(abs_file)
            })
            return

        # 1. Pre-scan for Pydantic Models in this file
        self.extract_pydantic_models(tree, abs_file)

        # Trace local variables
        app_vars = set()
        router_vars = set()
        # Maps local variable names to resolved file paths
        import_map = {}
        # Maps router variable names to their defined prefix in APIRouter(prefix="/...")
        router_prefixes = {}

        # 2. Trace imports & assignments
        for node in tree.body:
            # from x import y
            if isinstance(node, ast.ImportFrom):
                dots = '.' * node.level if node.level > 0 else ''
                module_with_dots = f"{dots}{node.module}" if node.module else dots
                
                for name_node in node.names:
                    local_name = name_node.asname or name_node.name
                    
                    if node.module:
                        full_mod = f"{module_with_dots}.{name_node.name}"
                    else:
                        full_mod = f"{module_with_dots}{name_node.name}"
                        
                    resolved = self.resolve_import(abs_file, full_mod)
                    if not resolved:
                        resolved = self.resolve_import(abs_file, module_with_dots)
                        
                    if resolved:
                        import_map[local_name] = resolved

            # import x
            elif isinstance(node, ast.Import):
                for name_node in node.names:
                    resolved = self.resolve_import(abs_file, name_node.name)
                    if resolved:
                        local_name = name_node.asname or name_node.name
                        import_map[local_name] = resolved

            # assignments: app = FastAPI() / router = APIRouter()
            elif isinstance(node, ast.Assign):
                if len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
                    var_name = node.targets[0].id
                    if isinstance(node.value, ast.Call):
                        call_func = node.value.func
                        call_name = ""
                        if isinstance(call_func, ast.Name):
                            call_name = call_func.id
                        elif isinstance(call_func, ast.Attribute):
                            call_name = call_func.attr

                        if call_name == 'FastAPI':
                            app_vars.add(var_name)
                        elif call_name == 'APIRouter':
                            router_vars.add(var_name)
                            # Extract APIRouter prefix keyword arg
                            r_prefix = ""
                            for kw in node.value.keywords:
                                if kw.arg == 'prefix':
                                    val = self.get_lit_value(kw.value)
                                    if val is not None:
                                        r_prefix = val
                            router_prefixes[var_name] = r_prefix

        # 3. Trace routes and mounts
        for node in tree.body:
            # app.include_router(router, prefix="/api")
            if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call):
                call = node.value
                if isinstance(call.func, ast.Attribute) and call.func.attr == 'include_router':
                    # First arg is the router variable (can be ast.Name or ast.Attribute like users.router)
                    if len(call.args) >= 1:
                        arg0 = call.args[0]
                        router_name = None
                        is_attribute = False
                        if isinstance(arg0, ast.Name):
                            router_name = arg0.id
                        elif isinstance(arg0, ast.Attribute) and isinstance(arg0.value, ast.Name):
                            router_name = arg0.value.id
                            is_attribute = True
                            
                        if router_name:
                            mount_prefix = ""
                            for kw in call.keywords:
                                if kw.arg == 'prefix':
                                    val = self.get_lit_value(kw.value)
                                    if val is not None:
                                        mount_prefix = val
                            
                            resolved_file = import_map.get(router_name)
                            # Reconstruct cumulative prefix
                            # parent prefix + mount prefix
                            cum_prefix = (prefix + mount_prefix).replace('//', '/')
                            if resolved_file:
                                # If it was users.router, we mount the resolved file with the module's router name
                                self.mounts.append((cum_prefix, resolved_file, router_name))
                            else:
                                # If it's a locally defined router
                                if not is_attribute and router_name in router_vars:
                                    local_r_prefix = router_prefixes.get(router_name, "")
                                    self.mounts.append((cum_prefix + local_r_prefix, abs_file, router_name))
                                else:
                                    self.skipped.append({
                                        'reason': f"Router '{router_name}' source file not resolved",
                                        'file': self.get_rel_path(abs_file),
                                        'line': node.lineno
                                    })

            # FunctionDef decorated with app/router decorators
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                for dec in node.decorator_list:
                    if isinstance(dec, ast.Call) and isinstance(dec.func, ast.Attribute):
                        obj_node = dec.func.value
                        method = dec.func.attr
                        
                        if method in ('get', 'post', 'put', 'patch', 'delete', 'options', 'head'):
                            obj_name = ""
                            if isinstance(obj_node, ast.Name):
                                obj_name = obj_node.id
                                
                            is_app = obj_name in app_vars
                            is_router = obj_name in router_vars
                            
                            if is_app or is_router:
                                # Extract path
                                if len(dec.args) >= 1:
                                    raw_path = self.get_lit_value(dec.args[0])
                                    if raw_path is None:
                                        self.skipped.append({
                                            'reason': f"dynamic path on {method.upper()} (non-literal first arg)",
                                            'file': self.get_rel_path(abs_file),
                                            'line': node.lineno
                                        })
                                        continue
                                    
                                    # Cumulative prefix path
                                    local_r_prefix = router_prefixes.get(obj_name, "") if is_router else ""
                                    full_path = (prefix + local_r_prefix + raw_path).replace('//', '/')
                                    if not full_path.startswith('/'):
                                        full_path = '/' + full_path

                                    # Anti-loop skip
                                    if full_path == '/mcp' or full_path.startswith('/mcp/'):
                                        self.skipped.append({
                                            'reason': f"self-referential path {full_path} blocked",
                                            'file': self.get_rel_path(abs_file),
                                            'line': node.lineno
                                        })
                                        continue

                                    # Extract description from docstring
                                    raw_doc = ast.get_docstring(node)
                                    doc = self.clean_docstring(raw_doc)

                                    # Parse signature parameters
                                    params = []
                                    mutating = method != 'get'
                                    confidence = 'high'
                                    body_properties = {}
                                    body_required = []

                                    # Path params extracted from the path
                                    path_param_names = set()
                                    import re
                                    for m in re.finditer(r'\{(\w+)\}', full_path):
                                        p_name = m.group(1)
                                        path_param_names.add(p_name)
                                        params.append({
                                            'name': p_name,
                                            'in': 'path',
                                            'type': 'string', # will be refined if found in signature
                                            'required': True,
                                            'description': 'path parameter'
                                        })

                                    # Match args signature to type annotations
                                    # we also check arg defaults to determine if required
                                    defaults_start_idx = len(node.args.args) - len(node.args.defaults)
                                    for idx, arg in enumerate(node.args.args):
                                        arg_name = arg.arg
                                        # Skip self/request parameters
                                        if arg_name in ('self', 'request'):
                                            continue
                                            
                                        # Check if it has a default value
                                        has_default = idx >= defaults_start_idx
                                        if has_default:
                                            default_val = node.args.defaults[idx - defaults_start_idx]
                                            if self._is_depends(default_val):
                                                continue
                                        
                                        # Parse type annotation
                                        arg_type, type_req = self.parse_type_annotation(arg.annotation)
                                        required = type_req and (not has_default)

                                        # If it's a path param, update its type
                                        is_path_param = False
                                        for p in params:
                                            if p['name'] == arg_name and p['in'] == 'path':
                                                p['type'] = arg_type
                                                is_path_param = True
                                                break
                                        
                                        if is_path_param:
                                            continue

                                        # Check if arg_type refers to a scannable Pydantic model
                                        # We scan all visited files models
                                        matched_model = None
                                        for f_path, f_models in self.models.items():
                                            if arg_type in f_models:
                                                matched_model = f_models[arg_type]
                                                break

                                        if matched_model is not None:
                                            # It's a Pydantic body parameter
                                            for f_name, f_spec in matched_model.items():
                                                body_properties[f_name] = {'type': f_spec['type']}
                                                if f_spec['required']:
                                                    body_properties[f_name]['required'] = True
                                                    body_required.append(f_name)
                                        else:
                                            # Query parameter
                                            params.append({
                                                'name': arg_name,
                                                'in': 'query',
                                                'type': arg_type,
                                                'required': required,
                                                'description': 'query parameter'
                                            })

                                    if mutating:
                                        if body_properties:
                                            params.append({
                                                'name': 'body',
                                                'in': 'body',
                                                'type': 'object',
                                                'required': True,
                                                'properties': body_properties
                                            })
                                        else:
                                            # Fallback body
                                            params.append({
                                                'name': 'body',
                                                'in': 'body',
                                                'type': 'object',
                                                'required': False,
                                                'description': 'JSON body — schema not statically detected'
                                            })
                                            confidence = 'low'

                                    self.routes.append({
                                        'method': method,
                                        'path': full_path,
                                        'handlerName': node.name,
                                        'sourceFile': self.get_rel_path(abs_file),
                                        'sourceLine': node.lineno,
                                        'params': params,
                                        'description': doc,
                                        'mutating': mutating,
                                        'confidence': confidence
                                    })
        if depth == 0:
            self.entry_app_vars = list(app_vars)

    def run(self):
        # Pre-load Pydantic models from all imported files
        self.preload_models()
        
        # 1st pass: parse entry file
        self.parse_file(self.entry_file, '', 0)

        # 2nd pass: parse mounted routers
        for prefix, file_path, router_name in list(self.mounts):
            self.parse_file(file_path, prefix, 1)

        # Deduplicate routes
        seen = set()
        deduped = []
        for r in self.routes:
            key = f"{r['method']} {r['path']}"
            if key not in seen:
                seen.add(key)
                deduped.append(r)
        
        return {
            'routes': deduped,
            'skipped': self.skipped,
            'entryAppVars': getattr(self, 'entry_app_vars', [])
        }

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print(json.dumps({'error': 'Usage: python fastapi_extract.py <entry_file> <project_root>'}))
        sys.exit(1)

    entry = sys.argv[1]
    root = sys.argv[2]
    
    try:
        extractor = RouteSpecExtractor(entry, root)
        result = extractor.run()
        print(json.dumps(result))
    except Exception as e:
        import traceback
        print(json.dumps({'error': f"Internal extractor error: {str(e)}\n{traceback.format_exc()}"}))
        sys.exit(1)
