# McGBot — Project Handoff

## 1) Project Identity / Current State
McGBot is a Discord-first crypto tracking + moderation bot with X (Twitter) ingestion support. It’s built around:

- **Coin tracking**: `!call` / `!watch`, tracked-call lifecycle, milestone logic, and periodic monitoring.
- **Moderation + queueing**: centralized review items in `#mod-approvals`.
- **Identity + trust**: caller profiles, trust levels, pro/trusted workflows, and X verification.
- **Monetization / ops**: memberships + referrals + role syncing + audit logs.
- **Curated Dev Intelligence**: staff-managed dev database with public lookup and user-submitted intel review.
- **Automatic dev attribution (V1)**: conservative enrichment when strong identity exists (exact wallet/X only).
- **Low-Cap Coin System (V1)**: curated sleeper/revival watchlist with user submissions, mod review, approvals, and public lookup/browse.

## 2) Stable / Existing Systems
High-level “what works today”:

- **Tracked calls**: persistent coin tracking, marketcap snapshots, milestones, lifecycle state, moderation tags/notes.
- **Trust system**: caller trust tiers and gating (includes Trusted Pro).
- **Centralized mod approvals**: queue channel with approve/deny workflows for multiple subsystems.
- **X verification**: request + review + verified role assignment.
- **Memberships**: SOL payment claims, review, role sync, membership event logging.
- **Referrals**: referral attribution + conversion + reward credit logging.
- **Dev Intelligence**: curated registry + public lookup + staff edits + submissions + mod review + audit visibility.
- **Trusted Pro**: pro call payload support in the call post flow (Discord-only narrative in V1).

## 3) Important Architecture / Authoritative Files
This is the “where things live” map.

### Core runtime + routing
- `index.js`
  - Primary Discord event wiring (`messageCreate`, `interactionCreate`)
  - Channel behaviors (scanner channels, dev channels, approvals)
  - Moderation review handlers + periodic sync/cleanup loops
  - NOTE: this file is large and contains a lot of operational glue.

### Call / scan pipeline
- `commands/basicCommands.js`
  - Command parsing for most user/mod commands (`!call`, `!watch`, etc.)
  - Call announcement payload builder + embed composition
  - Call tracking state application and mirror posting for new user calls
- `utils/trackedCallsService.js`
  - JSON-backed tracked call storage + normalization + update helpers
  - **Important:** call schema stability matters; avoid casual changes.
- `utils/solanaAddress.js`
  - Shared Solana CA extraction + CA validation (`isLikelySolanaCA`)
- `providers/solanaAuthorityProvider.js`
  - On-chain RPC lookup for SPL mint authorities (mint/freeze). Factual but **not** “deployer identity.”

### Identity / trust / profiles
- `utils/userProfileService.js`
  - Caller profiles, X handle normalization helpers, public credit resolution, and related utilities
- `utils/proCallText.js`
  - Trusted Pro call narrative formatting / parsing utilities (used by pro call flow)

### Mod approvals / ops logging
- `utils/format.js`
  - Shared formatting helpers (dates, display helpers) used across features
- `utils/membershipRoleSync.js`
  - Membership entitlement → role sync logic
- `utils/membershipEventLog.js`
  - Membership audit/event logging
- `utils/referralEventLog.js`
  - Referral audit/event logging

### Dev Intelligence (curated database)
- `utils/devRegistryService.js`
  - Staff-managed dev registry (wallet primary key + nickname + `xHandle` + tags + launches)
  - Channel assumptions for `#tracked-devs` (staff) and `#dev-intel` (public lookup)
- `utils/devIntelSubmissionService.js`
  - User submission storage for dev↔coin intel (pending + review metadata)
- `utils/devIdentityResolve.js`
  - **Single resolver** for matching wallet/X → tracked dev, with conflict handling
- `utils/devLookupService.js`
  - Public `!dev` lookup model + view builder used by `createDevLookupEmbed`

### Low-Cap Coin System (V1)
- `utils/lowCapRegistryService.js`
  - Approved curated low-cap registry storage + CRUD + normalization/validation
- `utils/lowCapSubmissionService.js`
  - Pending submission storage + approval/denial transitions + normalization/validation
- `data/lowCapRegistry.json`
  - Approved curated low-cap entries (array)
- `data/lowCapSubmissions.json`
  - Pending/review submissions (object with `submissions: []`)

## 4) Important Product / Design Principles
These are non-negotiable patterns that keep McGBot usable and the data clean:

- **Curated > automated**: prefer staff-controlled data for identity/intel systems.
- **Avoid data pollution**: do not auto-write “maybe” associations into curated registries.
- **Mod control matters**: user contributions should route through review flows.
- **Build foundations before automation**: store clean IDs first, then add automation.
- **Keep channels clean**: don’t turn intel channels into spam feeds.
- **Do not over-trust weak attribution**: socials ≠ identity; fuzzy matching ≠ safe.

## 5) Dev Intelligence Summary
Dev Intelligence is now treated primarily as a **curated lookup database** (not an alert feed).

### Channels / workflow
- `#dev-intel` (public): lookup and inspection only (`!dev`, paste wallet/X, `!devsubmit`)
- `#tracked-devs` (mod-only): curated dev database editing (menu-driven edits + audit visibility)
- `#mod-approvals` (mod-only): user submission review + staff audit visibility

