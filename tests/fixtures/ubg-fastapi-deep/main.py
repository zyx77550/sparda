from fastapi import FastAPI
from routers.items import router

app = FastAPI()
app.include_router(router, prefix="/items")
