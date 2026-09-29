"""WSGI entrypoint: gunicorn wsgi:app --bind 127.0.0.1:8000 --workers 1 --timeout 120."""

from app import app
from burmese_reader.application import initialize_resources

with app.app_context():
    initialize_resources()
