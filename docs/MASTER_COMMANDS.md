# McGBot Master Commands Reference

This is the authoritative internal reference for McGBot’s currently available commands, actions, and user flows.

This file is intentionally more complete than the user, mod, or admin guides. It exists to document the **actual live command surface** so the rest of the docs can stay cleaner and more audience-specific.

If a command exists in code, it should be represented here — even if it’s internal, niche, or not meant for normal users.

---

# 1) Regular User Commands

These commands are generally available to normal users without special permissions.

---

## Basic / Utility

### `!ping`
**Usage:** `!ping`  
**Who can use it:** Anyone  
**What it does:** Basic alive check. Returns “Pong!”

### `!status`
**Usage:** `!status`  
**Who can use it:** Anyone  
**What it does:** Returns a basic bot online/status line.

### `!help` / `!commands`
**Usage:** `!help` or `!commands`  
**Who can use it:** Anyone  
**What it does:** Shows a basic command list.

**Notes:**
- There appears to be both a plain-text help implementation and an embed-based implementation in the codebase.
- The current live help path should be treated as the authoritative one until cleaned up.

---

## Membership / Profile

### `!membership`
**Usage:** `!membership`  
**Who can use it:** Anyone  
**What it does:** Shows membership / Premium info and payment flow entry points.

### `!premium`
**Usage:** `!premium`  
**Who can use it:** Anyone  
**What it does:** Shows premium-related info.

### `!plans`
**Usage:** `!plans`  
**Who can use it:** Anyone  
**What it does:** Shows available plan / membership information if configured.

### `!profile`
**Usage:** `!profile` or `!profile @user`  
**Who can use it:** Anyone  
**What it does:** Shows a user profile card.

### `!myprofile`
**Usage:** `!myprofile`  
**Who can use it:** Anyone  
**What it does:** Shortcut for viewing your own profile.

### `!credit <mode>`
**Usage:**  
- `!credit anonymous`
- `!credit discord`
- `!credit xtag`

**Who can use it:** Anyone  
**What it does:** Sets how your caller credit is displayed on tracked calls.

**Notes:**
- `xtag` requires X verification.

---

## Calls / Tracking / Scan

### `!call <ca>`
**Usage:** `!call <SOLANA_CA>`  
**Who can use it:** Anyone  
**What it does:** Creates an official tracked call with caller credit.

### `!watch <ca>`
**Usage:** `!watch <SOLANA_CA>`  
**Who can use it:** Anyone  
**What it does:** Starts tracking a coin without caller credit.

### `!tracked`
**Usage:** `!tracked`  
**Who can use it:** Anyone  
**What it does:** Shows tracked-call summary information.

### `!tracked <ca>`
**Usage:** `!tracked <SOLANA_CA>`  
**Who can use it:** Anyone  
**What it does:** Shows tracked-call detail for a specific CA.

### `!ca <ca>`
**Usage:** `!ca <SOLANA_CA>`  
**Who can use it:** Anyone  
**What it does:** Runs a compact intel scan without starting tracking.

### `!scan`
**Usage:** `!scan`  
**Who can use it:** Anyone  
**What it does:** Shows a simulated scan embed.

### `!scan <ca>`
**Usage:** `!scan <SOLANA_CA>`  
**Who can use it:** Anyone  
**What it does:** Runs a simulated deeper scan for a specific CA.

### `!testreal <ca>`
**Usage:** `!testreal <SOLANA_CA>`  
**Who can use it:** Anyone  
**What it does:** Performs a live provider fetch and returns a more debug-style result.

### `!autoscantest [profile]`
**Usage:**  
- `!autoscantest`
- `!autoscantest conservative`
- `!autoscantest balanced`
- `!autoscantest aggressive`

**Who can use it:** Anyone  
**What it does:** Simulates an auto-alert filter run using mock setups.

---

## Caller Stats / Public Leaderboards

### `!caller <name>` / `!caller @user`
**Usage:** `!caller <name>` or `!caller @user`  
**Who can use it:** Anyone  
**What it does:** Shows caller stats.

### `!callerboard`
**Usage:** `!callerboard`  
**Who can use it:** Anyone  
**What it does:** Shows top caller leaderboard.

### `!botstats`
**Usage:** `!botstats`  
**Who can use it:** Anyone  
**What it does:** Shows aggregate McGBot stats.

### Performance windows
These are user-facing leaderboard / performance snapshot commands.

#### `!bestcall24h`
#### `!bestcallweek`
#### `!bestcallmonth`
**What they do:** Show best user call in the selected timeframe.

#### `!topcaller24h`
#### `!topcallerweek`
#### `!topcallermonth`
**What they do:** Show top caller in the selected timeframe.

#### `!bestbot24h`
#### `!bestbotweek`
#### `!bestbotmonth`
**What they do:** Show best bot call in the selected timeframe.

---

## Dev Intelligence (Public)

