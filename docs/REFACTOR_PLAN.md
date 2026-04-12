# Refactor plan

**Audience:** Developers changing McGBot / Crypto Scanner architecture.

**Intent:** Record *why* we want certain removals, additions, and refactors—so future changes stay aligned with product goals (reliable calls, honest charts, maintainable code) rather than accumulating parallel experiments.

**Related:** `docs/SYSTEM_MAP.md`, `docs/DATA_CONTRACTS.md`.

---

## Non-goals

Explicit **out of scope** for this refactor direction—so scope creep does not reintroduce brittle or misleading chart behavior.

| Non-goal | Rationale |
|----------|-----------|
| **No browser-based chart capture** | Do not use Playwright/Puppeteer (or similar) to screenshot Dex/GMGN/TradingView pages for **primary** Discord or X charts. DOM layout, auth walls, and memory cost make this a maintenance and ToS liability; server-side rendering from **API data** is the target. |
| **No reliance on Cloudflare-bypassed UI pages** | Do not depend on scraping “protected” frontends, anti-bot–heavy sites, or unofficial bypass stacks to feed charts. If an API is not reachable with normal HTTP + keys, treat that as a **product/integration** decision, not a scraping arms race. |
| **No coupling chart rendering solely to internal `priceHistory`** | **Candlestick / OHLCV charts must not be defined only by** the bot’s MC snapshot array (`priceHistory`). That series is coarse, irregular, and not OHLC. Rendering should use **explicit OHLCV** (or another documented market API), while `priceHistory` may remain for **performance / milestone** logic or an optional secondary “since call” line—not as the only candle input. |

These non-goals align with **removing** unused Playwright scraping modules and **adding** HTTP-first OHLCV (see §1–§2).

---

## 1. What is being removed (and why)

### 1.1 Dead modules (no `require()` path from `index.js`)

**Candidates:** `utils/tokenDataService.js`, `providers/holderIntelligenceProvider.js`, `providers/birdeyeProvider.js`, `providers/historicalMarketProvider.js`, `providers/socialIntelligenceProvider.js`, `providers/tokenIntelligenceProvider.js`, plus configs only consumed by dead `tokenDataService` (`config/scannerConfig.js`, `scanSafetyConfig.js`, `tokenDataBlueprint.js`).

**Why remove (or explicitly quarantine):**

- They **increase cognitive load**—readers assume safety filters or Birdeye/GMGN paths are live when the running bot is **Dex-only** via `realTokenProvider` → `dexScreenerProvider`.
- They **drift from reality**: `tokenDataBlueprint` merge rules and “trash reject” never execute in production, so tuning them is wasted effort unless you wire the pipeline.
- **Security/maintenance:** `holderIntelligenceProvider` pulls Playwright + GMGN; keeping unused scraping code invites dependency updates and policy risk for zero runtime benefit.

**Caveat:** If the *next* milestone is “turn on Birdeye/OHLCV,” **delete only after** you’ve moved any reusable HTTP patterns into a **new** thin provider—or you’ll redo work. Prefer **delete + fresh module** over resurrecting stale merge logic.

### 1.2 “Headless chart capture” as a product direction

**Facts in repo today:**

- **Discord charts** are **not** headless-browser screenshots; they are **`chartjs-node-canvas`** line renders from `priceHistory` (`utils/renderChart.js`).
- **X** uses **static** GeckoTerminal `chart.png` fetch (`utils/chartCapture.js`)—HTTP, not a browser.
- **Playwright** appears only in **unused** `holderIntelligenceProvider.js`, not in the chart pipeline.

**What “removal” means here:**

- **Do not invest** in Playwright-based chart screenshots (Dex/GMGN DOM capture, debug PNGs under `debug/`) as the **primary** chart strategy—**why:** brittle selectors, ToS/load variance, and ops cost (profiles, memory) for marginal gain when server-side charting or API OHLCV is available.
- **Optionally remove** archived `debug/*.html`, `debug/*.png`, `browser-profile*` artifacts from the **repo** (keep locally if you still debug)—**why:** they are not part of the module graph and confuse “how production works.”

**What stays unless replaced:**

- `chartCapture.js` Gecko fetch remains valid as a **cheap** X image until OHLCV candle PNGs (or no image) replace it.

### 1.3 Duplicate / unreachable command paths

**Issue:** `!call` / `!watch` exist in both `index.js` and `commands/basicCommands.js`; `index.js` matches first for `!` messages, so the `basicCommands` branches are **dead** for that entry path.

**Why remove duplication:**

- **Single source of truth** for parsing, error messages, and future side effects (e.g. storing `discordMessageId`).
- Reduces risk that someone “fixes” only one copy.

### 1.4 Dead exports and imports

**Examples:** `getLifecycleChangeReason` imported in `monitoringEngine.js` but never called; exported helpers in `trackedCallsService.js` / `dexScreenerProvider.js` (`fetchDexScreenerCandidatePairs`, `markMilestoneHit`, …) with no external callers.

