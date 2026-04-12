# System map (living document)

**Purpose:** Single reference for how McGBot / Crypto Scanner fits together—entry points, data, charts, milestones, X, and risks.

**Files (this doc):** `docs/SYSTEM_MAP.md`

---

## Event → Function Map

User actions and runtime events map to handlers as below. Paths are repo-relative from the project root.

| Event / user action | Handler or entry function | Primary file |
|---------------------|---------------------------|--------------|
| `!call <ca>` (text) | `handleCallCommand` | `commands/basicCommands.js` (invoked from `index.js` `messageCreate`) |
| `Call` button (`call_coin`) | `handleCallCommand` (synthetic message / `followUp`) | `index.js` → `commands/basicCommands.js` |
| `!watch <ca>` | `handleWatchCommand` | `commands/basicCommands.js` (via `index.js` or `interactionCreate` for `watch_coin`) |
| Auto-call tick | `runAutoCallCycle` | `utils/autoCallEngine.js` |
| Auto-call post + track | `postBotCallScan` → `trackAutoCall` → `hydrateAutoCallChartMessage` | `utils/autoCallEngine.js` |
| Monitoring tick | `checkTrackedCoins` | `utils/monitoringEngine.js` |
| Milestone / dump Discord send | `queueMilestone` / `queueDump` → `enqueueAlert` | `utils/monitoringEngine.js` → `utils/alertQueue.js` |
| Approval queue post | `postApprovalReview` → `queueApprovalReview` | `utils/monitoringEngine.js` |
| Approve / deny / exclude buttons | `interactionCreate` branch (`approve_call`, etc.) | `index.js` |
| X post (approval / milestone) | `publishApprovedCoinToX` and/or `maybePublishApprovedMilestoneToX` → `createPost` | `index.js`, `utils/monitoringEngine.js` → `utils/xPoster.js` |
| `!scanner on` / `off` | `messageCreate` → `startMonitoring` / `stopMonitoring`, `startAutoCallLoop` / `stopAutoCallLoop` | `index.js` |
| Process boot | `client.once('clientReady', …)` | `index.js` |
| Token / market fetch (live) | `fetchRealTokenData` → `fetchDexScreenerTokenData` | `providers/realTokenProvider.js` → `providers/dexScreenerProvider.js` |
| Scan object for filters / embeds | `generateRealScan` | `utils/scannerEngine.js` |
| Persist call row | `saveTrackedCall`, `updateTrackedCallData`, `reactivateTrackedCall` | `utils/trackedCallsService.js` |
| User-call chart PNG | `hydrateTraderCallChartMessage` → `renderPriceChart` | `commands/basicCommands.js` → `utils/renderChart.js` |

---

## Critical / fragile data behavior

These are **invariants operators should know**; details and schemas are in `docs/DATA_CONTRACTS.md`.

1. **`discordMessageId` for user calls:** User `!call` / `saveTrackedCall` does **not** persist the bot’s reply message id today. Many user rows keep `discordMessageId: null`, so **milestone/dump alerts cannot reply-thread** to the original call and fall back to a normal channel send. Bot auto-calls **do** set `discordMessageId` / `discordChannelId` after `channel.send` (`utils/autoCallEngine.js`).

2. **`pairAddress` on tracked calls:** The scan pipeline can produce `pairAddress` (Dex / Gecko merge), but **`saveTrackedCall` does not write it** to `trackedCalls.json` in current code. It is **not guaranteed** on disk. X / Gecko `chart.png` then often fall back to **contract address** as id, which may **404 or wrong-chart** silently (`utils/chartCapture.js`).

3. **`priceHistory` on older records:** The key may be **missing** in JSON for legacy rows; `normalizeTrackedCall` treats that as `[]` after load. Charts need points appended by save/monitor paths—see `utils/trackedCallsService.js`, `utils/monitoringEngine.js`.

---

## Maintenance note

Update **`docs/SYSTEM_MAP.md`** in the **same change** as the code when:

- **Command flow changes** (new `!` commands, button ids, or different handler files).
- **New storage fields** or changed meaning of existing fields under `data/`.
- **Chart pipeline changes** (new renderer, OHLCV, or different image source for X).

Also update **`docs/DATA_CONTRACTS.md`** when storage contracts change.

---

## Runtime entry

**Files:** `index.js`

| Item | Location |
|------|-----------|
| Process entry | `index.js` (loads `dotenv`, creates `discord.js` `Client`, registers handlers) |
| Discord login | `client.login(process.env.DISCORD_TOKEN)` |
| Background loops | `client.once('clientReady', …)` in `index.js` when `SCANNER_ENABLED` and `#bot-calls` exists → `startMonitoring`, `startAutoCallLoop` |

---

## End-to-end: user call (`!call <ca>`)

