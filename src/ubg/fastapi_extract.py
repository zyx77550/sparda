# ubg/fastapi_extract.py — Python side of the UBG FastAPI lowering.
# Emits the same route facts the JS extractors produce, except each chain step
# and helper carries a PRE-COMPUTED scan (effects, returnShapes, calls,
# guardSignals, async) shaped exactly like extract.js#scanFunction output —
# the translator consumes scans, so Python functions enter the graph without
# babel ever seeing them. Stdlib only (ast, json, os, re, sys), deterministic:
# ast walk order is source order, output is json.dumps(sort_keys=True).
import ast
import json
import os
import re
import sys

MAX_EFFECTS = 40
MAX_RETURN_SHAPES = 10
MAX_CALLS = 30
# ADR-054: the resolve.js contract — one bound for every interprocedural hop kind.
# fastapi_extract.py cannot import the JS engine (separate process, stdlib only),
# so it implements the engine's CONTRACT: depth <= MAX_RESOLVE_DEPTH, memoization
# per (file, qualname), cycle guard by stack set, mergeScan merge semantics,
# deterministic ordering. Divergence from resolve.js is a bug, not a judgment call.
MAX_RESOLVE_DEPTH = 6
HTTP_VERBS = ("get", "post", "put", "patch", "delete")
HTTP_CLIENTS = ("requests", "httpx", "aiohttp")
SUPABASE_OPS = ("select", "insert", "update", "upsert", "delete")
FS_WRITE = ("remove", "unlink", "rmtree", "rename", "makedirs", "mkdir",
            "write_text", "write_bytes")
FS_READ = ("read_text", "read_bytes", "listdir", "stat", "exists")
SQL_VERBS = {
    "select": ("db_read", "select"),
    "insert": ("db_write", "insert"),
    "update": ("db_write", "update"),
    "delete": ("db_write", "delete"),
    "upsert": ("db_write", "upsert"),
}


def lit(node):
    if isinstance(node, ast.Constant):
        return node.value
    return None


def root_name(node):
    cur = node
    while isinstance(cur, ast.Attribute):
        cur = cur.value
    if isinstance(cur, ast.Name):
        return cur.id
    return None


def dotted_name(node):
    """self.db.session → 'self.db.session' (Names/Attributes only, else None)."""
    parts = []
    cur = node
    while isinstance(cur, ast.Attribute):
        parts.append(cur.attr)
        cur = cur.value
    if isinstance(cur, ast.Name):
        parts.append(cur.id)
        return ".".join(reversed(parts))
    return None


def merge_scan(into, add):
    """resolve.js#mergeScan, same contract — bounded by the same caps as
    scan_function itself so a deep bundle can never blow the scan shape up."""
    for e in add["effects"]:
        if len(into["effects"]) >= MAX_EFFECTS:
            break
        into["effects"].append(e)
    for r in add["returnShapes"]:
        if len(into["returnShapes"]) >= MAX_RETURN_SHAPES:
            break
        into["returnShapes"].append(r)
    for c in add["calls"]:
        if len(into["calls"]) >= MAX_CALLS:
            break
        into["calls"].append(c)
    into["validatesInput"] = into["validatesInput"] or add["validatesInput"]
    into["async"] = into["async"] or add["async"]
    if add["guardSignals"]["deniesWithStatus"]:
        into["guardSignals"]["deniesWithStatus"] = True


def clone_scan(base):
    return {
        "effects": list(base["effects"]),
        "returnShapes": list(base["returnShapes"]),
        "calls": list(base["calls"]),
        "guardSignals": dict(base["guardSignals"]),
        "validatesInput": base["validatesInput"],
        "async": base["async"],
    }


def literal_pairs_of(clause):
    """"status = 'paid', x = 3" -> {status: paid} — string literals only."""
    pairs = {}
    for m in re.finditer(r"([\w\"]+)\s*=\s*'([^']*)'", clause):
        if len(pairs) >= 8:
            break
        pairs[m.group(1).replace('"', "")] = m.group(2)
    return pairs


def parse_sql(sql):
    s = sql.strip().lower()
    verb = s.split()[0] if s.split() else ""
    known = SQL_VERBS.get(verb)
    if not known:
        return None
    effect_type, op = known
    if verb == "insert":
        m = re.search(r'insert\s+into\s+"?([\w.]+)"?', s)
    elif verb == "update":
        m = re.search(r'update\s+"?([\w.]+)"?', s)
    elif verb == "delete":
        m = re.search(r'delete\s+from\s+"?([\w.]+)"?', s)
    else:
        m = re.search(r'\bfrom\s+"?([\w.]+)"?', s)
    table = None
    if m:
        table = m.group(1).split(".")[-1]
    effect = {"effectType": effect_type, "op": op, "table": table}

    # literal column values — StateMachineInference raw material (SBIR v1.2)
    if verb == "update":
        set_m = re.search(r"\bset\s+([\s\S]*?)(?:\s+where\s|$)", s)
        if set_m:
            sets = literal_pairs_of(set_m.group(1))
            if sets:
                effect["sets"] = sets
    if verb in ("update", "delete", "select"):
        where_m = re.search(r"\bwhere\s+([\s\S]*)$", s)
        if where_m:
            where = literal_pairs_of(where_m.group(1))
            if where:
                effect["where"] = where
    if verb == "insert":
        im = re.search(r"\(([^)]*)\)\s*values\s*\(([^)]*)\)", s)
        if im:
            cols = [c.strip().replace('"', "") for c in im.group(1).split(",")]
            vals = [v.strip() for v in im.group(2).split(",")]
            inserts = {}
            for i, col in enumerate(cols):
                if i < len(vals):
                    q = re.match(r"^'([^']*)'$", vals[i])
                    if q:
                        inserts[col] = q.group(1)
            if inserts:
                effect["inserts"] = inserts
    return effect


