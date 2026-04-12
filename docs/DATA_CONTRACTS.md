# Data contracts — `trackedCalls.json`

**Scope:** Objects stored in `data/trackedCalls.json` (array of call records).

**Authority:** `utils/trackedCallsService.js` (`normalizeTrackedCall`, `saveTrackedCall`, `reactivateTrackedCall`, `updateTrackedCallData`, `setApprovalStatus`, `setXPostState`, stats helpers).

**Maintenance:** When you add fields or change semantics, update this file and `SYSTEM_MAP.md` in the same change.

---

## 1. File-level contract

| Rule | Detail |
|------|--------|
| **Root** | MUST be a JSON **array** (or file missing / empty → loader may create `[]`). |
| **Elements** | Each element SHOULD be one **tracked call object** keyed by unique `contractAddress`. |
| **Persistence** | Whole file is rewritten on many operations; no per-row locking. |

---

## 2. Load-time normalization (critical)

On every `loadTrackedCalls()`, each object is passed through **`normalizeTrackedCall`** then **`refreshPublicCallerName`**.

**Implication:** Many keys **MAY be omitted on disk**; after load they still behave as follows:

- Missing `milestonesHit`, `dumpAlertsHit`, `priceHistory`, `moderationTags`, `approvalMilestonesTriggered`, `xPostedMilestones` → treated as **empty array** `[]` (except see `priceHistory` below).
- Missing booleans / strings → defaults as in §4.
- **`priceHistory`:** if key missing or not an array → **`[]`** in memory after normalize.

So: **raw JSON is permissive**; **in-memory contract after load is stricter** for array/object-shaped fields.

---

## 3. Identity: `callSourceType`

| Value | Meaning |
|-------|---------|
| `user_call` | Human issued `!call` (or upgraded from `watch_only` / `bot_call`). |
| `bot_call` | `AUTO_BOT` / McGBot auto-call path. |
| `watch_only` | `!watch`; no caller credit. |

**MUST** resolve to one of the above after normalize (default **`user_call`** if missing).

**`refreshPublicCallerName`** may **force** `callSourceType: 'bot_call`** if IDs/usernames look like the bot (`AUTO_BOT`, `McGBot`), even if the file said otherwise—treat as canonical at runtime.

---

## 4. Field reference — MUST vs MAY

Legend:

- **MUST (normalized):** After `normalizeTrackedCall`, the loader guarantees this key exists with the given type/shape (possibly default).
- **MUST (persisted new row):** `saveTrackedCall` for a **new** call writes this key.
- **MAY:** Optional for behavior; may be absent on disk until something sets it.
- **SHOULD** for feature X:** Required only if you want that feature to work reliably.

### 4.1 Core token / market snapshot

| Field | MUST (normalized) | MUST (new save) | Notes |
|-------|-------------------|-----------------|--------|
| `contractAddress` | NO (but **required** for lookups; missing breaks `getTrackedCall`) | YES | Solana mint CA string. **Primary key.** |
| `tokenName` | NO | YES (from scan) | |
| `ticker` | NO | YES (from scan) | |
| `firstCalledMarketCap` | NO | YES | Entry MC at call time. |
| `latestMarketCap` | NO | YES | Updated by monitor / saves. |
| `athMc` | NO | YES | Monotonic max MC tracked by app logic. |
| `entryScore` | NO | YES | |
| `grade` | NO | YES | |
| `alertType` | NO | YES | |
| `firstCalledAt` | NO | YES | ISO string. |
| `lastUpdatedAt` | NO | YES | ISO string on each meaningful save/update. |
| `pairAddress` | NO | **NO** (not written by `saveTrackedCall` today) | **MAY** on disk if you add persistence. Used by X/Gecko chart when present. See §8. |
| `ath` | NO | NO | **MAY**; set by `refreshTrackedCallLive` / legacy; stats code also reads `ath` / `athMarketCap` as aliases for ATH. |
| `percentFromAth` | NO | NO | **MAY** |
| `migrated` | NO | NO | **MAY** (e.g. `refreshTrackedCallLive`) |
| `holders` | NO | NO | **MAY** |
| `top10HolderPercent` | NO | NO | **MAY** |
| `devHoldingPercent` | NO | NO | **MAY** |
| `bundleHoldingPercent` | NO | NO | **MAY** |
| `sniperPercent` | NO | NO | **MAY** |

