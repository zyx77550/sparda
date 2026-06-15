from fastapi import FastAPI, APIRouter
from pydantic import BaseModel
from typing import Optional

app = FastAPI()

class Item(BaseModel):
    name: str
    price: float
    is_offer: Optional[bool] = None

@app.get("/health")
def get_health():
    """Get system health."""
    return {"status": "ok"}

@app.post("/items")
def create_item(item: Item):
    """Create a new item in the store."""
    return item

# Router with prefix in definition
router = APIRouter(prefix="/users")

@router.get("/{user_id}")
def read_user(user_id: int, q: Optional[str] = None):
    """Get a user by ID."""
    return {"user_id": user_id, "q": q}

app.include_router(router)