**Why clean:**

- Static analysis and onboarding should match runtime; dead exports suggest missing features or forgotten migrations.

---

## 2. What is being added (and why)

### 2.1 OHLCV ingestion

**Why:** `priceHistory` is a **scalar MC time series**—good for a simple “line since call” chart, **not** a trader-grade view. OHLCV enables **candles**, volatility, and alignment with how users think about markets.

**Add:**

- A **dedicated fetch path** (HTTP API with key/rate-limit handling), **not** DOM scraping—**why:** testable, schedulable, and consistent with how `dexScreenerProvider` already works.
- **Storage contract** per `docs/DATA_CONTRACTS.md` (inline or sidecar); cap retention by timeframe.

### 2.2 Candlestick (or OHLC bar) rendering

**Why:** Once OHLCV exists, **line-on-MC** and **candles** answer different questions; offering candles on the call embed (or on X) improves signal without pretending MC snapshots are intraday candles.

**Add:**

- Renderer path—either extend `renderChart.js` with a financial chart type supported by `chartjs-node-canvas`, or a **small second renderer**—**why:** isolates risk to chart code; MC line can remain for “since first track.”

### 2.3 Persisted `pairAddress` (and optional pool id discipline)

**Why:** Gecko `chart.png` and future pair APIs want a **pool** address; token mint alone is often wrong. Today `saveTrackedCall` does **not** write `pairAddress` even when the scan has it—**why fix:** fewer silent X chart failures and clearer deep links.

**Add:** One write path from `generateRealScan` / scan normalization into `trackedCalls` (see `DATA_CONTRACTS.md`).

### 2.4 User-call Discord linkage (`discordMessageId` / `discordChannelId`)

**Why:** `monitoringEngine` **reply** threading for milestones requires these; bot calls set them; user calls often **don’t**—**why fix:** consistent UX and fewer “mystery” channel posts.

---

## 3. What is being refactored (and why)

### 3.1 Consolidate X + Gecko chart + post state updates

**Today:** Similar logic exists in `index.js` (`publishApprovedCoinToX`) and `monitoringEngine.js` (`maybePublishApprovedMilestoneToX`).

**Why refactor:** One module (e.g. `utils/xCalloutService.js`) owns **text build, optional chart buffer, createPost, setXPostState**—**why:** bug fixes and copy changes apply once; reduces divergence (e.g. hardcoded “@McGBot” vs real caller).

### 3.2 Command routing

**Why:** One layer (`index.js` *or* `basicCommands.js`) should own `!call` / `!watch` dispatch so argument parsing and telemetry stay consistent.

### 3.3 `trackedCalls.json` access pattern (longer-term)

**Why:** Full-file read/write on hot paths is a **race and scale** liability. Refactor toward **batched writes**, a tiny lock, or embedded DB—**only when** pain is proven (lost updates, slow restarts).

**Why not jump first:** behavior change risk; many flows assume immediate disk read after write.

### 3.4 Lifecycle persistence

**Why:** `determineLifecycleStatus` runs in monitor but **stagnant** transitions may not persist on the main update path—refactor so **lifecycle** reflects reality for `!tracked` and moderation, or **remove** unused computation.

---

## 4. What must stay stable

| Area | Why |
|------|-----|
| **`contractAddress` as primary key** | All services key off it; changing breaks lookups and JSON merges. |
| **Semantic meaning of `firstCalledMarketCap`, `athMc`, `milestonesHit`, `lastPostedX`** | Stats and milestone math assume these definitions; changing without migration corrupts “X from call” history. |
| **`callSourceType` values** `user_call` / `bot_call` / `watch_only` | `callerStatsService`, approval flows, and embeds branch on these strings. |
| **Discord env + intents** | `DISCORD_TOKEN`, message content intent, and channel name contracts (`bot-calls`, `mod-approvals`, etc.) are operational dependencies. |
| **X OAuth env vars** | `xPoster.js` contract for posting; changing auth model is a breaking change. |
| **Existing consumers of `normalizeTrackedCall`** | Any new field should default safely so **old JSON rows** still load (see `DATA_CONTRACTS.md`). |

---

## 5. Sequencing constraints

1. **Document + contract before storage changes**  
   Update `DATA_CONTRACTS.md` for OHLCV / `pairAddress` **before** writing new keys—**why:** avoids orphan data no reader understands.

2. **OHLCV fetch before candlestick UI**  
   Rendering depends on data shape and refresh policy—**why:** avoids shipping empty or stale candles.

3. **Persist `pairAddress` before relying on it for Gecko X charts**  
   **Why:** otherwise production still falls back to mint id and fails silently.

4. **Dead code removal after replacement or explicit “not in roadmap”**  
   **Why:** if Birdeye is the chosen OHLCV source, you may **revive** `birdeyeProvider` instead of deleting—sequence deletion **after** the new provider is merged.

