# McGBot — Project Handoff (Execution-Ready)

This file reflects the **current codebase** in `C:\Dev\Crypto Scanner` as of the latest changes in this repo. Prior versions of this handoff referenced systems (memberships/referrals/low-cap/dev-intel submissions) that do **not** exist in the current repository — those sections have been removed.

---

## 1) What McGBot is (current)
McGBot is a Discord bot for:
- **Auto-calling** Solana tokens (bot calls) from GeckoTerminal intake + a scan/filter funnel.
- **User calls & watchlist tracking** (`!call`, `!watch`) with persistent tracking in JSON.
- **Monitoring** tracked calls over time (lifecycle + milestones + dumps).
- **Mod workflows**: approval review queue + X verification approvals.
- **Caller profiles**: public credit label (anonymous/discord/verified X tag) and X verification.

---

## AUTO-CALL SYSTEM (CURRENT)

- **GeckoTerminal intake**: per cycle, **NEW** pools + **SEARCH** pools (query rotation), merged and deduped; Solana filtering + prefilter before the funnel (see `providers/geckoTerminalProvider.js`).
- **Candidate filtering pipeline** (strict order): **sanity → naming → profile → global → momentum** (`utils/autoCallEngine.js`).
- **FaSol-aligned thresholds** (enforced when the underlying scan field exists / applies):
  - `minAgeMinutes` = **5**
  - min liquidity ≈ **15,000**
  - min 5m volume ≈ **25,000**
  - `requireMigrated` = **true**
  - min trades 24h ≈ **1,500** (if `trades24h` present)
  - min buys 24h ≈ **250** (if `buys24h` present)
  - min holders ≈ **300** (if `holders` present)
  - *Additional gate:* min 24h volume ≈ **40,000** when `volume24h` is present (see §5).

### Queue + pacing system

- **Max 1** immediate bot-call post per auto-call cycle.
- **45s** cooldown between bot-call posts.
- **Strongest candidate** (rank score) posts first; remaining passers queued **strongest-first**.
- **In-memory queue** only (`botCallQueue`): not persisted across restarts.
- **Before posting** a queued item: full revalidation (`generateRealScan` → sanity → naming → profile → global → momentum); **drop** if invalid.
- **Stale cutoff:** queued items older than **30 minutes** are dropped.

*Implementation detail, file map, and reply metadata for milestones:* see **§4** and **§5** below.

---

## 2) How to run (local)
- Entry point: `node index.js`
- Node project type: CommonJS (`package.json` has `"type": "commonjs"`)

### Required env
At minimum you need:
- `DISCORD_TOKEN`
- `BOT_OWNER_ID` (used for owner-only commands and help visibility)

X posting also requires credentials used by `utils/xPoster.js` (see that file for what env vars it expects).

---

## 3) Data stores (JSON) and what they contain
All persistence is JSON-on-disk under `data/`:
- `data/trackedCalls.json`: array of tracked calls (user_call, watch_only, bot_call). Written by `utils/trackedCallsService.js`.
- `data/userProfiles.json`: array of user profiles + X verification state. Written by `utils/userProfileService.js`.
- `data/trackedDevs.json`: tracked dev registry (wallet + metadata + launches). Written by `utils/devRegistryService.js`.
- `data/botSettings.json`: currently used for scanner on/off (see `index.js`).
- `data/scannerSettings.json`: live scanner settings overrides (see `utils/scannerSettingsService.js`).

### Important persistence caveat (current)
All stores use `readFileSync → JSON.parse → modify → writeFileSync` with **no file locking**. If two code paths write the same file close together, the later write can overwrite earlier updates (last-writer-wins).

---

## 4) Auto-call system (CURRENT behavior)

*See also **AUTO-CALL SYSTEM (CURRENT)** (top of doc) for the operator summary.*

### Primary files
- `utils/autoCallEngine.js`: auto-call loop, full filter stack, selection, pacing queue.
- `providers/geckoTerminalProvider.js`: GeckoTerminal intake (NEW + SEARCH), rotation, normalization and prefilter.
- `utils/scannerEngine.js`: `generateRealScan` (DexScreener-derived normalized scan object).
- `config/autoCallConfig.js`: sanity/naming/momentum/profile thresholds.
- `config/scanFilterConfig.js`: global filter thresholds for auto-call profiles.

### Note on command file duplication (Windows)
This repo currently contains both:
- `commands/basicCommands.js`
- `commands\basicCommands.js`

On Windows these can both exist and cause confusion. When updating command logic, verify which one is actually required by `index.js` (it imports `./commands/basicCommands`).

### GeckoTerminal intake flow (CURRENT)
`providers/geckoTerminalProvider.js` does **two fetches per cycle**, merged:
- **NEW** pools: `GET /networks/solana/new_pools?page={currentPage}`
- **SEARCH** pools: `GET /search/pools?query={term}&page={currentPage}` where `term` rotates through `['sol','ai','meme']`

