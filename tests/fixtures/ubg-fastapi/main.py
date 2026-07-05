# UBG FastAPI fixture — every node kind reachable, plus one dead helper.
import sqlite3

import requests
from fastapi import Depends, FastAPI, HTTPException

app = FastAPI()
db = sqlite3.connect("app.db")


def require_auth(authorization: str = ""):
    """Deny without a bearer token — must classify as guard."""
    if not authorization:
        raise HTTPException(status_code=401, detail="unauthorized")
    return authorization


def unused_helper():
    """Never called from any route — DeadPathElimination fodder."""
    return 42


@app.get("/users/{user_id}")
async def read_user(user_id: int):
    """Read one user."""
    row = db.execute(
        "SELECT id, email, active FROM users WHERE id = ?", (user_id,)
    ).fetchone()
    return {"id": user_id, "email": row.email, "active": row.active}


@app.post("/users", dependencies=[Depends(require_auth)])
async def create_user(email: str):
    """Create a user and notify the webhook."""
    db.execute("INSERT INTO users (email) VALUES (?)", (email,))
    requests.post("https://hooks.example.com/user-created")
    return {"ok": True}