### `!dev <wallet | @x | nickname>`
**Usage:** `!dev <wallet | @x | nickname>`  
**Who can use it:** Anyone  
**What it does:** Looks up tracked dev context.

### `!devcard <wallet | @x | nickname>`
**Usage:** `!devcard <wallet | @x | nickname>`  
**Who can use it:** Anyone  
**What it does:** Shows a cleaner dev profile-style card.

### `!devleaderboard`
**Usage:** `!devleaderboard`  
**Who can use it:** Anyone  
**What it does:** Shows dev leaderboard information.

---

## Low-Cap Watchlist (Public)

### `!lowcap <ca>`
**Usage:** `!lowcap <SOLANA_CA>`  
**Who can use it:** Anyone  
**What it does:** Looks up a tracked low-cap watchlist entry.

### `!lowcaps`
**Usage:** `!lowcaps`  
**Who can use it:** Anyone  
**What it does:** Lists current curated low-cap entries.

### `!lowcapadd`
**Usage:** `!lowcapadd`  
**Who can use it:** Anyone  
**What it does:** Starts the low-cap submission flow.

---

# 2) Trusted / Special User Commands

These commands are not for normal users, but also aren’t standard moderator tools.

---

### `!procall <ca> | <title> | <why> | <risk?>`
**Usage:** `!procall <ca> | <title> | <why> | <risk?>`  
**Who can use it:** Users with `trusted_pro` trust level  
**What it does:** Creates a structured Trusted Pro call.

**Notes:**
- This is intentionally gated.
- It is designed for higher-conviction / higher-context calls.

---

# 3) Moderator Commands

These commands are intended for moderators / staff with appropriate permissions (typically Manage Server or equivalent).

---

## Scanner / Monitoring

### `!scanner`
**Usage:** `!scanner`  
**What it does:** Shows scanner ON/OFF state.

### `!scanner on`
### `!scanner off`
**What they do:** Start or stop the monitoring / auto-call loop.

### `!monitorstatus`
**Usage:** `!monitorstatus`  
**What it does:** Shows monitor summary counts and scanner state.

### `!resetmonitor`
**Usage:** `!resetmonitor`  
**What it does:** Clears tracked coins, pending approvals, and monitoring state.

**Warning:** Destructive.

---

## Approval Queue / Review Visibility

### `!approvalstats`
**Usage:** `!approvalstats`  
**What it does:** Shows approval queue counts.

### `!pendingapprovals`
**Usage:** `!pendingapprovals`  
**What it does:** Shows pending review items.

### `!recentcalls`
**Usage:** `!recentcalls`  
**What it does:** Shows recent bot calls.

---

## Caller Trust / Reputation Management

### `!getcallertrust @user`
**What it does:** Shows current caller trust level.

### `!setcallertrust @user <level>`
**What it does:** Sets caller trust level.

### `!topcallercheck @user`
**What it does:** Shows top caller eligibility / context.

### `!approvetopcaller @user`
**What it does:** Promotes a user to `top_caller`.

### `!removetopcaller @user`
**What it does:** Removes `top_caller` status.

**Notes:**
- `trusted_pro` should be treated as curated and not casually overwritten.

---

## Membership / Referral Operations

### `!memberstatus @user`
Shows membership and referral state.

### `!syncmemberrole @user`
Forces Premium role sync.

### `!grantmembership @user <tier> <months>`
Grants membership.

### `!extendmembership @user <months>`
Extends membership.

### `!compmembership @user <tier> <months?>`
Comped membership grant.

### `!cancelmembership @user`
Cancels membership.

### `!removemembership @user`
Removes membership.

### Referral operations
#### `!referralstatus @user`
#### `!setreferrer @user @referrer`
#### `!clearreferrer @user`
#### `!markreferralconverted @user <none|joined|paid|refunded>`
#### `!referralrewardstatus @user`
#### `!grantreferralreward @user <months>`
#### `!applyreferralreward @user <months?>`
#### `!rewardreferrer @referredUser`

**What they do:** Manage referral attribution and reward credits.

---

## Dev Registry / Dev Ops

### `!addlaunch <dev_wallet> <token_ca>`
**Usage:** `!addlaunch <dev_wallet> <token_ca>`  
**What it does:** Adds a launch to an existing tracked dev.

### `!verifyx @user`
**Usage:** `!verifyx @user`  
**What it does:** Approves a pending X verification request manually.

### `!backfillprofiles`
### `!backfillprofiles run`
**What they do:** Preview or create missing bot profiles.

### `!resetbotstats`
**What it does:** Resets bot-call stat exclusions.

### `!truestats @user`
**What it does:** Shows “true” user stats including excluded/reset calls.

### `!truebotstats`
**What it does:** Shows “true” aggregate bot stats.

### `!testx`
**What it does:** Sends a test X post via integration.

---

# 4) Admin / Owner Commands

These are restricted to the configured bot owner or highest-level operator.

---

## X / Posting Utilities