def sql_literal_of(arg):
    """'SELECT …' literal, or sqlalchemy text('SELECT …') unwrapped."""
    v = lit(arg)
    if isinstance(v, str):
        return v
    if (isinstance(arg, ast.Call) and isinstance(arg.func, ast.Name)
            and arg.func.id == "text" and arg.args):
        v = lit(arg.args[0])
        if isinstance(v, str):
            return v
    return None


SA_BUILDERS = {
    "select": ("db_read", "select"),
    "insert": ("db_write", "insert"),
    "update": ("db_write", "update"),
    "delete": ("db_write", "delete"),
}


def sa_builder_effect(arg):
    """SQLAlchemy 2.0 statement builders: select(User) / insert(User).values(…) /
    update(User).where(…) / delete(User) — the model Name is the table, however
    deep the method chaining goes (the open-webui shape)."""
    cur = arg
    for _ in range(8):
        if (isinstance(cur, ast.Call) and isinstance(cur.func, ast.Name)
                and cur.func.id in SA_BUILDERS and cur.args
                and isinstance(cur.args[0], ast.Name)):
            effect_type, op = SA_BUILDERS[cur.func.id]
            return {"effectType": effect_type, "op": op,
                    "table": cur.args[0].id.lower()}
        if isinstance(cur, ast.Call) and isinstance(cur.func, ast.Attribute):
            cur = cur.func.value  # unwrap .values(…)/.where(…)/.join(…) chains
        else:
            return None
    return None


def builder_table_of(node):
    """supabase.table('users').insert(…) chains → 'users'."""
    cur = node
    for _ in range(8):
        if isinstance(cur, ast.Call):
            f = cur.func
            if (isinstance(f, ast.Attribute) and f.attr in ("table", "from_")
                    and cur.args and isinstance(lit(cur.args[0]), str)):
                return lit(cur.args[0])
            cur = f.value if isinstance(f, ast.Attribute) else None
        elif isinstance(cur, ast.Attribute):
            cur = cur.value
        else:
            return None
    return None


def value_type_of(v):
    if isinstance(v, ast.Constant):
        if isinstance(v.value, bool):
            return "boolean"
        if isinstance(v.value, str):
            return "string"
        if isinstance(v.value, (int, float)):
            return "number"
        if v.value is None:
            return "null"
        return "unknown"
    if isinstance(v, (ast.List, ast.Tuple, ast.ListComp)):
        return "array"
    if isinstance(v, ast.Dict):
        return "object"
    if isinstance(v, ast.Name):
        return "unknown:" + v.id
    if isinstance(v, ast.Attribute):
        return "unknown:" + v.attr
    if isinstance(v, ast.Subscript):
        # row["email"] → the key names the column
        key = lit(v.slice) if not isinstance(v.slice, ast.Tuple) else None
        if isinstance(key, str):
            return "unknown:" + key
        return "unknown"
    return "unknown"


def dict_shape_of(node):
    """return {…} / JSONResponse(content={…}) → shape dict, else None."""
    if isinstance(node, ast.Call):
        fname = None
        if isinstance(node.func, ast.Name):
            fname = node.func.id
        elif isinstance(node.func, ast.Attribute):
            fname = node.func.attr
        if fname in ("JSONResponse", "ORJSONResponse", "UJSONResponse"):
            for kw in node.keywords:
                if kw.arg == "content":
                    return dict_shape_of(kw.value)
            if node.args:
                return dict_shape_of(node.args[0])
        return None
    if not isinstance(node, ast.Dict):
        return None
    shape = {}
    for key_node, value_node in zip(node.keys, node.values):
        key = lit(key_node)
        if not isinstance(key, str):
            continue
        shape[key] = value_type_of(value_node)
    return shape


def is_http_denial(exc):
    if not isinstance(exc, ast.Call):
        return False
    fname = None
    if isinstance(exc.func, ast.Name):
        fname = exc.func.id
    elif isinstance(exc.func, ast.Attribute):
        fname = exc.func.attr
    if fname != "HTTPException":
        return False
    for kw in exc.keywords:
        if kw.arg == "status_code" and lit(kw.value) in (401, 403):
            return True
    if exc.args and lit(exc.args[0]) in (401, 403):
        return True
    return False


TX_CTX_ATTRS = ("begin", "begin_nested", "transaction", "atomic")


def is_tx_context(expr):
    """SBIR §2.2 — `with session.begin():`, `with db.transaction():`,
    `with db:` (the sqlite3/DB-API commit-or-rollback idiom)."""
    if isinstance(expr, ast.Name):
        return True
    if isinstance(expr, ast.Call) and isinstance(expr.func, ast.Attribute):
        return expr.func.attr in TX_CTX_ATTRS
    return False


