# Environment — reproducing a working setup

**Goal:** A new machine can install dependencies, configure env vars, and run `node index.js` with the same classes of features (Discord, MC line charts, optional X) without guesswork.

**Related:** `docs/SYSTEM_MAP.md`, `package.json`, `.gitignore` (`.env` is not committed).

---

## 1. Node.js

### 1.1 Version used and tested (reference)

| Check | Result (last verified in-repo) |
|-------|----------------------------------|
| **Node** | **v24.14.1** |
| **Platform** | **Windows 11** (Win32 NT 10.0.26200), **x64** |

**Smoke tests that passed on that stack:**

- `require('chartjs-node-canvas')` — OK  
- `require('canvas')` — OK (native module reported **3.2.3**)  
- `ChartJSNodeCanvas` → `renderToBuffer` PNG — OK  
- `playwright` `chromium.launch({ headless: true })` — OK  
- `npx playwright --version` — **1.58.2** (matches `package.json`)

### 1.2 Recommended policy

- Use a **current LTS or the version above** for parity. The repo does not declare an `engines` field in `package.json`; consider adding `"engines": { "node": ">=20" }` (or tighter) once you settle on a minimum.
- **Changing Node major/minor** almost always requires **reinstalling or rebuilding native addons** (see §6).

---

## 2. OS / platform notes

| OS | Notes |
|----|--------|
| **Windows 10/11** | Common dev setup. `canvas` often installs via **prebuilt binaries**; if prebuild is missing for your Node ABI, npm falls back to **compiling** (needs Python + VS Build Tools — see §4.1). |
| **Linux (VPS)** | Typical production host. `canvas` may need **system libraries** for build or runtime (see §4.1). No monitor required: chart rendering is **off-screen** (node-canvas). |
| **macOS** | Similar to Linux for `canvas`; use Homebrew deps if compile is required. |

**Architecture:** **x64** assumed; **ARM** (e.g. some VPS or Apple Silicon) may have different `canvas` prebuild availability — expect `npm install` to compile more often.

---

## 3. Native dependency chain (charts)

| Package | Role |
|---------|------|
| **`chartjs-node-canvas@^5`** | Renders Chart.js on a server-side canvas. |
| **`canvas@^3`** (dependency of chartjs-node-canvas) | **Native** Node binding (Cairo/Pango stack under the hood, depending on build). |

**Runtime requirement:** Any code path that calls `renderPriceChart` (`utils/renderChart.js`) **must** have a working `canvas` install. If `require('canvas')` throws, the bot may still start but **call/bot chart hydration will fail** for those messages.

---

## 4. Install steps

### 4.1 Project install (all platforms)

From the repository root:

```bash
npm install
```

Create `.env` in the project root (see §8). Then:

```bash
node index.js
```

(`index.js` calls `require('dotenv').config()` so variables load from `.env` by default.)

### 4.2 `canvas` — when `npm install` fails or runtime errors

**Symptoms:** Errors mentioning `canvas`, `node-gyp`, Cairo, `pkg-config`, or missing `.node` binary.

**Windows**

- Prefer letting npm use a **prebuild** for your exact Node version.
- If compilation is required: install **Visual Studio Build Tools** (C++ workload) and **Python 3.x** for `node-gyp`, then run `npm install` again from the project directory.

**Debian/Ubuntu-style Linux (typical VPS)**

Install development headers before `npm install` if the binary is not available:

```bash
sudo apt-get update
sudo apt-get install -y build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
```

(Package names vary on Alpine/RHEL; adjust accordingly.)

**After Node upgrades**

```bash
npm rebuild canvas
```

or a clean reinstall:

```bash
rm -rf node_modules package-lock.json
npm install
```

(Only delete `package-lock.json` if you intentionally want to resolve fresh — usually keep it for reproducibility.)

### 4.3 Playwright

**Is it required for the main bot?** **No.** The running app entry (`index.js`) does not `require('playwright')`. Playwright is listed in `package.json` and is used only by **unused** `providers/holderIntelligenceProvider.js` in the current module graph.

**If you use Playwright** (that provider or future scraping):

1. Dependencies are installed with `npm install`.
2. **Browsers** are not always bundled in `node_modules`; download them:

```bash
npx playwright install chromium
```

3. On **Linux VPS**, system deps may be needed for headless Chromium:

```bash
npx playwright install-deps
```

(sudo may be required; distro-specific.)

**To reduce footprint** if you delete Playwright from the project: remove it from `package.json` and run `npm install` again — **why:** smaller deploys and no accidental security surface.

---

## 5. Known issues when changing Node versions