### 4.2 Caller attribution

| Field | `user_call` | `bot_call` | `watch_only` |
|-------|-------------|------------|----------------|
| `firstCallerId` | SHOULD be Discord snowflake string | MUST be `'AUTO_BOT'` (after refresh) | MAY be `null` |
| `firstCallerDiscordId` | SHOULD match caller | `'AUTO_BOT'` | MAY be `null` |
| `firstCallerUsername` | SHOULD be set | `'McGBot'` | MAY be `null` |
| `firstCallerDisplayName` | SHOULD be set | `'McGBot'` | MAY be `null` |
| `firstCallerPublicName` | SHOULD be resolved label | `'McGBot'` | MAY be `null` or display-derived |

None of these are enforced by JSON schema; **normalize + refresh** rewrite bot-like rows.

### 4.3 Lifecycle & activity

| Field | MUST (normalized) | Default | Notes |
|-------|-------------------|---------|--------|
| `lifecycleStatus` | YES | `'active'` | Also `'stagnant'`, `'archived'` used in logic. |
| `isActive` | YES | `true` | `false` when archived / hard-stopped. |
| `milestonesHit` | YES (array) | `[]` | Discord ladder keys, e.g. `'2x'`, `'4x'`, … |
| `dumpAlertsHit` | YES (array) | `[]` | e.g. `'-35%'`, `'-55%'` |
| `lastPostedX` | YES (number) | `0` | Discord milestone spacing state (numeric “X” last posted). |
| `failedScans` | NO | — | **MAY**; incremented by monitor when scan/MC invalid. |

### 4.4 `priceHistory`

**Purpose:** Time series of **scalar “price”** (in practice **market cap USD**) for line charts and history.

**MUST (normalized):** `priceHistory` is always an **array** after load (possibly empty).

**On disk:** Key **MAY be missing** (legacy rows).

**Element shape (each point):**

| Property | Required | Notes |
|----------|----------|--------|
| `t` | **SHOULD** | Unix ms (number) — **primary writer** in current code. |
| `price` | **SHOULD** | Number (MC at sample time). |
| `ts` / `timestamp` | MAY | **Reader** (`seriesFromTrackedPriceHistory`) accepts as time fallback. |
| `mc` / `marketCap` | MAY | **Reader** accepts as value fallback for `price`. |

**Writers:**

- `saveTrackedCall` / `reactivateTrackedCall`: append `{ t: Date.now(), price: mc }`.
- `monitoringEngine` `checkTrackedCoins`: append same; cap **500** tail.

**Contract:** For chart generation, at least one point with finite **time** and **value** after coalescing rules above.

---

## 5. OHLCV — future shape (not implemented)

**Today:** No OHLCV arrays are stored or read in production chart code.

**Proposed optional extension (choose one style and stick to it):**

### Option A — inline on call object

```json
"ohlcv": {
  "timeframe": "5m",
  "bars": [
    {
      "t": 1712000000000,
      "o": 1.23,
      "h": 1.25,
      "l": 1.20,
      "c": 1.24,
      "v": 12345.67
    }
  ],
  "source": "birdeye",
  "updatedAt": "2026-04-11T12:00:00.000Z"
}
```

### Option B — sidecar / keyed cache

Path like `data/ohlcv/<contractAddress>.json` with the same `bars` array; call object holds only `ohlcvRef` or `lastOhlcvAt`.

**MUST** for any future reader: document `timeframe`, unit of `v`, and whether `t` is open time, close time, or bucket start.

---

## 6. Discord message / channel linkage

| Field | MUST (normalized) | Purpose |
|-------|-------------------|---------|
| `discordMessageId` | NO (`null` if missing) | Message to **reply** to for milestones/dumps when channel matches. |
| `discordChannelId` | NO (`null` if missing) | If set, reply only when alert channel **equals** this id. |

**Current writers:**

- **Bot auto-call:** `updateTrackedCallData` sets **both** after `channel.send` (`utils/autoCallEngine.js`).
- **User `!call`:** `saveTrackedCall` sets `discordMessageId: null` for new rows; **not** auto-filled from the reply message today.

**SHOULD for threaded milestone alerts:** non-null `discordMessageId` and matching `discordChannelId` (or omit channel id to allow same-channel reply fallback per `buildReplyOptions` in `monitoringEngine.js`).

