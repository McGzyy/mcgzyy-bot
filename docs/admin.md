# McGBot Admin Guide

This guide is for the people responsible for **operating, maintaining, and shaping McGBot**.

If the User Guide explains how to *use* the bot and the Moderator Guide explains how to *curate* it, this guide explains how to *run and steward* it.

As an admin, you are responsible for:

* System stability
* Trust and reputation systems
* Channel architecture
* Permissions and access control
* Configuration and tuning
* Moderation flow integrity
* Data quality and product direction

McGBot is not just a call bot — it is a multi-system crypto tracking, curation, and moderation platform. Admin decisions directly shape its quality and longevity.

---

## 1) What You’re Operating

McGBot consists of several interconnected systems:

### Public / User-Facing Systems

* Coin call tracking
* Scanning & quick lookups
* Caller stats & leaderboards
* Low-cap watchlist
* Dev intelligence lookups
* Profiles & identity (Discord + X)
* Membership visibility & status

### Moderation / Review Systems

* Moderation approval queue
* X verification review
* Low-cap submissions
* Dev intel submissions
* Membership claim review
* Tracked call review
* Top caller review

### Admin / Internal Systems

* Trust system
* Membership & role control
* Referral tracking
* Scanner tuning & monitoring
* X ingestion & posting
* Data maintenance & backfill tools

You are effectively operating a small product platform — not just a Discord bot.

---

## 2) Channel Architecture

McGBot works best when channels remain **purpose-built and consistent**.

### Primary Moderation Channel

#### `#mod-approvals`

Used for:

* X verification approvals
* Low-cap submissions
* Dev intel submissions
* Membership claims
* Call review flows
* Future approval workflows

Treat this as the **main moderation queue**.

### Key Public Channels

#### `#low-cap-tracker`

Public output for approved low-cap watchlist entries.

#### `#dev-intel`

Public space for dev lookup & context (`!dev`, `!devcard`).

#### `#tracked-devs`

Staff-only channel for:

* Editing tracked devs
* Adjusting notes, tags, launches, identity fields

### Admin Principle

> Do not create new channels unless there is a real operational need.

Centralized systems stay easier to manage and trust.

---

## 3) Permissions & Access Control

Because McGBot touches identity, trust, moderation, and reputation, permissions matter.

### Recommended Roles

#### Regular Users

Access to:

* Public scans & lookups
* Making calls & watchlist entries
* Profile and identity tools
* Approved submission flows

#### Moderators

Access to:

* Review queue actions
* Trust management
* Submission resolution
* Dev curation
* Membership review
* Moderation commands

#### Admin / Owner

Access to:

* Scanner tuning
* X posting controls
* System repair tools
* Destructive commands
* Environment-sensitive features

> Do **not** assume moderators should have full access. Some actions are intentionally restricted.

---

## 4) Environment & Configuration

Key environment variables drive core behavior.

### Core

* `BOT_OWNER_ID`
* `DISCORD_GUILD_ID`

### X / Social

* `X_MENTION_INGESTION_ENABLED`
* `X_MENTION_POST_REPLIES`
* `X_POST_DRY_RUN`

### Charts / Milestones

* `X_MILESTONE_CHART_ENABLED`
* Chart provider & rendering configuration

### Membership

* `PREMIUM_MEMBER_ROLE_NAME`
* `SOL_MEMBERSHIP_WALLET`
* `SOL_MEMBERSHIP_AMOUNT_SOL`
* `SOL_MEMBERSHIP_TIER`
* `SOL_MEMBERSHIP_MONTHS`

### Optional

* `SOLANA_RPC_URL`

Before changing environment behavior, ask:

* Will this affect moderation flow?
* Will this change public output?
* Will this affect trust or attribution?
* Will this affect membership or role sync?
* Will this affect X posting behavior?

If yes, proceed carefully.

---

## 5) Trust System Administration

Trust directly impacts:

* How calls are treated
* How users are surfaced
* Reputation and attribution
* Access to higher-signal flows

### Trust Levels

* `none`
* `approved`
* `top_caller`
* `trusted_pro`
* `restricted`

### Guidance

