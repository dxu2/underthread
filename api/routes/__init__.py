"""Every route / action module. Importing this package registers all of them in api/router.py (order = registration order of
the prefix routes, which matters only for the file routes in web.py)."""
from api.routes import schedules, snooze, state, push, health, secret, hr, actions, media, docs, voice, update, web, feeds, setup  # noqa: F401  # pyflakes: unused-import