---

## 7. Approval & X state

### 7.1 Mod approval (Discord)

| Field | MUST (normalized) | Typical values |
|-------|-------------------|----------------|
| `approvalStatus` | YES | `'none'`, `'pending'`, `'approved'`, `'denied'`, `'excluded'`, `'expired'` |
| `approvalMessageId` | NO | Mod queue message id |
| `approvalChannelId` | NO | Usually `#mod-approvals` channel id |
| `approvalRequestedAt` | NO | ISO |
| `approvalExpiresAt` | NO | ISO |
| `lastApprovalTriggerX` | YES (number) | `0` or ATH multiple that opened review |
| `approvalMilestonesTriggered` | YES (array) | Numbers (e.g. `[4, 5]`) — ladder rungs already used for approval |

**Pending queue filter** (`getPendingApprovals`): needs `approvalStatus === 'pending'`, `approvalRequestedAt`, and **`approvalMessageId`**.

### 7.2 Moderation metadata

| Field | MUST (normalized) | Notes |
|-------|-------------------|--------|
| `excludedFromStats` | YES | boolean |
| `moderationTags` | YES | `string[]` |
| `moderationNotes` | YES | string |
| `moderatedById` | NO | |
| `moderatedByUsername` | NO | |
| `moderatedAt` | NO | ISO |

### 7.3 X (Twitter) posting

| Field | MUST (normalized) | Notes |
|-------|-------------------|--------|
| `xApproved` | YES | `true` only after mod **approved** (`setApprovalStatus`) |
| `xPostedMilestones` | YES | `number[]` — ladder multiples already posted |
| `xOriginalPostId` | NO | First tweet id |
| `xLastReplyPostId` | NO | Latest reply id |
| `xLastPostedAt` | NO | ISO |

**Note:** X text/chart code may read **`pairAddress`** from the call for Gecko chart PNG; if missing, falls back to `contractAddress` (may be wrong pool id for Gecko).

---

## 8. Expected / future fields

| Field | Status | Intended use |
|-------|--------|----------------|
| `pairAddress` | **MAY** on disk; **not** set by `saveTrackedCall` in current code | Dex/Gecko **pool** id; Gecko `chart.png`, quick links, future Birdeye pair APIs. **SHOULD** be persisted from `generateRealScan` / `normalizeRealDataToScan` when adding write path. |
| `poolAddress` | **Not used** in codebase | Reserved if you need explicit naming distinct from `pairAddress` (e.g. raw DEX pool vs Gecko id)—define one canonical field to avoid drift. |
| `discordMessageId` / `discordChannelId` for **user** calls | **SHOULD** if you want reply threading | Populate from `message.reply` result after `!call`. |
| `ohlcv` | Future | See §5. |
| `calledAt` / `createdAt` | **MAY** (legacy sort only) | `getRecentBotCalls` sorts by these if present; primary timeline field is **`firstCalledAt`**. |

---

## 9. Stats reset audit trail

When `excludeTrackedCallsFromStatsByCaller` or `excludeTrackedBotCallsFromStats` runs, these **MAY** appear:

| Field | Type |
|-------|------|
| `statsResetAt` | ISO string |
| `statsResetById` | string (Discord id) |
| `statsResetByUsername` | string |
| `statsResetReason` | string |
| `statsResetHistory` | array of `{ resetAt, resetById, resetByUsername, resetReason }` |

Not added by `normalizeTrackedCall` defaults; purely **optional** extensions on affected rows.

---

## 10. Summary table — minimum viable row

For a **new** call created by `saveTrackedCall`, persisted fields include at least:

`tokenName`, `ticker`, `contractAddress`, `firstCalledMarketCap`, `latestMarketCap`, `entryScore`, `grade`, `alertType`, caller fields (per type), `firstCalledAt`, `lastUpdatedAt`, `milestonesHit`, `dumpAlertsHit`, `lifecycleStatus`, `isActive`, `athMc`, `discordMessageId`, `priceHistory` (or `[]`), `callSourceType`, `wasWatched`, full approval/X/moderation defaults.

Anything else is **MAY** until a code path writes it.

---

*See also: `docs/SYSTEM_MAP.md` for flows and module ownership.*
