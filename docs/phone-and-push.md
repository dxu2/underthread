# Phone and push notifications

The dashboard works on a phone as a home-screen app, with push notifications for decisions and replies. Because the dashboard only listens on `127.0.0.1`, the phone reaches it through a private network. The easiest way is **Tailscale Serve**, which also gives you the https address that push needs.

## 1. Reach the dashboard from your phone (Tailscale Serve)

1. Install [Tailscale](https://tailscale.com) on the computer that runs Underthread and on your phone, and sign both in to the same tailnet.
2. On the computer, publish the dashboard to your tailnet only (not the internet):

   ```bash
   tailscale serve --bg 8765
   ```

   Tailscale prints an address like `https://<machine>.<tailnet>.ts.net`. (Older Tailscale versions use a different `serve` syntax; see `tailscale serve --help`.)
3. Open that https address on your phone.

The dashboard accepts any `*.ts.net` host name. For another host name (your own reverse proxy, say), add it to `allowed_hosts` in `config.json`.

**Do not use Tailscale Funnel** or any other way of putting the dashboard on the public internet. It has no login. See [SECURITY.md](../SECURITY.md).

## 2. Add it to your home screen

- **iPhone (Safari):** Share → **Add to Home Screen**. Then open Underthread from the home-screen icon, not from Safari. On iPhone, push only works from the home-screen app (iOS 16.4 or newer).
- **Android (Chrome):** menu → **Add to Home screen** / **Install app**.

It opens full screen with a floating tab bar. Long-press a tab icon to see its name; pull down to refresh.

## 3. Turn on push

1. In the home-screen app, open **Settings → Notifications** (in the Chinese interface: 设置 → 推送通知).
2. Turn notifications on and allow them when the phone asks.
3. Use **Test** to send yourself one.

Per device you can choose:

| Setting | Options | Default |
|---|---|---|
| What to send | Decisions only · decisions and replies · everything | Decisions and replies |
| Quiet hours | On/off, from–to | On, 23:00 to 09:00 |
| Morning digest | A short summary of what came in during quiet hours | On |

### How it works

- On first use the server creates a VAPID key pair in `vapid.json` (mode 600, ignored by git). Subscriptions are stored in `push_subs.json`, also ignored by git. Nothing to configure.
- Pushes carry **no content**. The phone wakes up and fetches the text from your own dashboard (`/api/push/latest`), so the push service (Apple, Google, Mozilla) never sees your cards.
- `python3 tools/webpush.py selftest` checks the signing code (needs `openssl`).

### If push doesn't work

| Symptom | Fix |
|---|---|
| Settings says it needs https | Open the `https://….ts.net` address, not `http://` or an IP |
| iPhone: says to add to home screen first | Add it, then open it from the home-screen icon |
| iPhone: blocked | iOS Settings → Notifications → Underthread → Allow |
| Test sends nothing | Look at `logs/server.log`; the phone reports each step of turning push on there |
| Nothing at night | Quiet hours. Check the digest in the morning, or change the hours |

## Saving images

On the phone you can save any image on a card at full size (not the thumbnail): open the image and use the save button.