**Files:** `index.js` (`messageCreate`) → `commands/basicCommands.js` → `providers/realTokenProvider.js` → `providers/dexScreenerProvider.js` → `utils/trackedCallsService.js` → `utils/renderChart.js`

1. **Discord** `messageCreate` → `index.js` matches `!call `, parses contract address, calls `handleCallCommand` (`commands/basicCommands.js`).
2. **Data fetch:** `handleCallCommand` → `runQuickCa` → `fetchRealTokenData` (`providers/realTokenProvider.js`) → `fetchDexScreenerTokenData` (`providers/dexScreenerProvider.js`).
3. **Scan shape:** `normalizeRealDataToScan` (`commands/basicCommands.js`) builds the embed-oriented scan object (scores, flags, etc.).
4. **Persistence:** `applyTrackedCallState` → `getTrackedCall` / `saveTrackedCall` / `reactivateTrackedCall` / `updateTrackedCallData` (`utils/trackedCallsService.js`) → writes `data/trackedCalls.json`.
5. **Discord reply:** `createTraderScanEmbed` + `message.reply` with “officially called” content.
6. **Chart hydrate (async):** If new/reactivated call, `hydrateTraderCallChartMessage` edits the same message: `seriesFromTrackedPriceHistory` + `renderPriceChart` (`utils/renderChart.js`), optional `chart.png` attachment.

**Also:** Button `call_coin` in `index.js` `interactionCreate` wraps `handleCallCommand` with a synthetic message object (`followUp` as reply).

**Not tracked:** Pasting a bare CA in scanner channels goes through `handleBasicCommands` (`commands/basicCommands.js`) → quick/deep scan only—no `!call` persistence.

---

## End-to-end: bot auto-call

**Files:** `index.js` (`clientReady`) → `utils/autoCallEngine.js` → `providers/geckoTerminalProvider.js` → `utils/scannerEngine.js` → `utils/alertQueue.js` → `utils/alertEmbeds.js` → `utils/trackedCallsService.js` → `utils/renderChart.js`

1. **Scheduler:** `startAutoCallLoop` (`utils/autoCallEngine.js`) runs `runAutoCallCycle` immediately and on `setInterval` (`config/autoCallConfig.js` `loop.intervalMs`, default 60s). A second interval (5s) runs `processBotCallQueue` for pacing.
2. **Candidates:** `fetchGeckoTerminalCandidatePools` (`providers/geckoTerminalProvider.js`).
3. **Per candidate:** `generateRealScan` (`utils/scannerEngine.js`) → same Dex path as user calls; optional merge with Gecko candidate for `pairAddress` etc.
4. **Filters:** Sanity, naming, profile, global, momentum, dedupe—see `utils/autoCallEngine.js` and `config/autoCallConfig.js` / `config/scanFilterConfig.js`; live overrides from `loadScannerSettings()` (`utils/scannerSettingsService.js`).
5. **Post:** `postBotCallScan` → `enqueueAlert` (`utils/alertQueue.js`) → `channel.send` with `createAutoCallEmbed` (`utils/alertEmbeds.js`).
6. **Persistence:** `trackAutoCall` → `saveTrackedCall` with `callSourceType: 'bot_call'` and synthetic caller `AUTO_BOT` / McGBot; then `updateTrackedCallData` sets `discordMessageId` / `discordChannelId` for reply threading.
7. **Chart hydrate:** `hydrateAutoCallChartMessage` (same PNG pipeline as user calls).

---

## Where data is stored

**Files:** `data/trackedCalls.json`, `data/userProfiles.json`, `data/trackedDevs.json`, `data/scannerSettings.json`, `data/botSettings.json` — read/write via `utils/trackedCallsService.js`, `utils/userProfileService.js`, `utils/devRegistryService.js`, `utils/scannerSettingsService.js`, `index.js` (`loadBotSettings` / `saveBotSettings`).

| Data | Path | Format |
|------|------|--------|
| Tracked calls | `data/trackedCalls.json` | JSON array of call objects; full file read/write on many operations |
| User profiles | `data/userProfiles.json` | JSON (X verification, credit mode, etc.) |
| Tracked devs | `data/trackedDevs.json` | JSON |
| Scanner live settings | `data/scannerSettings.json` | JSON object (thresholds, approval ladder, etc.) |
| Bot on/off flag | `data/botSettings.json` | JSON (`scannerEnabled`) |

**`priceHistory`:** Intended on each call as `{ t, price }[]` (MC snapshots), capped ~500; appended in `saveTrackedCall` / `reactivateTrackedCall` and each monitor tick in `checkTrackedCoins` (`utils/monitoringEngine.js`). **Older rows may omit the key** until the next save—see **Critical / fragile data behavior** above.

