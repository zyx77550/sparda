from flask import Blueprint, request
from sqlalchemy import update
from models import db, User

admin_bp = Blueprint("admin", __name__, url_prefix="/admin")

@admin_bp.route("/promote", methods=["POST"])
def promote():
    db.session.execute(update(User).where(User.id == request.json["id"]).values(role="admin"))  # UNGUARDED blueprint route
    db.session.commit()
    return {"ok": True}
