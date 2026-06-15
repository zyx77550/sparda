from fastapi import APIRouter
from typing import Optional

router = APIRouter()

@router.get("/users/{user_id}")
def read_user(user_id: int, q: Optional[str] = None):
    """Retrieve package user details"""
    return {"user_id": user_id, "q": q}