5. **User `discordMessageId` backfill is optional but backward compatible**  
   New calls can populate; old rows stay `null`—**why:** no mandatory migration for historical rows.

6. **Chart type changes**  
   Ship **MC line + candles** in parallel first if needed—**why:** embed size and Discord attachment limits; rollback is easier.

---

## 6. Migration strategy

How to evolve `data/trackedCalls.json` and chart code **without** breaking running bots or stats.

### 6.1 Legacy rows without `priceHistory` or `pairAddress`

**Today:** `normalizeTrackedCall` (`utils/trackedCallsService.js`) treats missing `priceHistory` as `[]`. Missing `pairAddress` is common on disk.

**Strategy:**

- **Do not require** either field for app startup or `getTrackedCall`; keep defaults in the normalizer.
- **Optional backfill for `priceHistory`:** one-off script (or admin command) that, for each row missing `priceHistory` or with `[]`, seeds at least one point, e.g. `{ t: Date.parse(firstCalledAt) || Date.now(), price: Number(firstCalledMarketCap) }` when MC is valid—**why:** immediate line-chart hydrate for legacy rows if you still show MC-over-time lines.
- **Reads:** Chart hydrate paths must handle “no series” gracefully (no throw; clear embed state)—already partially true today.

### 6.2 Backfilling `pairAddress`

**Why:** Gecko `chart.png` and many pair APIs need the **pool** id, not only the token mint.

**Options (pick one or combine):**

1. **Lazy backfill:** On next `generateRealScan` / Dex response, persist `pairAddress` via `updateTrackedCallData` or extended `saveTrackedCall`—**why:** zero downtime; active coins heal first.
2. **Batch script:** For each `contractAddress`, call the same Dex lookup used in `dexScreenerProvider.js`, write `pairAddress` when a best pair is found—**why:** fixes archived rows used for X/history links.
3. **Manual / mod tool:** Rare tokens only; document in admin runbook.

**Safety:** Never overwrite a non-null `pairAddress` with null on a failed fetch; merge conservatively.

### 6.3 Introducing OHLCV without breaking existing logic

**Principles:**

- **Additive storage first:** Add `ohlcv` (or sidecar files) per `docs/DATA_CONTRACTS.md` with **defaults** so old rows parse unchanged.
- **Feature flag or renderer branch:** Candle path reads OHLCV only; if empty, fall back to **documented** behavior (placeholder image, text-only, or legacy line)—**why:** monitor loop, milestones, and `callerStatsService` keep using `firstCalledMarketCap` / `athMc` / `priceHistory` as today until you intentionally change them.
- **Do not repurpose `priceHistory` entries as candles**—see **Non-goals** (no sole coupling of candles to MC snapshots).
- **Rate limits:** Fetch OHLCV on a slower cadence or on-demand at call/hydrate time; avoid N× per-monitor-tick for every coin unless budgeted.

### 6.4 Removing `tokenDataService` / configs

**Migration:** confirm no external script `require()`s them; grep repo and deployment hooks—**why:** some users run ad-hoc Node scripts beside the bot.

### 6.5 Stats / approval invariants

**Do not** rename `approvalStatus`, `xApproved`, or `xPostedMilestones` without updating `setApprovalStatus`, `setXPostState`, and `index.js` handlers—**why:** partial updates cause stuck mod queue or duplicate X posts.

---

## 7. Success criteria

Definitions of **done** for the chart and dependency work described in this plan. Supporting engineering goals follow.

### 7.1 Product / UX

| Criterion | Definition |
|-----------|------------|
| **Charts render immediately on call** | On new or reactivated `!call` and bot auto-call, the user sees a **final chart attachment** (or a deliberate, non-spinning empty state) in the **same** follow-up edit window—without waiting for a future monitor tick. That implies OHLCV or seed data is available at hydrate time, or the renderer blocks on a single bounded API fetch with timeout/fallback. |
| **Candlestick charts replace line charts** | The **primary** Discord chart shown on calls is **candlestick** (or OHLC bar) from **API OHLCV**, not the current MC **line** from `priceHistory`. Any retained line is explicitly secondary or removed. |
| **No headless browser dependency** | `package.json` and production deploy **do not require** Playwright/Chromium for charts or core bot flows. Remove or quarantine scraping modules unless a **separate, documented** non-chart feature needs them. |

### 7.2 Engineering / ops (supporting)

- **Smaller module graph:** `index.js` does not pull unused providers; CI or a script can fail on orphan files.
- **Data contract:** `docs/DATA_CONTRACTS.md` matches `normalizeTrackedCall` and all writers; new fields default safely for old JSON.
- **X images:** Either candle PNG from server render, documented static fallback, or text-only—no dependency on browser screenshot pipelines.

---

*This plan is advisory; prioritize slices that match your release cadence. Update this document when scope changes.*
