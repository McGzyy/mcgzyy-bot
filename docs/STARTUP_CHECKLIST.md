# Startup checklist (pre-launch / pre-invite)

**Purpose:** Run this before you invite the bot to a production server or hand it to moderators. Split into **tester walkthrough** (Discord UX) and **admin/backend** (hosting, data, integrations).

**Related:** `docs/ENVIRONMENT.md`, `docs/DEPLOYMENT.md`, `docs/SYSTEM_MAP.md`, `docs/DATA_CONTRACTS.md`.

---

## 1. Moderator / tester walkthrough

Use a **throwaway test server** or a **private channel** first. Complete steps **in order** where dependencies exist (e.g. verification before mod-only commands).

### Step 0 — Account and access

| # | Action | Commands / UI | Verify |
|---|--------|----------------|--------|
| 0.1 | Join the test guild as a normal member | — | You can see the channels the bot will use (`#bot-calls`, etc.). |
| 0.2 | Enable **DMs from server members** (or open a DM with the bot) | User settings → Privacy → DMs | Required for `!help`, `!guide`, `!faq`, and `!commands` DM flows. |

---

### Step 1 — Fresh user: bot is alive

| # | Action | Commands | Verify |
|---|--------|----------|--------|
| 1.1 | Ping | `!ping` | Bot replies (e.g. “Pong!”). |
| 1.2 | Status | `!status` | Bot reports online. |
| 1.3 | Help (interactive) | `!help` | Channel ack about DMs; **DM** arrives with category menu (select menus work). |
| 1.4 | Help (text match) | `!help call` (or another topic phrase) | **DM** with matching topic text (or “no match” + suggestions). |
| 1.5 | Command list | `!commands` | **DM** with command list (sections match your permissions). |
| 1.6 | Guides | `!guide` | **DM** with markdown guides for your role (see `docs/beginner.md` / `user.md` / `mod.md` / `admin.md`). |
| 1.7 | FAQ | `!faq` | **DM** with FAQ entries (`faq: true` in `data/helpTopics.json`) or friendly empty message. |

**If any DM step fails:** You should see *“I couldn't DM you. Please enable DMs and try again.”* in channel — fix DMs and retry.

---

### Step 2 — Read-only / no-track intel

| # | Action | Commands | Verify |
|---|--------|----------|--------|
| 2.1 | Compact CA check | `!ca <valid_solana_ca>` | Embed or text response; **no** new row in tracking unless you used `!call` / `!watch`. |
| 2.2 | Scan (no persist) | `!scan` or `!scan <ca>` | Scan-style output; still **no** automatic `!call` persistence. |

Use a **known-good contract** you are allowed to test with (not financial advice).

---

### Step 3 — Tracking and profile

| # | Action | Commands | Verify |
|---|--------|----------|--------|
| 3.1 | Official call | `!call <ca>` | Reply + embed; coin appears in tracking; chart hydrate may follow (see §2 admin if chart errors). |
| 3.2 | Watch without credit | `!watch <ca>` | Confirmation; tracked **without** caller credit. |
| 3.3 | Tracked list / detail | `!tracked` then `!tracked <ca>` | Summary and/or refreshed detail for that CA. |
| 3.4 | Profile | `!profile` or `!myprofile` | Profile embed; **Verify X** path visible for your own profile. |
| 3.5 | Credit mode | `!credit anonymous` / `discord` / `xtag` (as applicable) | Preference updates; if `xtag` fails, X not verified yet — expected. |

---

### Step 4 — X verification (user side)

| # | Action | Commands / UI | Verify |
|---|--------|----------------|--------|
| 4.1 | Start verification | `#verify-x` flow and/or profile **Verify X** button | Modal or instructions appear; no crash. |
| 4.2 | Submit for review | Complete flow per server rules | Request lands where mods expect (e.g. mod / X-approval channel — see your `index.js` / server layout). |

---

### Step 5 — Moderator (Manage Server)

Repeat with an account that has **Manage Server** (or use an admin to grant it temporarily).

| # | Action | Commands | Verify |
|---|--------|----------|--------|
| 5.1 | Scanner state | `!scanner` | Shows ON/OFF. |
| 5.2 | Scanner toggle | `!scanner on` then `!scanner off` | Loops start/stop; `data/botSettings.json` reflects `scannerEnabled` after restart policy (see `DEPLOYMENT.md`). |
| 5.3 | Approvals / queue | `!approvalstats`, `!pendingapprovals` | Reasonable counts; no permission error. |
| 5.4 | X verify approve | `!verifyx @user` (pending user) | User verified per server rules; role assigned if `#role` exists. |
| 5.5 | Mod channel buttons | Open **#mod-approvals** (or your configured channel) | Approve / deny / exclude buttons respond without error. |
| 5.6 | Destructive check (optional, staging only) | `!resetmonitor` | **Only on a test server** — clears tracked state; confirm you understand data loss. |