def scan_function(fn):
    out = {
        "effects": [],
        "returnShapes": [],
        "calls": [],
        "guardSignals": {"deniesWithStatus": False},
        "validatesInput": False,
        "async": isinstance(fn, ast.AsyncFunctionDef),
    }
    ctx = {"tx": None, "iso": "default", "tryId": None, "catchOf": None}
    for stmt in fn.body:
        _visit(stmt, out, ctx)
    return out


def _visit(node, out, ctx):
    if isinstance(node, ast.Try):
        try_line = node.lineno
        for stmt in node.body:
            _visit(stmt, out, dict(ctx, tryId=try_line, catchOf=None))
        for handler in node.handlers:
            for stmt in handler.body:
                _visit(stmt, out, dict(ctx, tryId=None, catchOf=try_line))
        for stmt in node.orelse + node.finalbody:
            _visit(stmt, out, ctx)
        return
    if isinstance(node, (ast.With, ast.AsyncWith)):
        is_tx = any(is_tx_context(item.context_expr) for item in node.items)
        child = dict(ctx, tx=node.lineno, iso="default") if is_tx else ctx
        for item in node.items:  # the context expression runs OUTSIDE the scope
            _visit(item.context_expr, out, ctx)
        for stmt in node.body:
            _visit(stmt, out, child)
        return
    if isinstance(node, ast.Call):
        inspect_call(node, out, ctx)
    elif isinstance(node, ast.Return) and node.value is not None:
        shape = dict_shape_of(node.value)
        if shape is not None and len(out["returnShapes"]) < MAX_RETURN_SHAPES:
            out["returnShapes"].append({"line": node.lineno, "shape": shape})
    elif isinstance(node, ast.Raise) and node.exc is not None:
        if is_http_denial(node.exc):
            out["guardSignals"]["deniesWithStatus"] = True
    for child in ast.iter_child_nodes(node):
        _visit(child, out, ctx)


def push_effect(out, ctx, effect):
    if len(out["effects"]) >= MAX_EFFECTS:
        return
    if ctx.get("tx") is not None:
        effect["txLine"] = ctx["tx"]
        effect["txIsolation"] = ctx.get("iso", "default")
    if ctx.get("tryId") is not None:
        effect["tryId"] = ctx["tryId"]
    if ctx.get("catchOf") is not None:
        effect["catchOf"] = ctx["catchOf"]
    out["effects"].append(effect)


def inspect_call(node, out, ctx):
    line = node.lineno
    func = node.func

    if isinstance(func, ast.Name):
        if func.id == "open":
            mode = lit(node.args[1]) if len(node.args) > 1 else "r"
            for kw in node.keywords:
                if kw.arg == "mode" and isinstance(lit(kw.value), str):
                    mode = lit(kw.value)
            target = lit(node.args[0]) if node.args else None
            effect_type = ("fs_write" if isinstance(mode, str)
                           and any(c in mode for c in "wax+") else "fs_read")
            push_effect(out, ctx, {
                "effectType": effect_type,
                "target": target if isinstance(target, str) else "dynamic",
                "line": line,
            })
            return
        if func.id == "HTTPException":
            return  # denial signal handled at the Raise node
        if len(out["calls"]) < MAX_CALLS:
            out["calls"].append({"name": func.id, "line": line})
        return

    if not isinstance(func, ast.Attribute):
        return
    method = func.attr
    root = root_name(func)

    # entropy: nondeterminism points the flight replayer must virtualize
    if root == "datetime" and method in ("now", "utcnow", "today"):
        push_effect(out, ctx, {"effectType": "entropy", "target": "time", "line": line})
        return
    if root == "time" and method in ("time", "monotonic", "time_ns"):
        push_effect(out, ctx, {"effectType": "entropy", "target": "time", "line": line})
        return
    if root == "random":
        push_effect(out, ctx, {"effectType": "entropy", "target": "random", "line": line})
        return
    if root == "uuid" and method.startswith("uuid"):
        push_effect(out, ctx, {"effectType": "entropy", "target": "uuid", "line": line})
        return

    # input validation signal (SBIR §2.1): explicit Pydantic validation calls
    if method in ("model_validate", "model_validate_json", "parse_obj", "parse_raw"):
        out["validatesInput"] = True
        return

    # raw SQL: X.execute('INSERT …') / cursor.execute(text('SELECT …')) — and the
    # SQLAlchemy 2.0 result methods (scalars/scalar/stream) that take the same
    # statement builders execute does
    if method in ("execute", "executemany", "scalars", "scalar",
                  "stream", "stream_scalars") and node.args:
        sql = sql_literal_of(node.args[0])
        if sql:
            parsed = parse_sql(sql)
            if parsed:
                parsed["line"] = line
                parsed["driver"] = root or "unknown"
                push_effect(out, ctx, parsed)
                return
        built = sa_builder_effect(node.args[0])
        if built:
            built["line"] = line
            built["driver"] = root or "unknown"
            push_effect(out, ctx, built)
            return
        push_effect(out, ctx, {
            "effectType": "db_read", "op": "unknown", "table": None,
            "line": line, "driver": root or "unknown",
        })
        return

    # SQLAlchemy ORM: session.query(User) → read; session.add/delete → write.
    # The receiver is matched on the full dotted chain, so `self.db.add(…)`
    # inside a service class reads like `db.add(…)` at module level.
    recv = dotted_name(func.value)
    if method == "query" and node.args and isinstance(node.args[0], ast.Name):
        push_effect(out, ctx, {
            "effectType": "db_read", "op": "select",
            "table": node.args[0].id.lower(), "line": line,
            "driver": root or "unknown",
        })
        return
    if (method in ("add", "add_all", "merge") and recv
            and re.search(r"session|db", recv, re.I)):
        push_effect(out, ctx, {
            "effectType": "db_write", "op": "insert", "table": None,
            "line": line, "driver": root,
        })
        return
    # session.get(User, id) — the 2.0 primary-key read; the capitalized model
    # Name is the table (bounded: session/db receivers only, Model arg only)
    if (method == "get" and recv and re.search(r"session|db", recv, re.I)
            and node.args and isinstance(node.args[0], ast.Name)
            and node.args[0].id[:1].isupper()):
        push_effect(out, ctx, {
            "effectType": "db_read", "op": "select",
            "table": node.args[0].id.lower(), "line": line,
            "driver": root or "unknown",
        })
        return
    # session.delete(instance) — the ORM unit-of-work delete
    if (method == "delete" and recv and re.search(r"session|db", recv, re.I)):
        table = (node.args[0].id.lower()
                 if node.args and isinstance(node.args[0], ast.Name)
                 and node.args[0].id[:1].isupper() else None)
        push_effect(out, ctx, {
            "effectType": "db_write", "op": "delete", "table": table,
            "line": line, "driver": root or "unknown",
        })
        return

    # supabase-py builder: supabase.table('users').insert(…)
    if method in SUPABASE_OPS:
        table = builder_table_of(func.value)
        if table:
            push_effect(out, ctx, {
                "effectType": "db_read" if method == "select" else "db_write",
                "op": method, "table": table.lower(), "line": line,
            })
            return

    # HTTP clients: requests.get(…), httpx.post(…) — the attr IS the method
    if root in HTTP_CLIENTS and method in ("get", "post", "put", "patch",
                                           "delete", "head", "request"):
        target = lit(node.args[0]) if node.args else None
        effect = {
            "effectType": "http_call",
            "target": target if isinstance(target, str) else "dynamic",
            "line": line,
        }
        if method != "request":
            effect["httpMethod"] = method.upper()
        push_effect(out, ctx, effect)
        return

    # filesystem: os.remove(…), shutil.rmtree(…), Path.write_text(…)
    if method in FS_WRITE and (root in ("os", "shutil") or method.startswith("write")
                               or root is None):
        target = lit(node.args[0]) if node.args else None
        push_effect(out, ctx, {
            "effectType": "fs_write",
            "target": target if isinstance(target, str) else "dynamic",
            "line": line,
        })
        return
    if method in FS_READ and root in ("os", "os.path"):
        target = lit(node.args[0]) if node.args else None
        push_effect(out, ctx, {
            "effectType": "fs_read",
            "target": target if isinstance(target, str) else "dynamic",
            "line": line,
        })