| Issue | Cause | Mitigation |
|-------|--------|------------|
| `canvas` load error after `nvm install` / Node upgrade | Native module tied to **Node ABI** | `npm rebuild canvas` or reinstall `node_modules` |
| Different `npm` / Node on PATH in systemd vs shell | Service unit uses minimal env | Set absolute path to Node in service file, or `nvm`/`fnm` hook for the service user |
| `chartjs-node-canvas` version vs `chart.js` mismatch | Major bumps | Stay on versions resolved in `package-lock.json` unless you test renders |
| Odd TLS / `fetch` behavior | Very old Node | Use Node **18+** (global `fetch` used in `chartCapture.js`) |

---

## 6. VPS vs local development

| Topic | Local dev | VPS |
|-------|-----------|-----|
| **Display** | Not needed for bot or charts | Same |
| **Process manager** | Manual terminal / IDE | **systemd**, **pm2**, or container with restart policy |
| **Secrets** | `.env` file | `.env` or host env injection (**do not** commit secrets) |
| **Outbound network** | Discord, DexScreener, GeckoTerminal, X API | Same; ensure **firewall allows HTTPS outbound** |
| **Disk** | Small | `data/*.json` grows; plan backups |
| **Playwright** | Optional | Heavier; prefer **not** installing browsers on VPS unless required |
| **`canvas`** | Prebuild common on Windows | May compile on slim images — use a **non-Alpine** image or install §4.2 deps in Dockerfile |

**Discord:** Bot needs a valid **token** and **intents** as configured in the Discord Developer Portal (`Message Content` intent is used per `index.js`).

---

## 7. Runtime environment variables

Loaded via **`dotenv`** from **`.env`** in the project root (unless the host injects env vars another way).

### 7.1 Required for core bot

| Variable | Used in | Purpose |
|----------|---------|---------|
| **`DISCORD_TOKEN`** | `index.js` | `client.login` — bot cannot start without it. |

**Optional — member join & human verify (`index.js`):**

| Variable | Purpose |
|----------|---------|
| **`DISCORD_UNVERIFIED_ROLE_ID`** | Discord role snowflake assigned automatically to **non-bot** members on `guildMemberAdd`. Skipped if the member already has this role or the verified role. If **`DISCORD_GUILD_ID`** is set, assignment only runs in that guild. Requires the bot role **above** this role in Server Settings → Roles and **Manage Roles** permission. |
| **`HUMAN_VERIFIED_ROLE_ID`** | Snowflake added when the user passes the **Verify** math check in the verification channel (default `1482446226027843757` if unset). |
| **`HUMAN_VERIFY_CHANNEL_NAME`** | Text channel **name** where the bot posts the verify embed (default `verification`). Must match your channel name exactly. |

After a successful verify, the bot adds **`HUMAN_VERIFIED_ROLE_ID`** and removes **`DISCORD_UNVERIFIED_ROLE_ID`** when that env is set, so members do not keep both roles.

### 7.2 Required for owner-only commands

| Variable | Used in | Purpose |
|----------|---------|---------|
| **`BOT_OWNER_ID`** | `index.js`, `commands/basicCommands.js` | Discord user snowflake; gates `!testx`, `!testweeklysnapshot`, `!setminmc`, sanity `!setsanity*`, etc. If unset, owner checks fail closed where implemented. |

### 7.3 Required for X (Twitter) posting

| Variable | Used in | Purpose |
|----------|---------|---------|
| **`X_API_KEY`** | `utils/xPoster.js` | OAuth 1.0a consumer key |
| **`X_API_SECRET`** | `utils/xPoster.js` | Consumer secret |
| **`X_ACCESS_TOKEN`** | `utils/xPoster.js` | Access token |
| **`X_ACCESS_TOKEN_SECRET`** | `utils/xPoster.js` | Access token secret |

If any are missing, `createPost` throws **“Missing X API credentials”** when invoked. Discord flows that do not call X still run.

**Optional — X copy & digest (`utils/buildXPostText.js`, `utils/xLeaderboardDigest.js`, `utils/monitoringEngine.js`):**