### Data model
- **Tracked dev primary key**: wallet address
- **Resolution keys**: wallet, nickname (exact), primary `xHandle` (normalized, no `@`)
- **Submission flow**: user submits wallet/X + CA + notes/tags → review item → mod approve/deny
- **Audit visibility**: major staff edits in `#tracked-devs` emit audit posts to `#mod-approvals`

### Conservative dev attribution (V1)
- Matching uses `resolveTrackedDevIdentity({ wallet, xHandle })`
- Allowed match sources: **exact wallet** and **exact X handle**
- Conflict-safe: wallet+X mismatch → skip attribution
- Persisted call-side link uses `trackedCall.devAttribution` when strong/conflict-free

### Current hard limitation
The current token/provider stack (DexScreener-centric) does **not** reliably surface a deployer/creator wallet.
We added SPL mint authorities (mint/freeze) via RPC as factual identity surfaces, but they are **not a guaranteed deployer identity**.

## 6) Low-Cap Coin System (V1 COMPLETE)
Low-Cap is a **curated sleeper / revival watchlist** system.

- It is **not** a scanner spam feed and **not** a tracked-calls overload.
- V1 supports:
  - dedicated low-cap registry + storage
  - dedicated low-cap submission storage
  - user submissions → moderation review in `#mod-approvals`
  - approve/deny actions
  - approved-entry posts to `#low-cap-tracker`
  - public commands: `!lowcap <CA>`, `!lowcaps`
- Tone: hybrid (alpha-facing, intel-structured)
- Curation level: tight (avoid questionable entries)
- Intended public channel: `#low-cap-tracker`

### Approved registry entry model (V1 summary)
An approved low-cap entry stores:
- `contractAddress` (primary key)
- `name`, `ticker`
- `narrative`, `notes`
- `currentMarketCap`, `previousAthMarketCap`
- `tags[]`
- `lifecycle`: `watching | accumulating | sent | dead`
- `devLink` (optional object; no inference)
- `sourceContext` (submission type + user IDs)
- `metadata` (`createdAt`, `updatedAt` as epoch ms)

### Submission model (V1 summary)
A submission stores:
- `submissionId`
- `status`: `pending | approved | denied`
- `contractAddress`, optional `name`/`ticker`
- required `narrative`, required `notes`
- `currentMarketCap`, `previousAthMarketCap`
- `tags[]`
- submitter: `submittedByUserId`, `submittedByUsername`
- `review` metadata (message/channel IDs, reviewer, timestamps, denial reason)
- `metadata` (`createdAt`, `updatedAt` as epoch ms)

### User-facing submission flow (V1)
- Command: `!lowcapadd`
- Flow: message → button → modal (Discord modals cannot be opened directly from plain prefix text)
- Modal required:
  - Name
  - Contract Address (validated as Solana CA)
  - Narrative
  - Why it’s interesting (maps to submission `notes`)
- Modal optional: ticker / current MC / previous ATH / tags
  - Packed into one field due to Discord modal input limits
  - Numeric-ish inputs are normalized to number/null by the submission service

## 7) Low-Cap Implementation Progress (IMPORTANT)
### Low-Cap V1 completed
- Phase A/B: storage + services
- Phase C: mod approval integration + tracker posting
- Phase D: public lookup/list commands (`!lowcap`, `!lowcaps`)
- Phase E: user submission command + modal (`!lowcapadd`)

### Important implementation notes (preserve)
- Low-Cap uses:
  - `utils/lowCapRegistryService.js`
  - `utils/lowCapSubmissionService.js`
  - `data/lowCapRegistry.json`
  - `data/lowCapSubmissions.json`
- Moderation routing is centralized through `#mod-approvals`
  - Approve/deny buttons
  - **Transaction-safe approval**: if registry creation fails, submission stays `pending`
  - Review message metadata is stored; deleted review messages can be recovered by the periodic sync (re-posted when missing)

### Important current behavior
- `approveLowCapSubmission(...)` **auto-creates** the authoritative registry entry when approval succeeds.
- Approval is transaction-like: no “approved but missing entry” state.
- `normalizeLowCapEntry(...)` / `normalizeLowCapSubmission(...)` preserve stored timestamps.

## 8) Known Tech Debt / Cautions
- `index.js` is still heavy (lots of concerns mixed in one file).
- Formatting is duplicated in places (multiple embed builders, repeated “caller label” logic).
- Some legacy approval metadata can point at missing/deleted channels; cleanup is best-effort.
- Guild selection is fragile in a few helpers (often “first guild” style assumptions).
- Do **not** casually refactor tracked call schema or user profile schema; many systems depend on it.

## 9) Current Roadmap
- Phase 1: Dev Intelligence direction + identity model + lookup UX — **DONE**
- Phase 2: Conservative dev attribution + authority surfaces — **DONE (foundation-level)**
- Phase 3: Low-Cap Coin System (V1) — **DONE**

Future phases (high level):
- moderation hardening + queue consistency
- website/referral integration improvements
- dev attribution expansion (true deployer/creator identity sources)
- outside caller tracking / enrichment
- leaderboard polish
- Telegram expansion

## 10) Current Immediate Next Step
Low-Cap V1 is complete and available (`!lowcap`, `!lowcaps`, `!lowcapadd`).

👉 Next recommended focus (pick based on priorities):
- docs rewrite / cleanup
- moderation / permission hardening
- low-cap polish (optional)
- dev intelligence polish
- website/referral integration later

