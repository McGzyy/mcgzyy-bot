# Deployment guide

**Goal:** Repeatable, safe deployment: local smoke runs, VPS production layout, **process management** (supervision, restarts, logs), **data safety** (no accidental wipe on deploy, backups), and **common failure** patterns.

**Prerequisites:** See `docs/ENVIRONMENT.md` for Node version, native deps (`canvas`), Playwright notes, and detailed env var semantics.

---

## 1. How to run the bot locally

1. **Install Node.js** and clone the repository (see `ENVIRONMENT.md` §1–§4).
2. From the project root:

   ```bash
   npm install
   ```

3. Create **`.env`** in the project root with at least `DISCORD_TOKEN` (and other vars per §4).
4. Start the process:

   ```bash
   node index.js
   ```

5. **Verify:** Logs should show Discord login success; on ready, the bot resolves **`#bot-calls`** and may start monitoring/auto-call if `data/botSettings.json` has `scannerEnabled: true` (default).

**Stopping locally:** `Ctrl+C` in the terminal.

**Note:** The app is a **single long-lived Node process**. There is no built-in cluster mode in-repo.

---

## 2. How to run on a VPS

### 2.1 Recommended layout

Deploy the **same repository tree** you use locally (git clone or rsync). Do **not** omit `package.json` / `package-lock.json`.

Typical paths (example):

```
/opt/mcgbot/          # or ~/crypto-scanner
  index.js
  package.json
  package-lock.json
  .env                  # create on server; never commit
  commands/
  config/
  data/                 # created/used at runtime
  docs/
  node_modules/         # from npm install on the server
  providers/
  utils/
```

### 2.2 Install on the server

```bash
cd /opt/mcgbot
npm ci
```

(`npm ci` respects `package-lock.json` — preferred for reproducible deploys.)

Ensure **Linux canvas build deps** if needed (`ENVIRONMENT.md` §4.2).

### 2.3 Process supervision

Run under a **supervisor** so crashes and reboots do not require manual SSH. Compare **systemd**, **PM2**, and **manual** runs, plus restart and log practices, in **§3 Process management**.

### 2.4 Network

- **Outbound HTTPS** to Discord API, DexScreener, GeckoTerminal, and (if used) X API must be allowed.
- **Inbound:** Only if you expose a health endpoint (none in-repo); the bot is **outbound-only** to Discord.

---

## 3. Process management

How the Node process is kept alive, restarted, and observed in production.

### 3.1 systemd vs PM2 vs manual

| Approach | Best for | Pros | Cons |
|----------|----------|------|------|
| **systemd** | Linux VPS, single service | OS-native, boot integration, `journalctl`, resource limits via unit | Requires root or polkit for unit install |
| **PM2** | Node-first ops | `pm2 restart`, clustered future option, built-in log tail | Extra dependency; learn PM2’s persistence (`pm2 save` / startup hook) |
| **Manual** (`node index.js`, `screen`, `tmux`, `nohup`) | Quick tests, debugging | No extra tooling | **No** auto-restart on crash; easy to lose the session; **not** recommended for production |

The repo does **not** ship Docker, PM2 ecosystem files, or a sample Dockerfile—pick one of the above and document it for your host.

**systemd sketch** (dedicated user, adjust paths and unit name):

