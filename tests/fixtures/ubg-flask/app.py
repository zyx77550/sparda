from flask import Flask, request
from flask_login import login_required
from models import db, User
from admin import admin_bp

app = Flask(__name__)

@app.route("/users", methods=["POST"])
def create_user():
    # the DOMINANT Flask-SQLAlchemy write pattern — resolves to the `user` table
    u = User(email=request.json["email"])
    db.session.add(u)  # UNGUARDED
    db.session.commit()
    return {"ok": True}

@app.get("/health")
def health():
    return {"status": "ok"}  # read-only

@app.route("/users/<int:uid>", methods=["DELETE"])
@login_required
def delete_user(uid):
    User.query.filter_by(id=uid).delete()  # Query API — guarded by @login_required
    db.session.commit()
    return {"ok": True}

app.register_blueprint(admin_bp)
