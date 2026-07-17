from fastapi import HTTPException
from db import session


def get_current_user(token: str = ""):
    user = session.execute("SELECT id FROM users WHERE token = 'x'")
    if not user:
        raise HTTPException(status_code=401, detail="unauthorized")
    return user