Then:
- raw pools are deduped by `pool.id`
- SEARCH results are filtered to Solana:
  - prefer `pool.relationships.network.data.id === 'solana'` when available
  - else parse `pool.id` prefix before `_` (expects `solana_…`)
  - last-resort fallback: `id.includes('solana')`
- normalized pools are prefiltered (liquidity/volume/txns/age/ratio) and capped to 40.

### Filter stack order (CURRENT)

Auto-call selection (`utils/autoCallEngine.js`) applies this order:
1. **sanity** (`getSanityRejectReason`)
2. **naming** (`getNamingRejectReason`) — only when `autoCallConfig.alerts.skipUnknownTokens === true`
3. **profile** (`getProfileRejectReason`) — profile-specific thresholds (default profile: `balanced`)
4. **global** (`getGlobalRejectReason`) — global thresholds from `config/scanFilterConfig.js`
5. **momentum** (`getMomentumRejectReason`)

### Selection logic (CURRENT)
- Candidates that pass all filters are “passers”.
- Passers are scored by existing `getPasserRankScore(scan)` and sorted descending.
- The engine chooses `selected = passers.slice(0, maxCallsPerCycle)` (maxCallsPerCycle is still 2), but **posting** is paced (see next section).
- If there are no passers, a single “fallback” candidate may be chosen from near-miss rejects (existing behavior).

### Queue / pacing behavior (CURRENT V1)
Goal: prevent “dumping” multiple bot calls at once without reducing detection.

`utils/autoCallEngine.js` now enforces:
- **Max 1 immediate bot-call post per auto-call cycle**
  - If 1 candidate passes: post immediately **if not in cooldown**, else queue it.
  - If multiple candidates pass: **post only the strongest** immediately (if not in cooldown), queue the rest strongest-first.
- **Cooldown between bot-call posts:** 45 seconds (`BOT_CALL_COOLDOWN_MS = 45_000`)
- **In-memory queue only** (not persisted): `botCallQueue`
- **Strongest-first queue ordering** using existing `rankScore`
- **Revalidation before posting queued items**
  - Before posting a queued CA, it re-runs: `generateRealScan` → sanity → naming → profile → global → momentum.
  - If it no longer qualifies, it is dropped and the next queued candidate is tried.
- **Stale queue cleanup:** queued items older than 30 minutes are dropped (`BOT_CALL_QUEUE_MAX_AGE_MS`)
- **Queue processing tick:** runs every ~5s while loop is running, and also at the end of each cycle. It will post **at most one** queued candidate per cooldown window.

### Where the original bot-call message metadata is stored (reply threading)
When a bot-call is posted, the tracked call row is updated with:
- `discordMessageId`: message id of the bot-call post
- `discordChannelId`: channel id where the bot-call post was sent

These are used by milestone replies (see Milestones section).

---

## 5) Current filter baseline (FaSol-aligned changes)
This repo recently tightened auto-call quality gates. Below is what is **actually enforced** today.

### Enforced (CURRENT)
**Age floor**
- Min age: **5 minutes** (`autoCallConfig.sanity.minAgeMinutes = 5`)

**Market / liquidity / volume floors**
- Min market cap: **15,000** (global filter: `config/scanFilterConfig.js` balanced)
- Min liquidity: **15,000**
  - enforced via profile (`config/autoCallConfig.js` balanced) and global (`config/scanFilterConfig.js` balanced)
  - also enforced by sanity “meaningful liquidity” floor (`autoCallConfig.sanity.minMeaningfulLiquidity = 15_000`)
- Min 5m volume: **25,000**
  - enforced via profile (`config/autoCallConfig.js` balanced) and global (`config/scanFilterConfig.js` balanced)
  - also enforced by sanity `minVolume5m = 25_000`

**Migrated-only**
- Enforced: `requireMigrated: true` → rejects if `scan.migrated !== true`
  - Source is the real scan (`utils/scannerEngine.js`) which sets `migrated` from provider data (`providers/realTokenProvider.js` → `meta.migrated` from DexScreener normalization).

**Activity floors (mapped to available fields)**
These are enforced **only when the underlying field is present (> 0)**:
- Min 24h volume: **40,000** (`scan.volume24h`)
- Min “TXs” (mapped): **1,500 trades/24h** (`scan.trades24h`)
- Min buys: **250 buys/24h** (`scan.buys24h`)

**Holder floor**
- Min holders: **300** enforced only when `scan.holders` is present and numeric.

### Not enforced (UNSUPPORTED safely right now)
The following FaSol-style protections are **not** currently enforced in auto-call selection, because the live scan object does not reliably include them end-to-end:
- Max Top 10 hold %
- Max Dev hold %
- Max Bundle hold %
- Max Snipers hold %