---

### Step 6 — Regression pass (quick)

| # | Check | Expected |
|---|--------|----------|
| 6.1 | `!help` interactive: pick **category → topic** | Answer embed updates; **Back** buttons work. |
| 6.2 | Owner-only commands (if applicable) | Non-owner gets denial; owner can run threshold commands listed in `!commands` owner section. |

---

## 2. Admin / backend checklist

Run on the **same host** and **same `.env`** you will use in production.

### 2.1 Environment checks

| # | Check | How | Pass criteria |
|---|--------|-----|----------------|
| E.1 | Node.js | `node -v` | Matches policy in `docs/ENVIRONMENT.md` (LTS or team standard). |
| E.2 | Dependencies | `npm ci` (or `npm install`) from repo root | Completes without errors. |
| E.3 | Native charts | `node -e "require('canvas'); require('chartjs-node-canvas');"` | No throw (see `ENVIRONMENT.md` if build fails). |
| E.4 | `.env` present | File at project root | `DISCORD_TOKEN` set; `BOT_OWNER_ID` set for owner commands. |
| E.5 | X (if used) | All four Twitter/X OAuth vars in `.env` | Matches `ENVIRONMENT.md`; test with owner-only `!testx` only if policy allows. |
| E.6 | Guide DMs from DM channel | `DISCORD_GUILD_ID` set | Mods get correct `!guide` tier when messaging the bot from DMs (see guide command behavior). |

---

### 2.2 Data integrity checks

| # | Check | How | Pass criteria |
|---|--------|-----|----------------|
| D.1 | `data/` exists and writable | List `data/*.json` | Bot can create defaults on first run if files missing. |
| D.2 | JSON validity | Open or `node -e "JSON.parse(fs.readFileSync('data/trackedCalls.json'))"` (while bot **stopped** if you edit manually) | No parse errors. |
| D.3 | Backup | Copy `data/*.json` to a timestamped backup | Restore procedure documented (`DEPLOYMENT.md`). |
| D.4 | Deploy safety | Confirm deploy scripts **exclude** or **preserve** `data/` | No accidental wipe of `trackedCalls.json` on code deploy. |

---

### 2.3 Integration checks

| # | Check | How | Pass criteria |
|---|--------|-----|----------------|
| I.1 | Discord API | Bot shows **online** in member list | `client.login` succeeds; intents allow message content if you use `!` commands. |
| I.2 | Outbound HTTPS | From host: allow Discord, DexScreener, GeckoTerminal | No corporate firewall block (see `DEPLOYMENT.md`). |
| I.3 | Dex / real data | One `!ca` / `!call` on a known CA | Response includes plausible market fields or a clear error (bad CA). |
| I.4 | X API (if enabled) | Post test only per policy | `xPoster` logs clean or errors are understood. |

---

### 2.4 System behavior checks

| # | Check | How | Pass criteria |
|---|--------|-----|----------------|
| S.1 | Single instance | Only **one** process with this bot token | No double-writes to `data/*.json` (see `DEPLOYMENT.md`). |
| S.2 | Process supervisor | systemd / PM2 / equivalent | Restarts on crash; logs visible (`DEPLOYMENT.md` §3). |
| S.3 | Scanner persistence | `!scanner off`, restart process, `!scanner` | State matches `data/botSettings.json` / expected auto-start rules. |
| S.4 | Charts | After `!call`, watch logs for `[CallChart]` | No repeated native-module errors after Node upgrades (`npm rebuild canvas` if needed). |
| S.5 | Fragile fields (awareness) | Spot-check `data/trackedCalls.json` after a user `!call` | You know whether `discordMessageId` / `pairAddress` are populated (see `SYSTEM_MAP.md` — known gaps). |

---

### 2.5 Safety and permissions checks

| # | Check | How | Pass criteria |
|---|--------|-----|----------------|
| P.1 | Bot role permissions | Server settings → Integrations → Bot | **View**, **Send**, **Embed**, **Attach files** on bot/monitor channels; **Manage** only where required by design. |
| P.2 | Channel names | Guild has expected channels | At minimum **`bot-calls`** (and mod/verify channels per your `index.js` constants). |
| P.3 | Secrets | `.env` not in git; not pasted in Discord | `.gitignore` includes `.env`. |
| P.4 | Owner / mod boundaries | Non-owner cannot run owner threshold commands | `BOT_OWNER_ID` enforced. |
| P.5 | Test in staging first | Run §1 walkthrough on non-prod guild | No production data loss from `!resetmonitor` or test spam. |

---

## Sign-off

| Role | Name | Date | Notes |
|------|------|------|--------|
| Admin | | | |
| Lead mod | | | |

*Update this checklist when commands, channels, or env contracts change (`SYSTEM_MAP.md`, `DATA_CONTRACTS.md`).*
