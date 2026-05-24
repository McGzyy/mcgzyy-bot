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
| **`DISCORD_UNVERIFIED_ROLE_ID`** | Discord role snowflake assigned automatically to **non-bot** members on `guildMemberAdd`. Skipped if the member already has Unpaid, Trencher, or Pro. If **`DISCORD_GUILD_ID`** is set, assignment only runs in that guild. Requires the bot role **above** this role in Server Settings → Roles and **Manage Roles** permission. |
| **`DISCORD_UNPAID_ROLE_ID`** | Role after human verify (verified, not subscribed). **No dashboard access.** Falls back to **`HUMAN_VERIFIED_ROLE_ID`** if unset. |
| **`HUMAN_VERIFIED_ROLE_ID`** | Legacy alias for Unpaid (default `1482446226027843757` if unset). Prefer **`DISCORD_UNPAID_ROLE_ID`**. |
| **`HUMAN_VERIFY_CHANNEL_NAME`** | Text channel **name** where the bot posts the verify embed (default `verification`). Must match your channel name exactly. |

After verify, the bot adds **Unpaid** and removes **Unverified**.

**Dashboard (`mcgbot-dashboard`) — membership ladder (same guild):**

| Variable | Purpose |
|----------|---------|
| **`DISCORD_TRENCHER_ROLE_ID`** | Basic paid members. Falls back to **`DISCORD_PREMIUM_ROLE_ID`**. |
| **`DISCORD_PRO_ROLE_ID`** | Pro paid members. |
| **`DISCORD_UNVERIFIED_ROLE_IDS`** | Optional comma list — deny dashboard if member has any (can include Unverified + Unpaid snowflakes). |
| **`DISCORD_REQUIRED_MEMBER_ROLE_IDS`** | Optional legacy list — require at least one paid role. Prefer Trencher/Pro env vars above. |

Payment (Stripe/SOL) calls **`syncMembershipDiscordRoles`**: active Basic → Trencher; active Pro → Pro; expired → Unpaid.

### 7.2 Required for owner-only commands