There is a `providers/holderIntelligenceProvider.js` that can extract these metrics from external sources, but it is **not currently wired into** `providers/realTokenProvider.js` → `utils/scannerEngine.generateRealScan()` for auto-calls.

---

## MONITORING + LIFECYCLE (UPDATE)

- **Active scan only:** the monitor loop processes coins that are **not** archived and **not** marked inactive (`lifecycleStatus !== 'archived'` and `isActive !== false`). Archived / inactive rows stay in JSON but are **skipped** each cycle.
- **ATH-based X:** \(X = athMc / firstCalledMc\) (with `firstCalledMarketCap` / fallbacks as in monitor code); `athMc` is the running high of observed market cap.
- **Archive conditions** (failed scans threshold, lifecycle `archived`, hard-kill rules such as very low MC / deep drawdown) **remove** coins from the active scan loop while keeping history on disk.

### Primary files (detail)
- `utils/monitoringEngine.js`: main monitor loop, milestones, dumps, approval-queue posting, archive handling.
- `utils/lifecycleEngine.js`: lifecycle status rules (`active` / `stagnant` / `archived`).
- `utils/trackedCallsService.js`: persistence for lifecycle flags, milestonesHit, dumpAlertsHit, etc.

### Active vs archived tracking
- Tracked calls are stored in `data/trackedCalls.json`.
- A tracked row can be archived by setting:
  - `lifecycleStatus: 'archived'`
  - `isActive: false`
- **CURRENT:** the monitor loop skips archived/inactive rows during scanning:
  - it filters to `coin.lifecycleStatus !== 'archived' && coin.isActive !== false`
  - archived rows remain stored; they are just not reprocessed.

### Archive causes (monitor)
In `utils/monitoringEngine.js` a coin can be archived if:
- repeated scan failures reach threshold (failedScans ≥ 3), or
- lifecycle engine returns `archived`, or
- hard-kill rules in monitor (e.g. market cap < $5k, performance ≤ -80%).

### ATH / X logic (monitor)
Within the monitor loop:
- `firstMc` comes from `coin.firstCalledMarketCap` (fallback to current market cap).
- `athMc` is tracked as `max(previousAthMc, currentMc)`.
- **X** is computed as \(athMc / firstMc\).
- Performance % (`perf`) is computed as \((currentMc - firstMc) / firstMc * 100\).

---

## 7) Mod approval workflow (CURRENT)

### What triggers approval review items
In `utils/monitoringEngine.js`, after a successful scan, the monitor checks:
- `shouldCreateApprovalRequest(trackedCall, currentX)` from `utils/approvalMilestoneService.js`
- If it returns `shouldSend: true`, it queues an approval review post to the approval channel.

### Approval trigger source (settings)
- `approvalTriggerX` is loaded from `data/scannerSettings.json` via `utils/scannerSettingsService.js`.
- Default is **4** when unset.

### Approval ladder behavior (operator intent alignment)
`utils/approvalMilestoneService.js` ensures the configured `approvalTriggerX` is also a valid rung:
- even if the preset ladder doesn’t include it (e.g. trigger 4), it is merged into the rung set
- rungs are unique + sorted

### Where approval items post (channel)
Approval review items post to:
- `#coin-approval` or `#coin-approvals` (exact name match)

### Important operational permission note
Approval button interactions in `index.js` do not currently enforce `ManageGuild` in the handler. Treat the approval channel as **security boundary** (Discord perms must restrict who can view/interact).

---

## MILESTONE SYSTEM (UPDATE)

- Milestones are **not** percent-of-gain based; they fire from achieved **X** = \(athMc / firstCalledMarketCap\) (same ATH X as monitoring).
- **Current ladder** (`utils/monitoringEngine.js`): **2x, 4x, 8x, 10x, 12x, 15x, 20x, 25x, 30x, 35x, 40x, 50x, 60x, 100x**.

### Behavior

- **Once per coin per rung:** satisfied rungs are recorded in persisted `milestonesHit` in `trackedCalls.json` so each milestone fires only once.
- **Milestone alerts:** prefer **replying to the original call message** when `discordMessageId` / `discordChannelId` allow it; otherwise **normal channel send** (message missing or wrong channel).
- Embed line **“Alerted … ago”** is **relative time since first call** (`createMilestoneEmbed` — from `firstCalledAt` with fallbacks to `calledAt` / `createdAt`).

### Hardening + short-term dedupe

- Monitor reloads the tracked row before computing new milestones to avoid stale in-memory double-sends.
- `utils/alertQueue.js` adds short-window dedupe (~60s exact / ~15s per-coin); **`milestonesHit` is the durable guarantee**.

---

## OUTSIDE CALLER SYSTEM

