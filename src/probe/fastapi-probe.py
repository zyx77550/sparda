#!/usr/bin/env python3
"""
SPARDA — FastAPI Route Probe

Imports the user's FastAPI entry module, finds the FastAPI() instance,
iterates app.routes, and prints a JSON array to stdout.

No uvicorn, no server, no port. FastAPI/Starlette builds the full route
table synchronously during import (include_router, add_api_route, etc.),
so reading app.routes right after import is complete and exhaustive.

Import side-effects WILL run (hence opt-in via --probe). But no network
socket is opened by this script — just a Python import.

Output format (stdout, nothing else):
  [{"method": "GET", "path": "/users/{id}"}, ...]

Python ≥ 3.9. stdlib only.
"""

import sys
import os
import json
import importlib.util
import traceback


def find_fastapi_apps(module):
    """
    Scan a module's attributes for FastAPI application instances.
    Returns a list of (name, app) tuples.
    """
    try:
        from fastapi import FastAPI
    except ImportError:
        return []

    apps = []
    for attr_name in dir(module):
        try:
            val = getattr(module, attr_name)
            if isinstance(val, FastAPI):
                apps.append((attr_name, val))
        except Exception:
            pass
    return apps


def extract_routes(app):
    """
    Iterate app.routes (Starlette Route / APIRoute objects).
    Returns list of dicts with method and path.
    """
    routes = []
    try:
        for route in app.routes:
            try:
                # APIRoute (FastAPI endpoints) have .methods and .path
                path = getattr(route, 'path', None)
                methods = getattr(route, 'methods', None)
                if path is None:
                    continue
                if methods:
                    for m in methods:
                        routes.append({"method": m.upper(), "path": path})
                else:
                    # Mount or WebSocket — skip (no HTTP method)
                    pass
            except Exception:
                pass
    except Exception:
        pass
    return routes


def load_entry_module(entry_file):
    """
    Load the user's entry file as a module without running it as __main__.
    """
    entry_dir = os.path.dirname(os.path.abspath(entry_file))
    # Ensure the app's directory is on sys.path so relative imports work
    if entry_dir not in sys.path:
        sys.path.insert(0, entry_dir)

    spec = importlib.util.spec_from_file_location("__sparda_fastapi_probe__", entry_file)
    if spec is None:
        raise ImportError(f"Cannot create module spec for {entry_file!r}")

    module = importlib.util.module_from_spec(spec)
    # Don't execute __main__ guards: set __name__ to something other than '__main__'
    module.__name__ = "__sparda_fastapi_probe__"
    spec.loader.exec_module(module)
    return module


def main():
    if len(sys.argv) < 2:
        print(json.dumps([]), flush=True)
        sys.exit(0)

    entry_file = sys.argv[1]

    if not os.path.isfile(entry_file):
        print(f"[sparda probe] Entry file not found: {entry_file}", file=sys.stderr)
        print(json.dumps([]), flush=True)
        sys.exit(0)

    try:
        module = load_entry_module(entry_file)
    except SystemExit:
        # App called sys.exit() during import (e.g. arg parsing) — not fatal
        print("[]", flush=True)
        sys.exit(0)
    except Exception as e:
        print(f"[sparda probe] Failed to import {entry_file!r}: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        print(json.dumps([]), flush=True)
        sys.exit(0)

    apps = find_fastapi_apps(module)
    if not apps:
        # No FastAPI instance found — print empty
        print(json.dumps([]), flush=True)
        sys.exit(0)

    all_routes = []
    for _name, app in apps:
        all_routes.extend(extract_routes(app))

    # Deduplicate (same method+path from multiple apps is unusual but possible)
    seen = set()
    unique = []
    for r in all_routes:
        key = f"{r['method']}:{r['path']}"
        if key not in seen:
            seen.add(key)
            unique.append(r)

    # Deterministic: sort by key
    unique.sort(key=lambda r: f"{r['method']}:{r['path']}")

    print(json.dumps(unique), flush=True)


if __name__ == "__main__":
    main()