```ini
[Unit]
Description=McGBot Discord scanner
After=network-online.target

[Service]
Type=simple
User=mcgbot
WorkingDirectory=/opt/mcgbot
EnvironmentFile=/opt/mcgbot/.env
ExecStart=/usr/bin/node index.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Then: `sudo systemctl daemon-reload`, `sudo systemctl enable --now mcgbot.service`.

**PM2 sketch:**

```bash
cd /opt/mcgbot
pm2 start index.js --name mcgbot
pm2 save
pm2 startup   # follow printed instructions so it survives reboot
```

**Why supervision matters:** Uncaught errors or Discord disconnects can exit the process; production should **recover** without an operator online.

### 3.2 Restart strategies

| Strategy | Typical config | When to use |
|----------|----------------|-------------|
| **Restart on failure** | systemd `Restart=on-failure` + `RestartSec=10`; PM2 default | Normal production—picks up after crashes and transient API/network errors |
| **Restart always** | `Restart=always` | Rarely needed; can mask a boot loop if the app exits immediately on bad config—prefer **on-failure** until stable |
| **Deploy restart** | `systemctl restart mcgbot` or `pm2 restart mcgbot` after `git pull` / `npm ci` | Required to load new code; expect **brief downtime** and cleared **in-memory** state (see §8.1) |
| **No auto-restart** | Manual `node` only | Development only |

**Operational rules:**

- **Never** run **two** bot processes with the **same** Discord token—Discord disconnects one side and both may corrupt `data/*.json` if they write concurrently.
- After changing `.env`, **restart** the process so `dotenv` / the service reload picks up values.

Quick command reference also appears in **§5**.

### 3.3 Log handling

| Supervisor | View live logs | Persistence / rotation |
|------------|----------------|----------------------|
| **systemd** | `journalctl -u mcgbot -f` (unit name as you named it) | `journald` retention (`/etc/systemd/journald.conf`); or forward to your log stack |
| **PM2** | `pm2 logs mcgbot` | PM2 log files under `~/.pm2/logs/`; use **`pm2 install pm2-logrotate`** or host logrotate to avoid disk fill |
| **Manual** | Terminal only unless you redirect | Redirect stdout/stderr to a file **and** configure **logrotate** (or accept loss on crash) |

**What to grep for in this codebase:** `[Monitor]`, `[AutoCall]`, `[CallChart]`, `[XPoster]`, Dex/Gecko errors, Discord rate-limit messages.

**Disk:** Unbounded logs (especially PM2 defaults) can fill the VPS—treat log rotation as part of deploy (see §10 checklist).

---

## 4. Required environment variables

| Variable | Required? | Purpose |
|----------|------------|---------|
| **`DISCORD_TOKEN`** | **Yes** (production) | Bot login. |
| **`BOT_OWNER_ID`** | **Strongly recommended** | Owner-only commands; some checks fail closed if unset. |
| **`X_API_KEY`**, **`X_API_SECRET`**, **`X_ACCESS_TOKEN`**, **`X_ACCESS_TOKEN_SECRET`** | **If** you use X posting | OAuth 1.0a for `utils/xPoster.js`. |
| **`BIRDEYE_API_KEY`** | **No** (default graph) | Only if you wire unused Birdeye/holder modules. |

**Loading:** `index.js` calls `dotenv.config()` — place variables in **`.env`** next to `index.js`, or inject them via systemd `Environment=` / `EnvironmentFile=` / your host panel (see **§3**).

**Secrets:** Never commit `.env`. `.gitignore` already excludes `.env`.

Full detail: `docs/ENVIRONMENT.md` §7.

---

## 5. How to start / stop / restart the bot

Quick reference; supervision choices and log commands are in **§3**.

### 5.1 Process level

| Action | Local | systemd | pm2 (example) |
|--------|-------|---------|------------------|
| **Start** | `node index.js` | `systemctl start mcgbot` | `pm2 start index.js --name mcgbot` |
| **Stop** | Ctrl+C | `systemctl stop mcgbot` | `pm2 stop mcgbot` |
| **Restart** | Stop + start | `systemctl restart mcgbot` | `pm2 restart mcgbot` |

### 5.2 Scanner loops (in-process)

While the **Node process** is running, **monitoring** and **auto-call** loops can be toggled from Discord **without** restarting the process:

- **`!scanner on`** — starts `startMonitoring` + `startAutoCallLoop` on `#bot-calls` (requires **Manage Server**).
- **`!scanner off`** — stops both loops.

State is persisted in **`data/botSettings.json`** (`scannerEnabled`).

**Why two layers:** Restarting the OS service **re-reads** `botSettings.json` on `clientReady` — if `scannerEnabled` is false, loops do **not** auto-start until `!scanner on` or manual edit.

---

## 6. Expected folder structure on the server

Minimum for runtime:

| Path | Role |
|------|------|
| `index.js` | Entry |
| `package.json`, `package-lock.json` | Dependencies |
| `commands/`, `config/`, `providers/`, `utils/` | Application code |
| `node_modules/` | Installed deps (`npm ci` / `npm install`) |
| `.env` | Secrets (create on server) |
| **`data/`** | JSON persistence (see §7) |

Optional: `docs/` for operators; not required at runtime.

**Do not rely on** `browser-profile/` or large `debug/` artifacts for production — they are not part of the documented deploy contract.

---

## 7. Data files — storage and backup

### 7.0 Data persistence on deploy (warning)

**Do not** delete or overwrite **`data/*.json`** as part of a normal code deploy. These files are **live state** (calls, settings, profiles), not build artifacts. A fresh `git clone`, a careless `rsync`, or a CI step that syncs the whole tree can **wipe months of history** if it replaces `data/`.

- **Exclude `data/`** from automated deploy syncs when the server already has production data (e.g. `rsync --exclude 'data/'`, or deploy to a new release directory and keep `data/` on a stable symlink).
- **Back up before** upgrades that might touch the tree (see §7.2).
- **Restore** only while the bot is **stopped**, then validate JSON (§7.2).

### 7.1 Files

All under **`data/`** (paths relative to project root):

| File | Contents |
|------|-----------|
| `trackedCalls.json` | All tracked calls (large; hot path for reads/writes) |
| `userProfiles.json` | Caller profiles, X verification state |
| `trackedDevs.json` | Dev registry |
| `scannerSettings.json` | Live thresholds, approval ladder overrides |
| `botSettings.json` | `scannerEnabled` flag |

The service **creates** missing JSON files with defaults where coded (e.g. empty array, `{}`).

### 7.2 Backup strategy

**Why backup:** These files **are** the database. Loss or corruption loses call history, approvals, and settings.

**Recommended:**

1. **Stop the bot** or accept a small consistency window (whole-file rewrite means a crash mid-write could corrupt one file — rare but possible).
2. Copy **`data/*.json`** on a **schedule** (cron/Task Scheduler) and before risky deploys — timestamped files, e.g.  
   `cp data/trackedCalls.json data/trackedCalls.json.bak.$(date +%Y%m%d%H%M)`  
   (`.gitignore` may list `*.backup.json` — align with your policy.)
3. **Off-server copies:** S3, another disk, or your VPS snapshot feature — **why:** disk loss wipes local backups too.
4. **Test a restore** occasionally on a copy so you are not discovering a bad backup during an incident.

**Restore:** Replace files in `data/` while the bot is **stopped**, then start. Validate JSON with `node -e "JSON.parse(require('fs').readFileSync('data/trackedCalls.json'))"`.

### 7.3 Git and deploy workflows

Tracked defaults may exist in git for `data/`; production servers often carry **live** data that should **not** be overwritten by `git pull`. Prefer **backup before pull** or exclude `data/` from deploy overwrites (rsync `--exclude data`).

---

## 8. Common failure scenarios

### 8.1 Bot restarts and in-memory state

The bot keeps **dedupe maps, pacing state, and similar structures in RAM**. A **process restart** (crash, `systemctl restart`, deploy, host reboot) **clears** that memory. After restart:

- **Alert / auto-call dedupe** may briefly behave as if history were empty (duplicate alerts are possible until the next cooldown window).
- **Scanner / auto-call loops** follow **`data/botSettings.json`** on `clientReady` — if `scannerEnabled` is false, loops stay off until `!scanner on` or a manual edit (see §5.2).

**Disk-backed** call history and settings in **`data/*.json`** survive restart **unless** files were lost or overwritten (see §7.0).

### 8.2 Missing channel IDs and Discord wiring

| Problem | Effect | What to check |
|---------|--------|----------------|
| **Guild channel not found** (e.g. “Could not find **#bot-calls**”) | Bot cannot post scans or start loops on the expected channel | Create a text channel whose **name** matches what `index.js` resolves first (commonly **`bot-calls`**). Confirm the bot is in that guild and has **View Channel** + **Send Messages**. |
| **`#mod-approvals`** or other named channels missing | Approval / mod flows break or log errors | Add channels per `SYSTEM_MAP.md` / `index.js` constants, or adjust code to your server layout. |
| **`discordMessageId` / `discordChannelId` null** (often **user** `!call` paths) | Milestone **replies** may not thread on the original call message | Expected until the app persists reply IDs; bot auto-calls usually set these. |

Also verify **role permissions**: embeds, **Attach Files** (charts), and message content intent (see `ENVIRONMENT.md`).

### 8.3 API outages and upstream degradation

| Dependency | Typical symptoms | Mitigation |
|------------|------------------|------------|
| **DexScreener** | Failed scans, stale or missing token/pair data, logged fetch errors | Usually **transient**; watch logs; bad contract addresses stay broken until corrected. Monitor loop may archive coins after repeated bad scans. |
| **GeckoTerminal** | X chart image missing (`chart.png` 404), hydration gaps | Ensure **`pairAddress`** is persisted when possible (`DATA_CONTRACTS.md`); falls back are code-dependent. |
| **X (Twitter) API** | Post failures, auth errors | Confirm OAuth env vars; read logs from `utils/xPoster.js`; respect media and reply rules. |
| **Discord API** | Rate limits, disconnects | Reduce burst posting; alert queue helps; supervisor restarts recover after crashes (§3.2). |

### 8.4 Other symptoms (quick reference)

| Symptom | Likely cause | Mitigation |
|---------|----------------|------------|
| Bot exits on start | Invalid/missing `DISCORD_TOKEN`, network block | Check env, firewall, Discord status |
| Charts missing / `[CallChart]` errors | **`canvas` native module** broken after Node upgrade | `npm rebuild canvas` or reinstall; see `ENVIRONMENT.md` |
| Stale or spammy alerts | **Alert queue** dedupe / cooldown | Tune `utils/alertQueue.js` if needed |
| **Data corruption / clashes** | Two processes one token, or crash mid-write | **Single instance** only; backup before risky ops (§7.2) |

---

## 9. Monitoring

Operational **signals** to watch; **restart policies** and **log commands** are in **§3**.

| Signal | How |
|--------|-----|
| **Process up** | systemd status, `pm2 status`, or external uptime ping — the repo has no HTTP health endpoint today |
| **Logs** | `journalctl -u mcgbot -f` or `pm2 logs` (see §3.3) |
| **Discord** | Bot online indicator; `!ping` / `!status` if enabled |
| **Disk** | `data/*.json` growth; log volume under PM2 or journald |

---

## 10. Deployment checklist (production)

- [ ] Node + `npm ci` on server; `canvas` smoke test (`ENVIRONMENT.md` §8).
- [ ] `.env` present with `DISCORD_TOKEN` (+ `BOT_OWNER_ID`, X vars as needed).
- [ ] Guild has **`#bot-calls`**, **`#mod-approvals`** (if using approval flow), verify/X channels per your `index.js` constants.
- [ ] Bot role permissions: send/read messages, embeds, attach files (charts), use application commands if any.
- [ ] systemd/pm2 unit configured with `WorkingDirectory` and `EnvironmentFile` (§3).
- [ ] Deploy pipeline **preserves** `data/*.json` — never overwrite production state with an empty clone (§7.0).
- [ ] Backup cron or documented manual backup for `data/*.json` (§7.2).
- [ ] Log rotation (journald, PM2 logrotate, or host policy) to avoid disk fill (§3.3).

---

## 11. Related docs

- `docs/ENVIRONMENT.md` — Node, native deps, Playwright, env vars in depth.
- `docs/SYSTEM_MAP.md` — Architecture and channels.
- `docs/DATA_CONTRACTS.md` — `trackedCalls.json` shape.

---

*Update this file when you add Docker, CI deploy, or health endpoints.*