- **Registry:** `data/outsideCallers.json` (curated X handles + enable/disable state).
- **Staff management commands:** `!outsidecalleradd`, `!outsidecallers`, `!outsidecallerdisable`, `!outsidecallerenable`, `!outsidecallerremove`.
- **Public lookup:** `!outsidecaller <handle>` — returns **active** callers only (disabled entries are not shown).
- **X ingestion hook:** when a **tracked** handle posts a **Solana contract address (CA)**, the bot posts an **alert** to **`#outside-callers`**.
- **Behavior:** **alert-only** — **no** new row in `trackedCalls.json` / **no** tracked call created.
- **Dedupe (runtime):** in-memory, keyed by **handle + CA + tweet id** so the same event is not spammed in one process lifetime.

### Limitations

- Dedupe **resets on bot restart** (not persisted).
- **No** on-disk **alert history** for outside-caller alerts.

---

## CHANNEL ARCHITECTURE

Channels below match **current code** (exact name matches unless noted).

- **`#coin-approval` OR `#coin-approvals`**
  - Main **approval queue** channel.
  - Approval **embeds** from the monitor post here.
  - **Mod actions** (`approve_call` / `deny_call` / `exclude_call` buttons) are intended to be used in context of these posts / this channel (handler lives in `index.js`).
- **`#mod-chat`**
  - General **staff discussion** and **notifications** (`MOD_CHANNEL_NAME` in `index.js`).
  - Not the primary home for the coin approval queue embeds.
- **`#bot-calls`**
  - **Bot auto-call** output and related monitor traffic for calls (as resolved by bot channel lookup).
- **`#outside-callers`**
  - **Outside-caller** X-ingestion **alerts** (CA spotted on a tracked handle).
- **`#verify-x`**
  - User-facing X verification flow.
- **`#x-approvals`**
  - Mod-side X verification review posts.

*Channel naming may be standardized in the future; today the bot matches these literal channel names.*

---

## SECURITY HARDENING

### Owner-only (BOT_OWNER_ID) — examples in `index.js`

- Scanner **threshold / settings** style commands (e.g. `!setminmc`, `!setminliq`, `!setminvol5m`, `!setapprovalx`, …) enforce **`BOT_OWNER_ID`**.

### Not owner-only in code today (important)

- **`!scanner` / `!scanner on` / `!scanner off`:** require **`ManageGuild`** (mods/admins), **not** owner-only.
- **`!resetmonitor`:** requires **`ManageGuild`**; clears tracked coins and stops loops (destructive).
- **`!testx`:** **no** permission check in the handler — effectively **anyone who can post** in the channel can trigger it; treat as a **gap** unless restricted by channel permissions or a future code check.

### Approval interactions (CURRENT gap)

- Handlers for **`approve_call` / `deny_call` / `exclude_call`** do **not** verify channel name (e.g. `#coin-approval` / `#coin-approvals`) and do **not** require **`ManageGuild`** in code — security is **Discord channel permissions** + who can click components.
- **Recommended hardening:** enforce **ManageGuild** (and optionally **channel id / name**) in the interaction handler, and run approvals only in a locked staff channel.

### Help visibility

- `!help` / `!commands` is chunked and role-aware (user vs `ManageGuild` vs owner sections).

---

## 12) Known limitations / next steps (realistic)
- **Holder intelligence:** top-10 / dev hold / bundle / sniper style metrics are **not** fully integrated into the **scan → auto-call** pipeline (`holderIntelligenceProvider.js` exists but is not wired through `realTokenProvider` / `generateRealScan` for those gates).
- **Filters:** FaSol-aligned phase may feel **temporarily strict**; expect iteration from live results.
- **Auto-call queue:** **in-memory only** — no persistence across restarts; lost on crash/redeploy.
- **Charts:** milestone / call **chart overlays** are **not** implemented.
- **Outside caller alerts:** dedupe is **in-memory only** (resets on restart); **no** persisted alert history (see **OUTSIDE CALLER SYSTEM**).
- **Deployment/VPS**: not covered in code; use a process manager (e.g. PM2/systemd) and secure env management.

---

## 13) Quick “where to change what”
- Auto-call thresholds: `config/autoCallConfig.js`, `config/scanFilterConfig.js`, plus overrides in `data/scannerSettings.json`
- Gecko intake breadth/rotation: `providers/geckoTerminalProvider.js`
- Monitor cadence + archive logic: `utils/monitoringEngine.js` + `utils/lifecycleEngine.js`
- Milestone ladder: `utils/monitoringEngine.js` (`DISCORD_MILESTONE_LEVELS`)
- Milestone embed formatting: `utils/alertEmbeds.js` (`createMilestoneEmbed`)
- Approval ladder / trigger: `utils/approvalMilestoneService.js` + overrides in `data/scannerSettings.json`