TYPE_MAP = {"str": "string", "int": "integer", "float": "number", "bool": "boolean"}


def annotation_type(node):
    if isinstance(node, ast.Name):
        return TYPE_MAP.get(node.id, node.id)
    if isinstance(node, ast.Subscript) and isinstance(node.value, ast.Name):
        if node.value.id in ("Optional", "Union"):
            inner = node.slice
            if isinstance(inner, ast.Tuple) and inner.elts:
                return annotation_type(inner.elts[0])
            return annotation_type(inner)
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.BitOr):
        left = annotation_type(node.left)
        return left if left != "None" else annotation_type(node.right)
    if isinstance(node, ast.Constant) and node.value is None:
        return "None"
    return "string"


def depends_target(default_node):
    """Depends(fn) → 'fn', Depends() / Depends(lambda: …) → None."""
    if not isinstance(default_node, ast.Call):
        return None
    f = default_node.func
    name = f.id if isinstance(f, ast.Name) else (
        f.attr if isinstance(f, ast.Attribute) else None)
    if name != "Depends":
        return None
    if default_node.args and isinstance(default_node.args[0], ast.Name):
        return default_node.args[0].id
    return None


class UbgExtractor:
    def __init__(self, entry_file, project_root):
        self.entry_file = os.path.abspath(entry_file)
        self.root = os.path.abspath(project_root)
        self.routes = []
        self.helpers = []
        self.global_middlewares = []
        self.skipped = []
        self.scanned_files = []
        self.visited = set()
        self.mounts = []
        self.mod_cache = {}  # abs_file -> parsed module facts (or {'error': …})
        self.bundle_cache = {}  # (file, qualname) -> fully-resolved scan bundle

    def rel(self, abs_path):
        return os.path.relpath(abs_path, self.root).replace(os.path.sep, "/")

    def resolve_import(self, from_file, module_name):
        if not module_name:
            return None
        if module_name.startswith("."):
            dots = len(module_name) - len(module_name.lstrip("."))
            clean = module_name[dots:]
            base = os.path.dirname(from_file)
            for _ in range(dots - 1):
                base = os.path.dirname(base)
            parts = clean.split(".") if clean else []
            cand = os.path.join(base, *parts)
        else:
            parts = module_name.split(".")
            cand = os.path.join(self.root, *parts)
            if not (os.path.isfile(cand + ".py") or os.path.isdir(cand)):
                cand = os.path.join(os.path.dirname(from_file), *parts)
        for p in (cand + ".py", os.path.join(cand, "__init__.py")):
            if os.path.isfile(p):
                return os.path.abspath(p)
        return None

    # ---- the interprocedural engine (resolve.js contract) --------------------

    def parse_module(self, abs_file):
        """Module facts for call-following: imports, module-level functions,
        classes, and instance singletons (`Users = UsersTable()` — THE FastAPI
        repository idiom). Memoized; a parse error caches as {'error': …}."""
        cached = self.mod_cache.get(abs_file)
        if cached is not None:
            return cached
        mod = {"file": abs_file, "functions": {}, "classes": {},
               "instances": {}, "imports": {}}
        try:
            with open(abs_file, "r", encoding="utf-8") as f:
                tree = ast.parse(f.read(), filename=abs_file)
        except Exception as e:  # noqa: BLE001 — cached, surfaced by parse_file
            mod = {"error": str(e)[:80]}
            self.mod_cache[abs_file] = mod
            return mod
        mod["tree"] = tree
        for node in tree.body:
            if isinstance(node, ast.ImportFrom):
                dots = "." * node.level if node.level > 0 else ""
                m = dots + (node.module or "")
                for n in node.names:
                    local = n.asname or n.name
                    resolved = (self.resolve_import(abs_file, m + "." + n.name)
                                or self.resolve_import(abs_file, m))
                    if resolved:
                        mod["imports"][local] = resolved
            elif isinstance(node, ast.Import):
                for n in node.names:
                    resolved = self.resolve_import(abs_file, n.name)
                    if resolved:
                        mod["imports"][n.asname or n.name] = resolved
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                mod["functions"][node.name] = node
            elif isinstance(node, ast.ClassDef):
                mod["classes"][node.name] = node
            elif isinstance(node, ast.Assign) and len(node.targets) == 1 \
                    and isinstance(node.targets[0], ast.Name) \
                    and isinstance(node.value, ast.Call) \
                    and isinstance(node.value.func, ast.Name):
                mod["instances"][node.targets[0].id] = node.value.func.id
        self.mod_cache[abs_file] = mod
        return mod

    def resolve_class(self, mod, name, depth=0):
        """class name → (ClassDef, owning mod), through imports, bounded."""
        if not mod or "error" in mod or depth > MAX_RESOLVE_DEPTH:
            return None
        cls = mod["classes"].get(name)
        if cls is not None:
            return cls, mod
        imported = mod["imports"].get(name)
        if imported:
            return self.resolve_class(self.parse_module(imported), name, depth + 1)
        return None

    def method_in_class_chain(self, cls, mod, name, depth=0):
        """find `name` on cls or up its bases → (fn, declaring mod). The Python
        analogue of extract.js#methodInClassChain."""
        if depth > MAX_RESOLVE_DEPTH:
            return None
        for stmt in cls.body:
            if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)) \
                    and stmt.name == name:
                return stmt, mod
        for base in cls.bases:
            if isinstance(base, ast.Name):
                hit = self.resolve_class(mod, base.id, depth + 1)
                if hit:
                    found = self.method_in_class_chain(
                        hit[0], hit[1], name, depth + 1)
                    if found:
                        return found
        return None

    def resolve_receiver(self, mod, name):
        """what `name.method()` dispatches on: a class (directly, via a
        module-level singleton, or imported), or a module alias."""
        if name in mod["classes"]:
            return ("class", mod["classes"][name], mod)
        if name in mod["instances"]:
            hit = self.resolve_class(mod, mod["instances"][name])
            return ("class", hit[0], hit[1]) if hit else None
        imported = mod["imports"].get(name)
        if not imported:
            return None
        tmod = self.parse_module(imported)
        if not tmod or "error" in tmod:
            return None
        if name in tmod["classes"]:
            return ("class", tmod["classes"][name], tmod)
        if name in tmod["instances"]:
            hit = self.resolve_class(tmod, tmod["instances"][name])
            return ("class", hit[0], hit[1]) if hit else None
        return ("module", tmod)  # `from pkg import mod` / `import pkg.mod as m`

    def class_method_bundle(self, cls, cmod, method, depth, stack):
        """the fully-resolved scan of Cls.method — its body plus everything the
        walk reaches below it — memoized per (file, Cls.method). A bundle in
        flight contributes nothing (cycle guard) and is never cached partial."""
        if depth >= MAX_RESOLVE_DEPTH:
            return None
        hit = self.method_in_class_chain(cls, cmod, method)
        if not hit:
            return None
        fn, decl_mod = hit
        key = (cmod["file"], (cls.name or "anonymous") + "." + method)
        cached = self.bundle_cache.get(key)
        if cached is not None:
            return cached
        if key in stack:
            return None
        stack.add(key)
        base = scan_function(fn)
        bundle = clone_scan(base)
        bundle["key"] = key[0] + "#" + key[1]
        decl_rel = self.rel(decl_mod["file"])
        if decl_rel not in self.scanned_files:
            self.scanned_files.append(decl_rel)
        self.helpers.append({"name": key[1], "sourceFile": decl_rel,
                             "sourceLine": fn.lineno, "scan": base})
        self.follow_calls(fn, decl_mod, bundle, set(), depth + 1,
                          {"top_cls": cls, "top_mod": cmod}, stack)
        stack.discard(key)
        self.bundle_cache[key] = bundle
        return bundle

    def function_bundle(self, tmod, name, depth, stack):
        """same contract for a module-level function reached across an import."""
        if depth >= MAX_RESOLVE_DEPTH or not tmod or "error" in tmod:
            return None
        fn = tmod["functions"].get(name)
        if fn is None:
            return None
        key = (tmod["file"], name)
        cached = self.bundle_cache.get(key)
        if cached is not None:
            return cached
        if key in stack:
            return None
        stack.add(key)
        base = scan_function(fn)
        bundle = clone_scan(base)
        bundle["key"] = key[0] + "#" + name
        fn_rel = self.rel(tmod["file"])
        if fn_rel not in self.scanned_files:
            self.scanned_files.append(fn_rel)
        self.helpers.append({"name": name, "sourceFile": fn_rel,
                             "sourceLine": fn.lineno, "scan": base})
        self.follow_calls(fn, tmod, bundle, set(), depth + 1, None, stack)
        stack.discard(key)
        self.bundle_cache[key] = bundle
        return bundle

    def follow_calls(self, fn, mod, merged, seen, depth, cls_ctx, stack,
                     bindings=None):
        """ONE walk over the calls of a scanned body, following every receiver
        kind out of it: `self.<m>()` sibling dispatch, DI-bound params,
        local instances (`svc = Service()`), imported singletons/classes,
        module aliases, and bare imported functions. Bounded, memoized,
        cycle-guarded — the resolve.js walk, in Python."""
        if depth >= MAX_RESOLVE_DEPTH or not mod or "error" in mod:
            return
        local_instances = {}
        for node in ast.walk(fn):
            if isinstance(node, ast.Assign) and len(node.targets) == 1 \
                    and isinstance(node.targets[0], ast.Name) \
                    and isinstance(node.value, ast.Call) \
                    and isinstance(node.value.func, ast.Name):
                local_instances[node.targets[0].id] = node.value.func.id
        for node in ast.walk(fn):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            bundle = None
            if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name):
                obj, meth = func.value.id, func.attr
                if obj == "self" and cls_ctx is not None:
                    bundle = self.class_method_bundle(
                        cls_ctx["top_cls"], cls_ctx["top_mod"], meth,
                        depth, stack)
                elif bindings and obj in bindings:
                    b_cls, b_mod = bindings[obj]
                    bundle = self.class_method_bundle(
                        b_cls, b_mod, meth, depth, stack)
                elif obj in local_instances:
                    hit = self.resolve_class(mod, local_instances[obj])
                    if hit:
                        bundle = self.class_method_bundle(
                            hit[0], hit[1], meth, depth, stack)
                else:
                    target = self.resolve_receiver(mod, obj)
                    if target and target[0] == "class":
                        bundle = self.class_method_bundle(
                            target[1], target[2], meth, depth, stack)
                    elif target and target[0] == "module":
                        bundle = self.function_bundle(
                            target[1], meth, depth, stack)
            elif isinstance(func, ast.Name):
                imported = mod["imports"].get(func.id)
                if imported:
                    bundle = self.function_bundle(
                        self.parse_module(imported), func.id, depth, stack)
            if bundle is not None and bundle["key"] not in seen:
                seen.add(bundle["key"])
                merge_scan(merged, bundle)

    def deep_scan(self, fn, mod, bindings=None):
        """a body's real scan = its own effects + everything follow_calls
        resolves below it. The Python analogue of resolve.js#deepScan."""
        base = scan_function(fn)
        merged = clone_scan(base)
        self.follow_calls(fn, mod, merged, set(), 0, None, set(), bindings)
        return merged

    # --------------------------------------------------------------------------

    def run(self):
        self.parse_file(self.entry_file, "", 0)
        # growing queue, NOT a snapshot: a mounted router file can itself
        # include_router sub-routers (the FastAPI project-template pattern)
        i = 0
        while i < len(self.mounts):
            prefix, file_path, _name, depth = self.mounts[i]
            i += 1
            self.parse_file(file_path, prefix, depth)
        self.routes.sort(key=lambda r: (r["path"], r["method"]))
        return {
            "routes": self.routes,
            "helpers": self.helpers,
            "globalMiddlewares": self.global_middlewares,
            "skipped": self.skipped,
            "scannedFiles": self.scanned_files,
        }

    def parse_file(self, abs_file, prefix, depth):
        key = abs_file + "::" + prefix
        if depth > 2 or key in self.visited or not os.path.exists(abs_file):
            return
        self.visited.add(key)
        try:
            with open(abs_file, "r", encoding="utf-8") as f:
                src = f.read()
            tree = ast.parse(src, filename=abs_file)
        except Exception as e:  # noqa: BLE001 — reported, never swallowed
            self.skipped.append({
                "reason": "parse error: " + str(e)[:80],
                "file": self.rel(abs_file),
            })
            return
        rel_file = self.rel(abs_file)
        self.scanned_files.append(rel_file)
        modctx = self.parse_module(abs_file)  # the walk's view of this file

        app_vars, router_vars, router_prefixes, router_deps, import_map = (
            set(), set(), {}, {}, {})
        functions = {}  # name -> ast node (module level)

        for node in tree.body:
            if isinstance(node, ast.ImportFrom):
                dots = "." * node.level if node.level > 0 else ""
                mod = dots + (node.module or "")
                for n in node.names:
                    local = n.asname or n.name
                    resolved = (self.resolve_import(abs_file, mod + "." + n.name)
                                or self.resolve_import(abs_file, mod))
                    if resolved:
                        import_map[local] = resolved
            elif isinstance(node, ast.Import):
                for n in node.names:
                    resolved = self.resolve_import(abs_file, n.name)
                    if resolved:
                        import_map[n.asname or n.name] = resolved
            elif isinstance(node, ast.Assign) and len(node.targets) == 1 and \
                    isinstance(node.targets[0], ast.Name) and \
                    isinstance(node.value, ast.Call):
                var, call = node.targets[0].id, node.value
                cname = call.func.id if isinstance(call.func, ast.Name) else (
                    call.func.attr if isinstance(call.func, ast.Attribute) else "")
                if cname == "FastAPI":
                    app_vars.add(var)
                    for kw in call.keywords:
                        if kw.arg == "dependencies":
                            for t in self.dep_targets_of(kw.value):
                                self.global_middlewares.append(
                                    {"target": t, "file": abs_file})
                elif cname == "APIRouter":
                    router_vars.add(var)
                    router_prefixes[var] = ""
                    router_deps[var] = []
                    for kw in call.keywords:
                        if kw.arg == "prefix" and isinstance(lit(kw.value), str):
                            router_prefixes[var] = lit(kw.value)
                        if kw.arg == "dependencies":
                            router_deps[var] = self.dep_targets_of(kw.value)
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                functions[node.name] = node

        # helpers: module-level defs that are NOT route handlers
        route_handler_names = set()
        for node in tree.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                if self.route_decorator_of(node, app_vars, router_vars):
                    route_handler_names.add(node.name)

        for name in sorted(functions):
            if name in route_handler_names:
                continue
            fn = functions[name]
            is_global_mw = any(
                isinstance(dec, ast.Call) and isinstance(dec.func, ast.Attribute)
                and dec.func.attr == "middleware"
                and isinstance(dec.func.value, ast.Name)
                and dec.func.value.id in app_vars
                for dec in fn.decorator_list)
            step = {
                "name": name,
                "sourceFile": rel_file,
                "sourceLine": fn.lineno,
                "scan": scan_function(fn),
            }
            self.helpers.append(step)
            if is_global_mw:
                self.global_middlewares.append(
                    {"target": name, "file": abs_file, "resolved": dict(step)})

        # resolve FastAPI(dependencies=[…]) targets declared in this file
        for gm in self.global_middlewares:
            if gm.get("file") == abs_file and "resolved" not in gm:
                step = self.resolve_dep(gm["target"], functions, import_map,
                                        rel_file, abs_file)
                if step:
                    gm["resolved"] = step

        # routes + mounts
        for node in tree.body:
            if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call):
                self.collect_mount(node.value, abs_file, prefix, import_map,
                                   router_vars, router_prefixes, depth)
                continue
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            found = self.route_decorator_of(node, app_vars, router_vars)
            if not found:
                continue
            dec, obj_name, method = found
            raw_path = lit(dec.args[0]) if dec.args else None
            if not isinstance(raw_path, str):
                self.skipped.append({
                    "reason": "dynamic path on %s (non-literal first arg)"
                              % method.upper(),
                    "file": rel_file, "line": node.lineno,
                })
                continue
            local_prefix = router_prefixes.get(obj_name, "") \
                if obj_name in router_vars else ""
            full_path = (prefix + local_prefix + raw_path).replace("//", "/")
            if not full_path.startswith("/"):
                full_path = "/" + full_path
            if full_path == "/mcp" or full_path.startswith("/mcp/"):
                self.skipped.append({
                    "reason": "self-referential path %s blocked" % full_path,
                    "file": rel_file, "line": node.lineno,
                })
                continue

            chain = []
            dep_names = list(router_deps.get(obj_name, []))
            for kw in dec.keywords:
                if kw.arg == "dependencies":
                    dep_names.extend(self.dep_targets_of(kw.value))
            for arg, default in self.args_with_defaults(node):
                target = depends_target(default) if default is not None else None
                if target:
                    dep_names.append(target)
            for dep_name in dep_names:
                step = self.resolve_dep(dep_name, functions, import_map,
                                        rel_file, abs_file)
                if step:
                    step["role"] = "middleware"
                    chain.append(step)
                else:
                    self.skipped.append({
                        "reason": "dependency '%s' not resolved on %s %s"
                                  % (dep_name, method.upper(), full_path),
                        "file": rel_file, "line": node.lineno,
                    })
            # DI bindings: `svc: UserService = Depends(get_user_service)` /
            # `Depends(UserService)` bind the param name to a resolvable class,
            # so `svc.method()` inside the handler dispatches through it
            bindings = {}
            for arg, default in self.args_with_defaults(node):
                dep_cls = None
                if isinstance(default, ast.Call):
                    f = default.func
                    dname = f.id if isinstance(f, ast.Name) else (
                        f.attr if isinstance(f, ast.Attribute) else None)
                    if dname == "Depends" and default.args \
                            and isinstance(default.args[0], ast.Name):
                        dep_cls = self.resolve_class(modctx,
                                                     default.args[0].id)
                if dep_cls is None and isinstance(arg.annotation, ast.Name):
                    dep_cls = self.resolve_class(modctx, arg.annotation.id)
                if dep_cls:
                    bindings[arg.arg] = dep_cls
            handler_scan = self.deep_scan(node, modctx, bindings)
            params = self.params_of(node, full_path)
            # a Pydantic body model means FastAPI validates before the handler
            # runs — same signal as an explicit zod .safeParse (SBIR §2.1)
            if any(p["in"] == "body" for p in params):
                handler_scan["validatesInput"] = True
            chain.append({
                "name": node.name, "role": "handler", "sourceFile": rel_file,
                "sourceLine": node.lineno, "scan": handler_scan,
            })

            self.routes.append({
                "method": method,
                "path": full_path,
                "sourceFile": rel_file,
                "sourceLine": node.lineno,
                "params": params,
                "chain": chain,
                "description": (ast.get_docstring(node) or "")[:400],
            })

    def route_decorator_of(self, fn, app_vars, router_vars):
        for dec in fn.decorator_list:
            if isinstance(dec, ast.Call) and isinstance(dec.func, ast.Attribute) \
                    and dec.func.attr in HTTP_VERBS \
                    and isinstance(dec.func.value, ast.Name) \
                    and (dec.func.value.id in app_vars
                         or dec.func.value.id in router_vars):
                return dec, dec.func.value.id, dec.func.attr
        return None

    def collect_mount(self, call, abs_file, prefix, import_map, router_vars,
                      router_prefixes, depth=0):
        if not (isinstance(call.func, ast.Attribute)
                and call.func.attr == "include_router" and call.args):
            return
        arg0 = call.args[0]
        router_name = None
        if isinstance(arg0, ast.Name):
            router_name = arg0.id
        elif isinstance(arg0, ast.Attribute) and isinstance(arg0.value, ast.Name):
            router_name = arg0.value.id
        if not router_name:
            return
        mount_prefix = ""
        for kw in call.keywords:
            if kw.arg == "prefix" and isinstance(lit(kw.value), str):
                mount_prefix = lit(kw.value)
        resolved = import_map.get(router_name)
        cum = (prefix + mount_prefix).replace("//", "/")
        if resolved:
            self.mounts.append((cum, resolved, router_name, depth + 1))
        elif router_name in router_vars:
            pass  # same-file router: its routes are collected in this pass
        else:
            self.skipped.append({
                "reason": "router '%s' source file not resolved" % router_name,
                "file": self.rel(abs_file), "line": call.lineno,
            })

    def dep_targets_of(self, list_node):
        targets = []
        if isinstance(list_node, (ast.List, ast.Tuple)):
            for el in list_node.elts:
                t = depends_target(el)
                if t:
                    targets.append(t)
        return targets

    def resolve_dep(self, name, functions, import_map, rel_file, abs_file):
        # dependencies are deep-scanned like handlers: an auth dep that reads
        # the user table is real, provable behavior on every route it guards
        fn = functions.get(name)
        if fn is not None:
            return {"name": name, "sourceFile": rel_file,
                    "sourceLine": fn.lineno,
                    "scan": self.deep_scan(fn, self.parse_module(abs_file))}
        imported = import_map.get(name)
        if imported:
            tmod = self.parse_module(imported)
            if not tmod or "error" in tmod:
                return None
            node = tmod["functions"].get(name)
            if node is not None:
                dep_rel = self.rel(imported)
                if dep_rel not in self.scanned_files:
                    self.scanned_files.append(dep_rel)
                return {"name": name, "sourceFile": dep_rel,
                        "sourceLine": node.lineno,
                        "scan": self.deep_scan(node, tmod)}
        return None

    def args_with_defaults(self, fn):
        args = fn.args.args + fn.args.kwonlyargs
        defaults = ([None] * (len(fn.args.args) - len(fn.args.defaults))
                    + list(fn.args.defaults) + list(fn.args.kw_defaults))
        return list(zip(args, defaults))

    def params_of(self, fn, full_path):
        params = []
        path_names = set()
        for m in re.finditer(r"\{(\w+)\}", full_path):
            path_names.add(m.group(1))
            params.append({"name": m.group(1), "in": "path",
                           "type": "string", "required": True})
        for arg, default in self.args_with_defaults(fn):
            if arg.arg in ("self", "request", "background_tasks"):
                continue
            if default is not None and depends_target(default):
                continue
            a_type = annotation_type(arg.annotation) if arg.annotation else "string"
            if arg.arg in path_names:
                for p in params:
                    if p["name"] == arg.arg:
                        p["type"] = a_type
                continue
            # non-scalar annotations (Pydantic models) are the request body,
            # not query params — the IR keeps them as an opaque object input
            if a_type not in ("string", "integer", "number", "boolean"):
                params.append({"name": "body", "in": "body", "type": "object",
                               "required": default is None})
                continue
            params.append({"name": arg.arg, "in": "query", "type": a_type,
                           "required": default is None})
        return params


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: fastapi_extract.py <entry> <root>"}))
        sys.exit(1)
    try:
        result = UbgExtractor(sys.argv[1], sys.argv[2]).run()
        print(json.dumps(result, sort_keys=True))
    except Exception as e:  # noqa: BLE001 — the JS wrapper needs the message
        import traceback
        print(json.dumps({"error": "%s\n%s" % (e, traceback.format_exc())}))
        sys.exit(1)
