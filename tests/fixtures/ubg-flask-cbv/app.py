from flask import Flask
from flask.views import MethodView
from flask_restful import Api, Resource
from flask_login import login_required
from models import db, User

app = Flask(__name__)
api = Api(app)

class UserView(MethodView):
    def get(self):
        return {"users": []}                       # read-only

    def post(self):
        u = User()
        db.session.add(u)                          # UNGUARDED mutation
        db.session.commit()
        return {}

    def delete(self, uid):
        User.query.filter_by(id=uid).delete()      # UNGUARDED mutation (Query API)
        db.session.commit()
        return {}

class AdminView(MethodView):
    decorators = [login_required]                  # class-level guard over all methods

    def post(self):
        u = User()
        db.session.add(u)                          # guarded by the class decorator
        db.session.commit()
        return {}

class TokenResource(Resource):
    method_decorators = [login_required]           # Flask-RESTful class guard

    def delete(self):
        User.query.filter_by(id=1).delete()        # guarded
        db.session.commit()
        return {}

app.add_url_rule("/users", view_func=UserView.as_view("users"))
app.add_url_rule("/admin", view_func=AdminView.as_view("admin"))
api.add_resource(TokenResource, "/tokens")
