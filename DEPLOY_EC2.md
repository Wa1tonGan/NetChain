# NetChain on AWS EC2 — Docker deployment guide

One box, plain HTTP, no OAuth (zkLogin is not part of the stack), real Sui
testnet transactions. Everything runs as three Docker containers:

| Container  | What runs                                                        | Port (public) |
|------------|------------------------------------------------------------------|---------------|
| `agents`   | 3 provider agents (8101–8103) + Rescue gateway (8082) + Truth Agent (8105) | **8082** |
| `trust`    | Sui trust server — escrow commit/settle/archive/audit (8200)      | **8200** |
| `frontend` | nginx serving the built React app + `/v1` and `/suirpc` proxies   | **80** |

The browser talks **directly** to the gateway and trust server (both send
`CORS *`), so all three ports must be reachable. Provider/claim ports stay
container-internal.

> Demo signing paths: **agent-signed** (default — the RescueAgent pays from the
> pre-funded testnet escrow pool with the platform key) or the visitor's
> **Slush wallet**. No Google login, no HTTPS, no domain required.

---

## 0. Prerequisites (on your dev machine, one time)

1. A working local setup — you have run the demo locally at least once, which
   means you already have:
   - `.env` containing `PLATFORM_SECRET` (the platform operator key that owns
     the testnet escrow), and
   - `.sui/config.testnet.json` (the testnet package/escrow/treasury ids).
2. Your code pushed to a git remote (GitHub etc.) you can pull from EC2.
3. Slush (or any Sui-standard) wallet extension installed in the demo browser
   if you plan to show the wallet-signing path.

---

## 1. Launch the EC2 instance

1. AWS Console → **EC2 → Launch instance**.
2. Configure:
   - **AMI:** Ubuntu Server 24.04 LTS
   - **Type:** `t3.small` (2 GB RAM — the free-tier `t2.micro`'s 1 GB is tight
     for five Node processes; a `t3.micro` also works if you add 1 GB swap)
   - **Storage:** 20 GB gp3
   - **Key pair:** create/download one (`netchain-demo.pem`)
3. **Security group** — create `netchain-demo-sg` with:

   | Type        | Port | Source        | Why                          |
   |-------------|------|---------------|------------------------------|
   | SSH         | 22   | Your IP /32   | admin only                   |
   | HTTP        | 80   | 0.0.0.0/0     | the app (nginx)              |
   | Custom TCP  | 8082 | 0.0.0.0/0     | gateway — browser connects   |
   | Custom TCP  | 8200 | 0.0.0.0/0     | trust server — browser connects |

   It's testnet-only and stateless apart from the ledger — `0.0.0.0/0` is fine
   for a hackathon. Lock 8082/8200 to your audience's IPs if you prefer.
4. Launch, then note the **Public IPv4 address** (e.g. `3.12.34.56`).

---

## 2. Install Docker on the box

```bash
ssh -i netchain-demo.pem ubuntu@<EC2_PUBLIC_IP>

# Docker engine + compose plugin
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
newgrp docker          # or log out/in once

docker --version && docker compose version   # sanity check
```

---

## 3. Get the code

```bash
git clone <YOUR_REPO_URL> netchain
cd netchain
```

(Private repo without deploy keys? Easiest: push to GitHub over HTTPS once, or
`rsync -av --exclude node_modules --exclude .git -e "ssh -i netchain-demo.pem" ./ ubuntu@<EC2_PUBLIC_IP>:~/netchain/`)

---

## 4. Copy the two secrets from your dev machine

These are gitignored, so transfer them explicitly — **run this from your dev
machine**, not the box:

```bash
scp -i netchain-demo.pem .env ubuntu@<EC2_PUBLIC_IP>:~/netchain/.env
ssh -i netchain-demo.pem ubuntu@<EC2_PUBLIC_IP> "mkdir -p ~/.sui"
scp -i netchain-demo.pem .sui/config.testnet.json ubuntu@<EC2_PUBLIC_IP>:~/.sui/
```

- `.env` carries `PLATFORM_SECRET` — **must be the same key** that owns the
  testnet escrow, or commits/settlements will fail signature checks.
- `.sui/config.testnet.json` carries the deployed package/escrow/treasury ids —
  the trust server refuses to start without it.

---

## 5. Configure the box's `.env` for Docker

Back on the EC2 box:

```bash
cd ~/netchain
cp .env.docker.example .env.local   # reference copy (optional)
nano .env
```

Make sure `.env` contains at least:

```ini
SUI_NETWORK=testnet
PLATFORM_SECRET=<same value as your dev .env>
PUBLIC_IP=<EC2_PUBLIC_IP>            # e.g. 3.12.34.56
GONKA_API_KEY=<your gonka key>       # optional — see note
```

**`PUBLIC_IP`** is baked into the frontend bundle at build time. **`GONKA_API_KEY`**
is optional: without it the market still runs end-to-end, but you lose the
multi-LLM Round-1 vote cards and the Round-2 audit reports TIMEOUT (the modal
shows that honestly). Bring the key for the full demo.

---

## 6. Build and start

```bash
docker compose build          # backend image + frontend image (Vite build)
docker compose up -d
docker compose ps             # all three containers "Up (healthy)" after ~30s
```

Useful day-2 commands:

```bash
docker compose logs -f agents          # gateway/provider/claim logs
docker compose logs -f trust           # trust server logs
docker compose restart agents
docker compose down                    # stops everything (ledger persists)
```

---

## 7. Verify

From the box:

```bash
curl http://127.0.0.1:8082/health
# {"healthy":true,...}
curl "http://127.0.0.1:8200/v1/events/recent?limit=1"
# {"events":[...]} — the ledger tail
curl -s http://127.0.0.1/ | head -c 120
# <!doctype html> — nginx serving the app
```

From any machine with internet (this proves the security group + CORS paths):

1. Open `http://<EC2_PUBLIC_IP>/` — the subscriber list loads.
2. Click any subscriber → **Run Simulation (Relocate KL → Penang)**.
3. The recovery modal should stream the real narrative: 3 live bids → Gonka
   votes with request ids → escrow tx link (Suiscan testnet) → telemetry →
   Truth-Agent audit → settled, with real on-chain tx + Walrus links.
4. Check Suiscan actually resolves the tx digest shown in the modal.

---

## 8. Demo rehearsal checklist

- [ ] Run one full recovery from the EC2 box URL and let it settle (first run
      warms everything up; Sui testnet can be slow — commits sometimes take
      30–90 s, the modal honestly shows "Locking Sui dual-sig escrow…" while it
      waits).
- [ ] Refresh the page and run once more — the app should behave identically.
- [ ] If you demo the wallet path: connect Slush **from a second machine**
      against the EC2 URL once before showtime (browser-side signing behaves
      the same, but confirm once). Agent-signed mode (the default) needs no
      wallet at all.
- [ ] Kill-a-provider beat: the `start-all.mjs` flags are forwarded to the
      provider agents, so override the agents command in `docker-compose.yml`:
      ```yaml
      command: ["node", "scripts/start-all.mjs", "--mode=PROVIDER-A:down"]
      ```
      then `docker compose up -d agents` (and revert + up again afterwards).
- [ ] Have a fallback: `docker compose down && docker compose up -d --build`
      rebuilds everything from scratch in ~2 minutes.

---

## 9. Troubleshooting

| Symptom | Check / fix |
|---|---|
| `trust` container exits with "no .sui/config.json" | `.sui/config.testnet.json` missing — redo step 4. |
| Commits fail with signature/authority errors | `PLATFORM_SECRET` differs from the key that owns the testnet escrow. Copy the exact value from your dev `.env`. |
| Frontend loads but "Agent market unreachable" | Gateway not reachable from the **browser** — security group must allow 8082 from the visitor's IP. Test `curl http://<EC2_PUBLIC_IP>:8082/health` from the visitor's machine. |
| Votes/audit cards show TIMEOUT | `GONKA_API_KEY` missing/invalid, or the inference endpoint is slow — the flow completes regardless (by design). |
| Bid numbers are all identical across runs | `PROVIDER_SEED` is set in `.env` — unset it for a fresh market per launch. |
| Page loads but wallet balance shows "…" forever | The `/suirpc` JSON-RPC proxy can't reach the public fullnode — `docker compose logs frontend`, then retry (publicnode occasionally rate-limits). |
| Changed `PUBLIC_IP` but app still calls the old IP | Vite env is build-time: `docker compose build frontend && docker compose up -d frontend`. |
| Out of memory / containers dying | `free -h` — add 1 GB swap: `sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile`. |

---

## 10. Security notes

- Only 22/80/8082/8200 are open; keep SSH restricted to your IP.
- `PLATFORM_SECRET` is a live testnet key — never commit it, never bake it
  into images (compose injects it at runtime; `.dockerignore` excludes `.env`).
- The ledger (`./events/reliability-events.jsonl`) is the only persistent
  state and survives `docker compose down`.
- Testnet only — nothing here should ever point at mainnet.
