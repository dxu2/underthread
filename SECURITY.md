# Security

## What Underthread is built to protect

Underthread runs on one machine for one person. Its safety rests on a few lines:

- **Local only.** The dashboard binds to `127.0.0.1`. It has **no login**: anyone who can reach the port can read your cards and act as you.
- **Host check.** Requests are accepted only for `localhost`, this machine's own names, `*.ts.net` (Tailscale) names and anything you list in `allowed_hosts` in `config.json`. This blocks DNS-rebinding attacks.
- **No cross-site writes.** A POST that comes from a browser must be same-origin and carry a custom header, so another website open in your browser can't click buttons on your dashboard.
- **Secrets stay on disk.** Push keys (`vapid.json`), push subscriptions (`push_subs.json`) and the optional GitHub token are created locally with mode 600, ignored by git, and never sent to the page.
- **Drafts only.** Every teammate is instructed never to publish, post, upload or send anything, and to make a plan before big or risky work. These are instructions to an AI model, not a sandbox: review plans before you approve them.

## What you should do

- **Never expose the dashboard to the internet.** No port forwarding, no Tailscale Funnel, no public reverse proxy. For your phone, use a private network such as Tailscale Serve ([docs/phone-and-push.md](docs/phone-and-push.md)).
- Keep `.claude/settings.json` permissions narrow. They decide which commands teammates may run without asking you.
- Don't share `state.json`, `inbox.jsonl`, `work/`, `uploads/`, `logs/`, `config.json`, keys or agent memories. `.gitignore` keeps them out of git.
- Remember that the work runs through Claude Code, so card contents and files the teammates read are sent to Anthropic like any Claude Code session.

## Reporting a vulnerability

Please don't open a public issue for a security problem.

<!-- TODO(user): enable GitHub private vulnerability reporting on the repo, or give a contact email here. -->
Use GitHub's **Report a vulnerability** button on the repository's Security tab. Include what you found, how to reproduce it, and which version or commit you tested. You should get a first answer within a week.

Supported version: the latest commit on `main`.
