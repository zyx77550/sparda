from sqlalchemy import insert, select
from db import session
from models import Item


class ItemsTable:
    async def insert_new_item(self, form):
        await session.execute(insert(Item).values(**form))
        return self._count()

    def _count(self):
        return session.execute(select(Item))

    async def get_items(self):
        return await session.scalars(select(Item))


Items = ItemsTable()  # module-level singleton — the FastAPI repository idiom