| Variable | Used in | Purpose |
|----------|---------|---------|
| **`BOT_OWNER_ID`** | `index.js`, `commands/basicCommands.js` | Discord user snowflake; gates `!testx`, `!testweeklyrunner`, `!testtopcallermonth`, `!testweeklysnapshot`, `!previewdailydigest`, `!previewweeklydigest`, `!previewmonthlydigest`, `!testdailydigest`, `!test7ddigest`, `!testmonthlydigest`, `!setminmc`, sanity `!setsanity*`, etc. If unset, owner checks fail closed where implemented. |

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
| **`X_WEEKLY_STATS_CHAR_FLOOR`** | Optional. Minimum character budget for the **weekly stats snapshot** and **leaderboard digests** (daily/7d X posts from `buildLeaderboardDigestBody`; default **12000**, capped by `X_TWEET_CHAR_HARD_CAP`). Digests used to cap at **280** when only the global default applied — they now share this resolver. |
| **`X_POST_INCLUDE_GMGN`** | `1` / `true` — append GMGN link (uses more characters). |
| **`X_BROADCAST_MILESTONES`** | Comma-separated ATH× rungs posted to **X** (default `10,25,50,100`). Must be ≥ `approvalTriggerX`. Each monitor cycle posts the **lowest unposted** rung the ATH has reached (10→25→50→100 in order). Later rungs are **quote tweets** on the anchor (`xOriginalPostId`). Card/caption **headline uses true ATH** when higher (e.g. broadcast 50× while ATH is 72× → card shows **72×**). |
| **`X_MILESTONE_BURST_ON_APPROVE`** | Max broadcast posts when a mod clicks **Approve** (default `4`). Catches up 10/25/50… in one burst if ATH was already high before approval. |
| **`X_MILESTONE_ATH_CATCHUP_ENABLED`** | Default **on** — if ATH grows **materially** after a broadcast post but **before** the next rung (default: **+20%** or **+12×**, one catch-up per rung), post an **ATH catch-up** (quote-tweet) so a 50× post is not left showing while peak was 72×. |
| **`X_MILESTONE_ATH_CATCHUP_RATIO`** | Min ATH growth vs last posted tweet for catch-up (default `1.2` = 20% above). |
| **`X_MILESTONE_ATH_CATCHUP_MIN_X`** | Min absolute ATH× gain vs last posted tweet for catch-up (default `12`). |
| **`X_MILESTONE_QUOTE_KEEP_MIN_AGE_HOURS`** | Min age before a quote can be **kept** when rotating (default `4`). Younger quotes are replaced (deleted) when a newer milestone posts. |
| **`X_MILESTONE_QUOTE_KEEP_MIN_LIKES`** | Keep quote if age ≥ min hours **and** likes ≥ this (default `10`). |
| **`X_MILESTONE_QUOTE_KEEP_MIN_RETWEETS`** | Keep quote if age ≥ min hours **and** retweets ≥ this (default `2`). Either likes or retweets threshold can qualify. |
| **`X_TERMINAL_CARD_CAPTION`** | Optional override for data-card post captions (milestones + daily/weekly digest cards). Default: `🔹 Tracked live - link in bio 🔹` (caller/stats on the image). |
| **`X_MILESTONE_CAPTION_INCLUDE_BIO_LINE`** | Legacy multi-line captions only (`X_MILESTONE_CAPTION_LEGACY=1`). |
| **`X_TEST_MILESTONE_CALLER_HANDLE`** | X handle for `!testxmilestone user` card/caption (default `McGzyy`). Uses `BOT_OWNER_ID` Discord avatar when set. |
| **`X_MILESTONE_MCGBOT_AVATAR_PATH`** | Optional path to McGBot profile PNG for **bot** milestone cards (default `branding/mcgbot-avatar.png`). |
| **`X_MILESTONE_CAPTION_INCLUDE_LINK`** | Default **off** — set `1` / `true` to also append plain `mcgbot.xyz`. |
| **`X_MILESTONE_CAPTION_INCLUDE_CA`** | Default **off** — set `1` / `true` to append a Dexscreener URL in the caption (stats stay on the card image). |
| **`X_MILESTONE_CAPTION_LEGACY`** | Default **off** — set `1` / `true` for the old one-line caption (`Member call · 25× · TICKER`). |
| **`X_MILESTONE_CARD_LEGACY_FALLBACK`** | Default **on** — if the data card render fails, fall back to the decorative `milestoneHeroImage` PNG. |
| **`X_MILESTONE_MG_LOGO_PATH`** | Optional absolute path to the **MG monogram** PNG (default `branding/0cba4845-0995-4280-be96-efbf30f9010f.png`). Used as a large background watermark + small corner mark on milestone cards. |
| **`X_MILESTONE_MG_WATERMARK_ALPHA`** | Optional `0.03`–`0.2` opacity for the background MG watermark (default `0.09`; ~78% card width). |
| **`X_AUTO_APPROVE_USER_CALLS`** | `1` / `true` — **user_call** rows skip `#mod-approvals` for X and go straight to `xApproved` (bot_call still needs mod approve). |
| **`X_LEADERBOARD_DIGEST_ENABLED`** | `1` / `true` — enable scheduled digest tweets (off by default). |
| **`X_LEADERBOARD_DAILY_DIGEST_ENABLED`** | Optional; default **on** when `X_LEADERBOARD_DIGEST_ENABLED` is on. Set `0` / `false` / `no` to **skip** the **rolling 24h** digest (still posts **7d** / **monthly** if those stay enabled). Daily post uses the **terminal data card** (1200×820, same shell as milestone cards) + one-line caption; stats on the image. Owner preview: `!previewdailydigest`. |
| **`X_LEADERBOARD_MONTHLY_DIGEST_ENABLED`** | Optional; default **on** when digest is enabled. Set `0` / `false` / `no` to skip the **1st-of-month** digest. Monthly post: **single terminal data card** (1200×820, 30d trend on image) + **post text** with 🥇🥈🥉 top-3 lines (`@` when X handle verified). Owner preview: `!previewmonthlydigest`. |
| **`X_LEADERBOARD_DIGEST_UTC_HOUR`** | Hour `0–23` to post (default `16`). |
| **`X_LEADERBOARD_DIGEST_GRACE_HOURS`** | Optional `0–6` extra UTC hours after the target hour to retry if the bot was down or an X post failed (default `2`). Dedupe keys in `data/xLeaderboardDigestState.json` prevent double posts. |
| **`X_LEADERBOARD_WEEKLY_DIGEST_ENABLED`** | `0` / `false` to skip the **7d** leaderboard digest (default on when digest is enabled). Post: **single terminal card** + **leaderboard digest text** (desk + highlights). Owner preview: `!previewweeklydigest`. |
| **`X_DIGEST_CAROUSEL`** | Multi-image X digest posts (preview / optional). Default **`0`** = single combined card for scheduled weekly/monthly posts. **`monthly`** → 3 slides; **`monthly,weekly`** adds weekly 2-slide carousel. Preview: **`single`** forces one image. |
| **`X_LEADERBOARD_WEEKLY_UTC_WEEKDAY`** | `0` (Sun) … `6` (Sat); default `1` (Monday). |
| **`X_WEEKLY_STATS_SNAPSHOT_ENABLED`** | `1` / `true` — post a **stats-only** weekly X summary (previous completed UTC Mon–Sun); **independent** of `X_LEADERBOARD_DIGEST_ENABLED`. |
| **`X_WEEKLY_STATS_UTC_WEEKDAY`** | `0`–`6`; default `1` (Monday). |
| **`X_WEEKLY_STATS_UTC_HOUR`** | `0`–`23`; defaults to the same value as `X_LEADERBOARD_DIGEST_UTC_HOUR` (or `16`). |
| **`X_WEEKLY_SNAPSHOT_CALLER_TOP_N`** | Optional; default **`8`** (max `15`). Caller rows on the weekly snapshot (shorter reads better on mobile). |
| **`X_WEEKLY_SNAPSHOT_PRINT_TOP_N`** | Optional; default **`6`** (max `12`). Top member-call / McGBot-call lines per list. |
| **`X_BOT_USERNAME`** | `utils/xPoster.js` | X handle **without** `@` (default `McGBot`). Used for API/DM copy (e.g. `getXBotUsernameForCopy`); terminal-style post footers say **“link in bio”** without @-mentioning the bot. |
| **`X_MENTION_DESK_CALLS_ENABLED`** | `utils/xMentionDeskCallPoller.js` | Default **on** when X read creds exist. Polls `@McGBot` mentions → Pro desk calls (`handleCallFromDashboard`). Set `0` to disable. |
| **`X_MENTION_DESK_POLL_INTERVAL_MS`** | Same | Poll cadence (default **60s**, clamp 30s–5m). State file: `data/xMentionDeskPollState.json`. |
| **`X_MENTION_DESK_POST_REPLIES`** | Same | Default **on** — public reply on the user’s tweet (link X, Pro required, logged, errors). Set `0` to ingest silently. |
| **`DASHBOARD_PUBLIC_URL`** | Dashboard / links elsewhere | Optional; not appended to digest/snapshot tweets (footer points to the bot profile instead). `NEXT_PUBLIC_APP_URL` / `MCBOT_DASHBOARD_URL` are fallbacks where the codebase still reads a public app URL. |

