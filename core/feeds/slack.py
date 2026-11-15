"""Slack (t-feed-inbox): designed for, not built yet. Listed on Settings -> Connections as "coming soon".

The plan when it is built: a Slack app with a user token (xoxp-, scopes channels:history, im:history, users:read), stored with
core/feeds/cred.py like the Gmail app password; poll() reads conversations.history since the cursor (the newest ts per
channel) for the channels the user picked and returns one message dict per new message, thread = thread_ts or ts,
link = the message permalink. Same event, same classifier, same dedupe as Gmail.
"""
from core.feeds.base import Source


class SlackSource(Source):
    id = "slack"
    label = ("Slack", "Slack")
    available = False
    account_hint = ("工作区，例如 acme.slack.com", "Workspace, e.g. acme.slack.com")
    secret_label = ("用户令牌", "User token")
    help = ("即将支持：读你选的频道和私信，只写摘要进收件箱。", "Coming soon: reads the channels and DMs you pick, writes summaries to the inbox.")
