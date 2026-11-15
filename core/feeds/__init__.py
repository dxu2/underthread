"""Feeds (t-feed-inbox): outside sources (Gmail now, Slack later) polled by the dashboard server, summarised into the steward's inbox.

    core/feeds/base.py       Source: the interface every source implements, FeedError, text clean-up helpers
    core/feeds/imap.py       ImapSource + GmailSource (IMAP, read-only: EXAMINE + BODY.PEEK, never changes a flag)
    core/feeds/slack.py      SlackSource (listed as "coming soon"; available = False)
    core/feeds/cred.py       where a source's password lives: the macOS keychain (default) or an opt-in 0600 file
    core/feeds/classify.py   optional tool-less classifier (needs_user / can_draft / fyi); bodies go here and nowhere else
    core/feeds/collector.py  connect / disconnect / poll / tick, the cursor file feeds.json, and the inbox `feed` event

Adding a source: subclass base.Source, then register_source(MySource) (from a core module or an extension's server_ext.py).
Docs: docs/feeds.md.
"""
from core.feeds.base import Source, FeedError   # noqa: F401

SOURCES = {}   # id -> Source subclass, in the order shown on Settings -> Connections


def register_source(cls):
    """Add a source class (an id that is already taken raises, so an extension can never replace a core source)."""
    if not getattr(cls, "id", "") or cls.id in SOURCES:
        raise ValueError(f"feed source id missing or taken: {getattr(cls, 'id', '')!r}")
    SOURCES[cls.id] = cls
    return cls


def _core():
    from core.feeds.imap import GmailSource
    from core.feeds.slack import SlackSource
    register_source(GmailSource)
    register_source(SlackSource)


_core()
