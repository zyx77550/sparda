from fastapi import FastAPI
from .routes.users import router as users_router

app = FastAPI()

@app.get("/health")
def get_health():
    """Health check package"""
    return {"status": "ok"}

app.include_router(users_router, prefix="/api")
