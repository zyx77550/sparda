from fastapi import APIRouter, Depends
from services.items import Items
from services.auth import get_current_user

router = APIRouter()


@router.post("/")
async def create_item(payload: dict, user=Depends(get_current_user)):
    return await Items.insert_new_item(payload)


@router.get("/")
async def list_items():
    return await Items.get_items()
