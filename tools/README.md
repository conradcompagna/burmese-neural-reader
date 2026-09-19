# Dictionary and inspection tools

`dictionaries/` contains Wiktionary-to-TSV conversion and MMD dictionary cleanup. `inspection/` contains local boundary/tagging interfaces, span and POS inspection, and document retokenization.

Use `python -m tools.<area>.<module>` from the repository root. Reader-backed tools import `app.py` and require the dictionaries and models described in the setup guide. Tools that expose a server are local research interfaces, separate from the production WSGI entrypoint.