### `!xpostpreview <CA> [milestoneX]`
**Who can use it:** Bot owner only  
**What it does:** Previews milestone X post output without posting.

---

## Scanner / Threshold Controls

### Threshold setters
These commands tune scanner / approval thresholds.

- `!setminmc <number>`
- `!setminliq <number>`
- `!setminvol5m <number>`
- `!setminvol1h <number>`
- `!setmintxns5m <number>`
- `!setmintxns1h <number>`
- `!setapprovalx <number>`
- `!setapprovalladder <comma-separated values>`

### Sanity filter setters
- `!setsanityminmc <number>`
- `!setsanityminliq <number>`
- `!setsanityminliqratio <number>`
- `!setsanitymaxliqratio <number>`
- `!setsanitymaxratio5m <number>`
- `!setsanitymaxratio1h <number>`

### X ingestion test/apply controls
- `!testxintake ...`
- `!testxmention ...`

**Notes:**
- Mods/owner may be able to dry-run some of these flows.
- Owner-only apply behavior should be treated as authoritative.

---

# 5) Non-Command User Actions / Interaction Flows

These are real bot entry points even if they are not traditional `!commands`.

They matter and should be documented.

---

## Profile / Credit Buttons

### `profile_set_credit:<mode>`
**Who can use it:** User on their own profile  
**What it does:** Changes caller credit display mode.

### `profile_open_verify_modal`
**Who can use it:** User  
**What it does:** Opens X verification modal.

---

## X Verification Flow

### Modal: `verify_x_handle_modal`
**What it does:** Starts X verification request.

### Button: `xverify_submit_review`
**What it does:** Sends verification request into staff review.

### Buttons:
- `xverify_accept:<userId>:<handle>`
- `xverify_deny:<userId>:<handle>`

**What they do:** Approve or deny X verification.

### Modal: `xverify_deny_modal:<userId>:<handle>`
**What it does:** Captures deny reason.

---

## Dev Intel Submission Flow

### `!devsubmit`
**Who can use it:** Users in allowed dev channels  
**What it does:** Starts the dev intel submission flow.

### Button: `devintel_open_submit_modal`
Opens the dev intel modal.

### Modal: `devintel_submit_modal`
Creates a pending dev intel submission.

### Buttons:
- `devintel_approve:<submissionId>`
- `devintel_deny:<submissionId>`

Used by staff to resolve dev intel submissions.

---

## Low-Cap Submission Flow

### `!lowcapadd`
Starts the low-cap submission flow.

### Button: `lowcap_open_submit_modal`
Opens the low-cap modal.

### Modal: `lowcap_submit_modal`
Creates a pending low-cap submission.

### Buttons:
- `lowcap_approve:<submissionId>`
- `lowcap_deny:<submissionId>`

Used by staff to resolve low-cap submissions.

---

## Coin Approval / Tracked Call Moderation

### Buttons:
- `approve_call:<ca>`
- `deny_call:<ca>`
- `exclude_call:<ca>`

Used by staff to resolve tracked call moderation items.

### Follow-up buttons:
- `tag_call:<ca>`
- `note_call:<ca>`
- `done_call:<ca>`

### Modals:
- `tag_modal:<ca>`
- `note_modal:<ca>`

These allow staff to tag or annotate tracked calls.

---

## Call / Watch Buttons

### Buttons:
- `call_coin:<ca>`
- `watch_coin:<ca>`

**Who can use them:** Generally anyone who can see them  
**What they do:** Trigger tracked call / watch behavior from a button interaction.

---

## SOL Membership Claim Flow

### Button: `solmember_open_claim_modal`
Opens membership claim modal.

### Modal: `solmember_claim_modal`
Submits SOL payment proof.

### Buttons:
- `solmember_approve:<userId>`
- `solmember_deny:<userId>`

Used by staff to resolve membership claims.

---

## Top Caller Review Buttons

### Buttons:
- `topcaller_approve:<userId>`
- `topcaller_dismiss:<userId>`

Used by staff to approve or dismiss top caller candidates.

---

# 6) Background / Automated Behaviors

These are not user-entered commands, but they are real parts of the system.

---

## Auto-scan on pasted CA
If a user posts a short message containing a valid Solana contract address, McGBot may automatically run a scan depending on channel behavior.

---

## X mention ingestion
When enabled, McGBot can ingest qualifying X mentions in the background and process them into tracked behavior.

This is environment-driven and not a standard command flow, but it is a real user-visible system.

---

# 7) Known Ambiguities / Cleanup Notes

These are worth preserving for future cleanup.

- Some commands appear duplicated or shadowed by `index.js` handling.
- `!help` / `!commands` likely have multiple implementations.
- `!caller`, `!callerboard`, and `!botstats` may have duplicate plain-text and embed paths.
- Some commands appear more debug/ops-oriented than true public features.
- Some user-visible copy may still contain outdated wording.
- Some “anyone can use this” flows may still rely more on channel placement than explicit permission checks.

This file should be updated as command surfaces evolve.