#### 7.3.1 X engagement — weekly runner & monthly Top Caller

Scheduled from the same digest tick (`utils/xLeaderboardDigest.js` → `utils/xEngagementScheduler.js`). Uses **`SUPABASE_URL`** + **`SUPABASE_SERVICE_ROLE_KEY`** (repo root) to read `call_performance` for leaderboards; without them, posts are skipped. X posting still needs the four credentials in the table above (`utils/xPoster.js`).

| Variable | Purpose |
|----------|---------|
| **`X_WEEKLY_RUNNER_ENABLED`** | `1` / `true` / `yes` — post a **weekly runner** X card (best single **user** call by ATH multiple in the **prior UTC Mon–Sun** window). |
| **`X_WEEKLY_RUNNER_UTC_WEEKDAY`** | `0` (Sun) … `6` (Sat); default **`2`** (Tuesday). |
| **`X_WEEKLY_RUNNER_UTC_HOUR`** | `0`–`23`; defaults to **`X_LEADERBOARD_DIGEST_UTC_HOUR`** or **`16`**. |
| **`X_MONTHLY_TOP_CALLER_ENABLED`** | `1` / `true` / `yes` — on the **1st** of each UTC month at the configured hour, post the **previous calendar month** #1 caller (avg ATH ×), card PNG, profile link, trophy lines, then award **`user_badges` / `monthly_top_caller_awards`** and sync **`users.is_top_caller`**. |
| **`X_MONTHLY_TOP_CALLER_UTC_HOUR`** | `0`–`23`; defaults to digest hour / **`16`**. |
| **`DISCORD_GUILD_ID`** | Guild where the **Top Caller** role is applied (same as other flows that scope to one server). |
| **`DISCORD_TOP_CALLER_ROLE_ID`** | Snowflake of the **Top Caller** role (default **`1489081922666758264`** in `utils/discordTopCallerRole.js`). Bot needs **Manage Roles** and its role **above** this role in the hierarchy. |