| Variable | Purpose |
|----------|---------|
| **`X_TWEET_MAX_CHARS`** | Default `280`. Long-form (e.g. `25000`) is honored up to **`X_TWEET_CHAR_HARD_CAP`** (default `25000`). Strip spaces; avoid wrapping the value in quotes in `.env` unless the whole value is quoted normally. |
| **`X_TWEET_CHAR_HARD_CAP`** | Optional; default `25000`. Clamps `X_TWEET_MAX_CHARS` so copy builders stay within API limits. |
| **`X_WEEKLY_STATS_MAX_CHARS`** | Optional. When set (e.g. `25000`), the **weekly stats snapshot** uses this budget even if `X_TWEET_MAX_CHARS` is missing on the bot host (prevents silent 280 truncation). |
| **`X_POST_INCLUDE_GMGN`** | `1` / `true` — append GMGN link (uses more characters). |
| **`X_AUTO_APPROVE_USER_CALLS`** | `1` / `true` — **user_call** rows skip `#mod-approvals` for X and go straight to `xApproved` (bot_call still needs mod approve). |
| **`X_LEADERBOARD_DIGEST_ENABLED`** | `1` / `true` — enable scheduled digest tweets (off by default). |
| **`X_LEADERBOARD_DIGEST_UTC_HOUR`** | Hour `0–23` to post (default `16`). |
| **`X_LEADERBOARD_WEEKLY_DIGEST_ENABLED`** | `0` / `false` to skip the weekly snapshot (default on when digest is enabled). |
| **`X_LEADERBOARD_WEEKLY_UTC_WEEKDAY`** | `0` (Sun) … `6` (Sat); default `1` (Monday). |
| **`X_WEEKLY_STATS_SNAPSHOT_ENABLED`** | `1` / `true` — post a **stats-only** weekly X summary (previous completed UTC Mon–Sun); **independent** of `X_LEADERBOARD_DIGEST_ENABLED`. |
| **`X_WEEKLY_STATS_UTC_WEEKDAY`** | `0`–`6`; default `1` (Monday). |
| **`X_WEEKLY_STATS_UTC_HOUR`** | `0`–`23`; defaults to the same value as `X_LEADERBOARD_DIGEST_UTC_HOUR` (or `16`). |
| **`X_WEEKLY_SNAPSHOT_CALLER_TOP_N`** | Optional; default `15` (max `25`). Rows on the weekly snapshot caller desk. |
| **`X_WEEKLY_SNAPSHOT_PRINT_TOP_N`** | Optional; default `12` (max `25`). Top user / top auto print lists on the weekly snapshot. |
| **`DASHBOARD_PUBLIC_URL`** | Shown at the bottom of digest tweets (any of `NEXT_PUBLIC_APP_URL` / `MCBOT_DASHBOARD_URL` also work). |

### 7.4 Optional — Supabase (Discord bot, repo root)

Used only when referral rows are mirrored to Postgres (`utils/referralService.js`). If unset, referral **file** tracking still works; Supabase insert is skipped when `getSupabase()` is never reached, or will error only if code paths call it without env.

| Variable | Used in | Purpose |
|----------|---------|---------|
| **`SUPABASE_URL`** | `utils/supabaseClient.js` | Supabase project URL |
| **`SUPABASE_ANON_KEY`** | `utils/supabaseClient.js` | Anon key for server-side bot inserts |

**Dashboard note:** `mcgbot-dashboard/` uses the same variable **names** but reads from **its own** env (e.g. `.env.local` / Vercel). Keep projects aligned deliberately.

### 7.5 Optional (unused in default graph)

| Variable | Used in | Notes |
|----------|---------|--------|
| **`BIRDEYE_API_KEY`** | `providers/birdeyeProvider.js`, `holderIntelligenceProvider.js` | **Not** loaded by `index.js` today; only if you wire those modules. |

### 7.6 Not in code (documentation-only)

Some docs mention vars (e.g. milestone chart toggles) that **do not** appear in `process.env` greps — treat as **not implemented** until code references them.

---

## 8. Minimal reproduction checklist

1. Install **Node** (see §1).  
2. Clone repo, `npm install`.  
3. Confirm `node -e "require('canvas'); require('chartjs-node-canvas'); console.log('ok')"` prints `ok`.  
4. Create `.env` with at least `DISCORD_TOKEN` (and `BOT_OWNER_ID` if you need owner commands).  
5. Run `node index.js`.  
6. If using X posting, add all four `X_*` variables and test with `!testx` (owner only).  
7. If you enable Playwright-based code, run `npx playwright install chromium` (and `install-deps` on Linux if needed).  
8. If you want **referral rows mirrored to Supabase**, add `SUPABASE_URL` and `SUPABASE_ANON_KEY` to the **root** `.env` (see §7.4); otherwise the bot still tracks referrals in `data/referrals.json` without Postgres.

---

## 9. Updating this document

When you verify on a **new Node version** or **new OS**, update §1.1 and any install notes that differ. When you add env vars in code, update §7.

---

*Last aligned with dependency versions in `package.json` and runtime checks documented in this file.*