* **trusted_pro** must remain highly curated
* **top_caller** should remain meaningful
* **restricted** should be used intentionally

Trust decisions should be:

* Explainable
* Consistent
* Defensible later

### Trust Commands

* `!getcallertrust @user`
* `!setcallertrust @user <level>`
* `!topcallercheck @user`
* `!approvetopcaller @user`
* `!removetopcaller @user`

---

## 6) Membership Administration

McGBot includes a real internal membership system.

Admins are responsible for:

* Membership state accuracy
* Premium role sync
* Manual corrections
* Preventing entitlement drift

### Membership States

* `active`
* `trial`
* `comped`

### Membership Commands

* `!memberstatus @user`
* `!syncmemberrole @user`
* `!grantmembership @user <tier> <months>`
* `!extendmembership @user <months>`
* `!compmembership @user <tier> <months?>`
* `!cancelmembership @user`
* `!removemembership @user`

---

## 7) Referral System Administration

The referral system tracks:

* Referrer attribution
* Conversion state
* Rewards and credits

### Commands

* `!referralstatus @user`
* `!setreferrer @user @referrer`
* `!clearreferrer @user`
* `!markreferralconverted @user <none|joined|paid|refunded>`
* `!referralrewardstatus @user`
* `!grantreferralreward @user <months>`
* `!applyreferralreward @user <months?>`
* `!rewardreferrer @referredUser`

Keep this system:

* Auditable
* Conservative
* Abuse-resistant

---

## 8) Low-Cap System Administration

The low-cap system’s value depends on curation quality.

Admins should ensure:

* Submissions have a thesis
* Low-effort or duplicate spam is denied
* Noise does not overwhelm signal

> Low-cap quality matters more than quantity.

---

## 9) Dev Intelligence Administration

Dev intelligence must remain:

* Conservative
* Specific
* Useful
* Resistant to rumor

> Bad attribution is worse than no attribution.

---

## 10) Scanner & Monitoring Controls

These systems influence:

* Auto-call behavior
* Tracking flow
* Noise levels
* Review load

### Commands

* `!scanner`
* `!scanner on`
* `!scanner off`
* `!monitorstatus`
* `!approvalstats`
* `!pendingapprovals`
* `!recentcalls`
* `!resetmonitor`

> `!resetmonitor` is destructive — use carefully.

---

## 11) Tuning & Threshold Controls

These settings directly affect signal quality.

### Thresholds

* `!setminmc <value>`
* `!setminliq <value>`
* `!setminvol5m <value>`
* `!setminvol1h <value>`
* `!setmintxns5m <value>`
* `!setmintxns1h <value>`
* `!setapprovalx <value>`
* `!setapprovalladder <values>`

### Sanity Filters

* `!setsanityminmc <value>`
* `!setsanityminliq <value>`
* `!setsanityminliqratio <value>`
* `!setsanitymaxliqratio <value>`
* `!setsanitymaxratio5m <value>`
* `!setsanitymaxratio1h <value>`

> Never tune blindly. Understand the downstream effects.

---

## 12) X Integration & Posting

X integrations affect:

* Public posting
* Reputation
* Attribution

### Tools

* `!testx`
* `!xpostpreview <CA> [milestoneX]`

Treat X posting changes carefully — mistakes are public.

---

## 13) Repair & Maintenance Tools

Use these when needed, not casually.

* `!backfillprofiles`
* `!truestats @user`
* `!truebotstats`
* `!resetbotstats`
* `!addlaunch <dev_wallet> <token_ca>`

---

## 14) Known Risks & Technical Notes

* `index.js` is currently heavy and high-impact
* Some duplicate logic exists
* Legacy moderation data may reference old channels
* Guild handling assumes a single-server model

Be cautious with large refactors.

---

## 15) Admin Philosophy

McGBot works best when guided by these principles:

* **Curated > Automated**
* **Signal > Feature bloat**
* **Avoid data pollution**
* **Strengthen foundations first**
* **Keep the server readable**

---

## Bottom Line

Your job as an admin is to keep McGBot:

* Stable
* High-signal
* Trustworthy
* Well-routed
* Worth using

That is what turns McGBot into a real product, not just a bot.