**`pairAddress`:** Carried on scan objects from Dex/Gecko merge; **not** reliably persisted on the tracked call in current `saveTrackedCall`—see **Critical / fragile data behavior** above.

---

## Where charts are generated

**Files:** `utils/renderChart.js`, `utils/chartCapture.js`, `utils/xPoster.js`, call sites in `commands/basicCommands.js`, `utils/autoCallEngine.js`, `utils/monitoringEngine.js`, `index.js`

| Use case | Mechanism | Files |
|----------|-----------|--------|
| Discord call embed (line chart) | `chartjs-node-canvas` + Chart.js line chart | `utils/renderChart.js`; invoked from `commands/basicCommands.js` (user) and `utils/autoCallEngine.js` (bot) |
| X (first post image, optional) | HTTP fetch of static PNG | `utils/chartCapture.js` → `https://www.geckoterminal.com/solana/pools/{id}/chart.png` |
| X media attach | OAuth upload + tweet create | `utils/xPoster.js` (`createPost` with buffer on original tweet only) |

**OHLCV:** Not used today. Line charts plot scalar series from `priceHistory` (MC), not candles.

---

## Where OHLCV would be added (suggested)

**Files (future):** new or extended provider under `providers/`, optional `utils/renderChart.js` or sibling module, `docs/DATA_CONTRACTS.md`

1. **Fetch:** New provider helper or extend `providers/realTokenProvider.js` / a dedicated module (e.g. Birdeye OHLC, Gecko OHLC API)—keep API keys and rate limits isolated.
2. **Storage:** Either embed OHLC arrays on the tracked call (heavy) or a sidecar file/cache keyed by `contractAddress` + timeframe; avoid unbounded growth.
3. **Render:** Extend `utils/renderChart.js` (e.g. financial/candlestick plugin compatible with `chartjs-node-canvas`) or swap to a dedicated server-side chart path.
4. **Call sites:** Same hydrate functions (`hydrateTraderCallChartMessage` / `hydrateAutoCallChartMessage`) in `commands/basicCommands.js` / `utils/autoCallEngine.js` would pass OHLC into the renderer instead of (or in addition to) `seriesFromTrackedPriceHistory`.

---

## How milestones work

**Files:** `utils/monitoringEngine.js`, `utils/alertQueue.js`, `utils/alertEmbeds.js`, `utils/approvalMilestoneService.js`, `data/scannerSettings.json`, `index.js` (`interactionCreate`)

### Discord milestone ladder

- Defined in `utils/monitoringEngine.js` (`DISCORD_MILESTONE_LEVELS`: 2x, 4x, … with thresholds).
- **Loop:** `startMonitoring` (`utils/monitoringEngine.js`) → `checkTrackedCoins` on an interval (default 60s from `index.js`).
- **Logic:** For each active call, `generateRealScan` → `spotX` from current MC vs `firstCalledMarketCap`; `getNewMilestones`; spacing via `lastPostedX` / `getMinSpacing`; `queueMilestone` → `enqueueAlert` → `channel.send` with optional **reply** to `discordMessageId` if channel matches (`buildReplyOptions`).

### Dump alerts

- `getHighestDump` on drawdown from ATH vs current MC; queued similarly (`queueDump`).

### Mod approval queue (X-worthy pipeline)

- `shouldCreateApprovalRequest` (`utils/approvalMilestoneService.js`) uses ATH multiple vs `approvalTriggerX` and ladder from `scannerSettings.json`.
- `postApprovalReview` posts to guild channel named **`mod-approvals`** with buttons; state fields on the tracked call (`approvalStatus`, `approvalMessageId`, etc.) via `utils/trackedCallsService.js`.
- **Buttons:** `index.js` `interactionCreate` — `approve_call` / `deny_call` / `exclude_call` (requires `ManageGuild` + `#mod-approvals` per current code).

---

## How X posting works

**Files:** `utils/xPoster.js`, `utils/monitoringEngine.js`, `index.js`, `utils/chartCapture.js`, `utils/trackedCallsService.js`

| Concern | Implementation |
|---------|------------------|
| Credentials | `utils/xPoster.js` — `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET` |
| Create / reply | Twitter API v2 `POST /2/tweets`; OAuth1 signing |
| Media | v1.1 `media/upload` for PNG on **non-reply** posts only (see `createPost`) |
| After mod approval | `setApprovalStatus` (`utils/trackedCallsService.js`) sets `xApproved`; `publishApprovedCoinToX` (`index.js`) and/or `maybePublishApprovedMilestoneToX` (`utils/monitoringEngine.js`) build text, optionally `fetchGeckoChart`, `createPost`, then `setXPostState` (milestones, tweet ids) |

**Copy note:** Some X text builders hardcode “Called by: @McGBot”; adjust if you need human caller attribution on X.

