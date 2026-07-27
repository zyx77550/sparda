# A route whose URL lives in a constant table. FastAPI registers it exactly like any
# other — the endpoint IS served — but the decorator's first argument is not a literal,
# so SPARDA cannot bind the path. The registration must be DECLARED, never dropped.
from fastapi import FastAPI

app = FastAPI()

ROUTES = {"detail": "/orders/{order_id}", "wipe": "/orders"}


@app.get("/health")
async def health():
    return {"ok": True}


@app.delete(ROUTES["wipe"])
async def wipe_orders(db=None):
    db.execute("DELETE FROM orders")
    return {"ok": True}