For the monthly post **Profile** link, set one of **`DASHBOARD_PUBLIC_URL`**, **`MCBOT_DASHBOARD_URL`**, or **`NEXT_PUBLIC_APP_URL`** (see the row in the table above); `utils/xEngagementPosts.js` uses the first non-empty value as the dashboard base URL.

**Owner tests (`index.js`, bot owner only):** `!testweeklyrunner` and `!testtopcallermonth` force the respective X posts. The monthly test **does not** assign the Discord role or write Supabase awards (`skipDiscordRole` / `skipSupabaseAward`).

### 7.4 Optional — Supabase (Discord bot, repo root)

Used only when referral rows are mirrored to Postgres (`utils/referralService.js`). If unset, referral **file** tracking still works; Supabase insert is skipped when `getSupabase()` is never reached, or will error only if code paths call it without env.

| Variable | Used in | Purpose |
|----------|---------|---------|
| **`SUPABASE_URL`** | `utils/supabaseClient.js` | Supabase project URL |
| **`SUPABASE_ANON_KEY`** | `utils/supabaseClient.js` | Anon key for server-side bot inserts |

**Dashboard note:** `mcgbot-dashboard/` uses the same variable **names** but reads from **its own** env (e.g. `.env.local` / Vercel). Keep projects aligned deliberately.

#### 7.4.1 Outside Calls — X timeline poller (Discord bot host only)

Runs in **`index.js`** / `utils/outsideXCallerPoller.js` (not Vercel). Ingests CAs from active `outside_x_sources` → FaSol outside Telegram → `outside_calls`.

| Variable | Purpose |
|----------|---------|
| **`OUTSIDE_X_CALLS_POLL_DISABLED`** | `1` — stop all X timeline reads (dashboard tape stays empty until re-enabled). |
| **`OUTSIDE_X_CALLS_LEAN_MODE`** | Default **on** (~**90s** between full passes, fewer X credits). Set **`0`** for legacy **45s** cadence. |
| **`OUTSIDE_X_CALLS_POLL_INTERVAL_MS`** | Override interval (lean: **30s–5m**; legacy: **15s–2m**). |
| **`TELEGRAM_FASOL_OUTSIDE_CHAT_ID`** | Required for ingest pipeline. |
| **`OUTSIDE_TICKER_DEX_SEARCH_DISABLED`** | `1` — only curated `$TICKER` map, no Dexscreener search on ticker-only posts. |
| **`OUTSIDE_CALLS_FEATURE_DISABLED`** | `1` — emergency kill (same effect as admin **Coming soon**). |

Admin → **Outside X monitors**: **Go live** / **Coming soon** toggles `outside_calls_enabled` (Pro tape). **Pause polling** / **Resume polling** toggles `outside_x_polling_enabled` (bot reads both every ~15s). Poll banner shows lean vs legacy interval. Restart the bot after changing env-only vars.

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
8. If you want **referral rows mirrored to Supabase**, add `SUPABASE_URL` and `SUPABASE_ANON_KEY` to the **root** `.env` (see §7.4); otherwise the bot still tracks referrals in `data/referrals.json` without Postgres. After deploy, run `node scripts/syncReferralsJsonToPostgres.js` once to backfill historical JSON rows. On Vercel, set **`CRON_SECRET`** for `/api/cron/referral-credit-settle` and `/api/cron/reconcile-subscriptions`.

---

## 9. Updating this document

When you verify on a **new Node version** or **new OS**, update §1.1 and any install notes that differ. When you add env vars in code, update §7.

---

*Last aligned with dependency versions in `package.json` and runtime checks documented in this file.*
