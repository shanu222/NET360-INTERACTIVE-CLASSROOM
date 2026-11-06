# Your own LiveKit audio server

Unlimited class audio for the price of a small server, instead of paying per minute.

## What you need

- A small **Ubuntu 22.04 / 24.04** server (2 CPU, 2–4 GB RAM is plenty for audio).
  Pick a location near your students (e.g. Singapore for Pakistan).
- A **subdomain** you control, e.g. `audio.yourdomain.com`.

## Steps

1. **DNS:** create an **A record** for `audio.yourdomain.com` pointing to the server's
   public IP. Wait until it resolves (usually a few minutes).
2. **Copy and run the script** (from your computer):

   ```bash
   scp deploy/livekit/setup.sh root@SERVER_IP:/root/
   ssh root@SERVER_IP "bash /root/setup.sh audio.yourdomain.com"
   ```

3. **Railway → Variables:** paste the three lines the script prints:

   ```
   LIVEKIT_URL=wss://audio.yourdomain.com
   LIVEKIT_API_KEY=API…
   LIVEKIT_API_SECRET=…
   ```

4. After Railway redeploys, open `https://<your-railway-app>/api/health`; it should show
   `"audio": true`. Refresh the class pages and the mic buttons appear.

## What the script does

- Installs Docker.
- Opens these ports: 22, 80, 443, 7881/tcp, 3478/udp, 30000–40000/udp and 50000–60000/udp.
  If your provider also has a **cloud firewall** (in its web dashboard), open the same ports there.
- Creates private API keys (kept in `/opt/meeto360-livekit/.env`).
- Runs LiveKit (v1.13.11) and Caddy, which gets and renews the HTTPS certificate automatically.
- Restarts both automatically after a reboot.

Running it again is safe: it keeps the same keys.

## Useful commands (on the server)

```bash
cd /opt/meeto360-livekit
docker compose ps             # are both running?
docker compose logs -f        # live logs
docker compose pull && docker compose up -d   # update
```
