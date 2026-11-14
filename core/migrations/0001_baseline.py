"""Baseline: the data shape as it was before schema numbers existed (t-oss-struct S3). Nothing to change; running it only
stamps the file. Missing top-level state keys are still filled on every read by stateutil._shape (the state's defaults), and
missing config keys by core/config.py DEFAULTS, so a new key never needs a step of its own."""
TARGETS = ("state", "config", "roster")


def up(data, ctx):
    return data