---

## Module responsibilities (concise)

**Directories:** `index.js`, `commands/`, `config/`, `providers/`, `utils/`, `data/`

| Module / area | Role |
|---------------|------|
| `index.js` | Discord wiring: messages, interactions, dev/X UI, owner commands, scanner on/off, approval embeds duplicate helpers |
| `commands/basicCommands.js` | `!call`, `!watch`, scans, embeds, user chart hydrate, many `!` commands when reached from `index` |
| `utils/monitoringEngine.js` | Periodic scan of tracked calls, milestones, dumps, approval queue enqueue, X auto-post for approved, `priceHistory` append |
| `utils/autoCallEngine.js` | Gecko candidates, filters, bot posts, queue pacing, bot chart hydrate |
| `utils/scannerEngine.js` | `generateRealScan` / scoring / `buildScanObject` from `fetchRealTokenData` |
| `providers/realTokenProvider.js` | Single live path: DexScreener → normalized token/market/trade shape |
| `providers/dexScreenerProvider.js` | HTTP DexScreener Latest API |
| `providers/geckoTerminalProvider.js` | Pool search for auto-call candidates |
| `utils/trackedCallsService.js` | Load/save/normalize `trackedCalls.json`, approval/X fields, stats exclusions |
| `utils/alertQueue.js` | Serialize Discord alerts (gaps, dedupe, suppression) |
| `utils/alertEmbeds.js` | Embed builders (trader, auto, milestone, dump, dev, stats) |
| `utils/renderChart.js` | PNG line charts from `priceHistory` |
| `utils/chartCapture.js` | Gecko static chart PNG fetch |
| `utils/xPoster.js` | X OAuth client for tweets + media |
| `utils/approvalMilestoneService.js` | Approval ladder and “should we open a mod review?” |
| `utils/scannerSettingsService.js` | RW `scannerSettings.json` |
| `utils/userProfileService.js` | Profiles, X verification, public caller labels |
| `utils/callerStatsService.js` | Aggregates from tracked calls |
| `utils/devRegistryService.js` | Tracked devs JSON |
| `utils/lifecycleEngine.js` | `determineLifecycleStatus` (note: not always persisted on every monitor tick—see risks) |
| `config/*.js` | Static thresholds and blueprint data |

**Orphan / unused in current graph:** `utils/tokenDataService.js`, several unused `providers/*` (e.g. `birdeyeProvider.js`, `holderIntelligenceProvider.js`, `historicalMarketProvider.js`, etc.)—see `docs/REFACTOR_PLAN.md` before wiring new features.

---

## Known risks and fragile areas

1. **`trackedCalls.json` as database:** Frequent full-file read/write; concurrent updates from monitor + commands can race (last writer wins).
2. **Single guild / channel assumptions:** `clientReady` uses first guild and requires `#bot-calls`; monitoring/auto-call do not run without it.
3. **API fan-out:** Each monitor cycle calls `generateRealScan` per active coin; auto-call adds many Dex + Gecko calls—scales with list size and interval.
4. **Reply threading:** Milestone replies need `discordMessageId` (+ matching `discordChannelId`); **user calls often lack persisted `discordMessageId`**—see **Critical / fragile data behavior** above.
5. **Gecko chart URL:** `chart.png` expects a **pool** id; **`pairAddress` not guaranteed** on tracked calls—see **Critical / fragile data behavior** above.
6. **Duplicate / dead code paths:** `!call` / `!watch` exist in both `index.js` and `commands/basicCommands.js` (index wins for `!` messages); X + Gecko chart logic duplicated between `index.js` and `monitoringEngine.js`.
7. **Lifecycle:** `determineLifecycleStatus` runs in monitor but “stagnant” transitions may not be written on the happy path—verify if you rely on `lifecycleStatus` for UX.
8. **Alert queue:** Global minimum gap between *all* alert types can delay milestones under load.

---

## Related docs

| Document | Purpose |
|----------|---------|
| `docs/DATA_CONTRACTS.md` | `trackedCalls.json` fields, MUST/MAY, `priceHistory`, future OHLCV / `pairAddress` |
| `docs/REFACTOR_PLAN.md` | Removals, additions (OHLCV/candles), refactors, sequencing, migrations |
| `docs/ENVIRONMENT.md` | Node, OS, `canvas` / Playwright, env vars, local reproduction |
| `docs/DEPLOYMENT.md` | VPS/systemd, start/stop, backups, failure modes, monitoring |

**Additional (may overlap code):**

- `docs/PROJECT_HANDOFF.md` — reconcile if instructions conflict with code.
- `docs/admin.md` — env and ops notes (some env vars may be doc-only).

---

*Last suggested review: when changing `trackedCalls` schema, monitor interval, chart pipeline, or X behavior.*
