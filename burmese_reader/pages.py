"""Burmese reader: pages."""

from __future__ import annotations

from flask import (
    Blueprint,
    jsonify,
    redirect,
    render_template,
)

bp = Blueprint("pages", __name__)


@bp.route("/ping")
def ping():
    return jsonify({"ok": True, "msg": "burmese_dict_server alive"})


@bp.route("/")
def index():
    return redirect("/reader")


@bp.route("/reader", methods=["GET"])
def reader_page():
    return render_template("reader.html")
