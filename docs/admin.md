# McGBot Admin Guide

This guide is for the people responsible for actually operating, maintaining, and shaping McGBot.

If the User Guide explains how to **use** the bot, and the Moderator Guide explains how to **curate** it, this guide explains how to **run** it.

That includes:

- configuration
- permissions
- command surfaces
- system behavior
- maintenance
- operational caution
- future-proofing

McGBot is no longer “just a call bot.”  
It is now a multi-system crypto tracking, curation, moderation, and intelligence platform.

That means admin decisions matter a lot.

---

# What Admins Are Actually Responsible For

At an admin / operator level, you are responsible for protecting:

- system stability
- trust integrity
- channel cleanliness
- permissions
- configuration correctness
- moderation architecture
- data quality
- product direction

If those drift, the bot gets messy fast.

---

# 1) Core System Areas You’re Operating

McGBot currently has several major live systems:

## Public / User-Facing Systems
- coin call tracking
- scanning / lookup
- caller stats and leaderboards
- low-cap watchlist
- dev lookup
- profiles / identity
- X-linked attribution
- membership info

## Moderation / Review Systems
- mod approval queue
- X verification review
- low-cap review
- dev intel review
- tracked call review
- membership claim review
- top caller review

## Admin / Internal Systems
- trust management
- membership state control
- referral state control
- scanner tuning
- monitoring control
- X ingestion / X posting behavior
- data backfill / repair utilities

You are effectively operating a small product platform, not just a Discord utility.

---

# 2) Channel Architecture (Very Important)

Channel discipline matters.

McGBot works best when its systems are routed cleanly and consistently.

---

## Core Intended Channels

### `#mod-approvals`
Primary moderation / review hub.

Used for:
- X verification approvals
- low-cap submissions
- dev intel submissions
- membership claim review
- tracked review flows
- top caller review
- future approval systems

This should be treated as the **main review queue**.

### `#low-cap-tracker`
Public-facing low-cap watchlist output.

Used for:
- approved low-cap watchlist entries

### `#dev-intel`
Public-facing dev lookup / context area.

Used for:
- `!dev`
- `!devcard`
- public dev context interaction

### `#tracked-devs`
Staff-only dev curation area.

Used for:
- editing tracked devs
- adjusting dev notes / tags / launches / identity fields

---

## Important Admin Principle

Do **not** create unnecessary extra channels unless they solve a real problem.

McGBot works better when systems stay centralized and understandable.

That is especially true for moderation queues.

---

# 3) Permissions and Access Control

Permissions matter a lot in McGBot.

Because the bot now includes:

- trust systems
- identity systems
- membership systems
- curation systems
- review systems

…permission mistakes can create real damage.

---

## Recommended permission model

### Regular users
Should only have access to:
- public lookup
- public scan / call tools
- approved submission flows
- profile / identity tools

### Moderators
Should have access to:
- review queue actions
- trust management
- submission resolution
- membership review
- dev curation actions
- moderation utility commands

### Admin / owner
Should have access to:
- scanner tuning
- X posting controls
- owner-only debug / test utilities
- destructive / reset commands
- environment-sensitive features

---

## Important
Do not assume “mods should have everything.”

Some commands are closer to:
- ops tools
- tuning tools
- repair tools
- owner utilities

Those should stay limited.

---

# 4) Important Environment / Config Controls

McGBot depends on environment configuration for a lot of important behavior.

These values should be treated carefully.

---

## Important known environment values

### General / Ownership
- `BOT_OWNER_ID`
- `DISCORD_GUILD_ID`

### X / Social
- `X_MENTION_INGESTION_ENABLED`
- `X_MENTION_POST_REPLIES`
- `X_POST_DRY_RUN`

### Charts / Milestones
- `X_MILESTONE_CHART_ENABLED`
- chart provider settings
- chart tuning settings

### Membership
- `PREMIUM_MEMBER_ROLE_NAME`
- `SOL_MEMBERSHIP_WALLET`
- `SOL_MEMBERSHIP_AMOUNT_SOL`
- `SOL_MEMBERSHIP_TIER`
- `SOL_MEMBERSHIP_MONTHS`

### Optional / infra
- `SOLANA_RPC_URL`

---

## Admin guidance
Before changing env behavior, ask:

- does this affect live moderation flow?
- does this affect public posting?
- does this affect trust / attribution?
- does this affect role sync / membership?
- does this affect X posting or reply behavior?

If yes, change it carefully.

---

# 5) Trust System Administration

The trust system is one of the most important admin-controlled systems in the bot.

It affects:
- how calls are treated
- how users are surfaced
- what reputation they carry
- what special flows they can access

---

## Current trust levels

- `none`
- `approved`
- `top_caller`
- `trusted_pro`
- `restricted`

---

## Important trust rules

### `trusted_pro`
Should stay **highly curated**.

Do not hand this out casually.

This is meant to represent:
- stronger conviction
- stronger context
- higher-value call behavior

### `top_caller`
Should be more flexible than `trusted_pro`, but still meaningful.

### `restricted`
Should be used intentionally when someone should not benefit from normal trust flows.

---

## Key trust commands

- `!getcallertrust @user`
- `!setcallertrust @user <level>`
- `!topcallercheck @user`
- `!approvetopcaller @user`
- `!removetopcaller @user`

### Admin guidance
Trust should stay:
- explainable
- consistent
- defensible later

If you can’t explain why a user has a trust level, that’s usually a sign the system is drifting.

---

# 6) Membership / Premium Administration

McGBot includes a real internal membership system.

This is no longer just a concept.

That means admins are responsible for:

- membership state integrity
- Premium role sync correctness
- manual correction flows
- avoiding entitlement drift

---

## Membership states of note

Qualifying states currently include:
- `active`
- `trial`
- `comped`

---

## Important membership commands

- `!memberstatus @user`
- `!syncmemberrole @user`
- `!grantmembership @user <tier> <months>`
- `!extendmembership @user <months>`
- `!compmembership @user <tier> <months?>`
- `!cancelmembership @user`
- `!removemembership @user`

---

## Admin guidance
Use manual membership actions carefully.

This system should stay:
- intentional
- clean
- non-abusive
- understandable later

If you need to audit membership later, the logic should still make sense.

---

# 7) Referral Administration

The referral system is currently a real internal attribution + reward system.

It supports:

- referrer assignment
- conversion state
- reward credits
- membership reward application

This is still partly manual, so admin discipline matters.

---

## Important referral commands

- `!referralstatus @user`
- `!setreferrer @user @referrer`
- `!clearreferrer @user`
- `!markreferralconverted @user <none|joined|paid|refunded>`
- `!referralrewardstatus @user`
- `!grantreferralreward @user <months>`
- `!applyreferralreward @user <months?>`
- `!rewardreferrer @referredUser`

---

## Admin guidance
Keep this system:
- auditable
- conservative
- non-abusable

Avoid “free-form referral chaos.”

---

# 8) Low-Cap System Administration

The Low-Cap system is one of the most important new product systems.

Its value depends entirely on **quality control**.

---

## What admins should protect

The Low-Cap system should remain:

- curated
- thesis-driven
- useful
- relatively selective
- not spammy

If it turns into a giant junk list, it loses almost all value.

---

## What admins should watch for

- duplicate low-quality submissions
- weak approval habits
- poor moderation standards
- too much noise in `#low-cap-tracker`
- staff over-approving junk

### Important
Low-cap quality matters more than low-cap volume.

---

# 9) Dev Intelligence Administration

Dev Intelligence is one of the strongest foundations in McGBot.

It is also one of the easiest systems to damage if it becomes sloppy.

---

## What admins should protect

The Dev Intelligence system should remain:

- conservative
- specific
- useful
- curation-first
- resistant to rumor pollution

---

## Important principle

Bad dev attribution is worse than no dev attribution.

That should remain a core operating principle.

Never push the system toward weak guessing just because “more data feels better.”

It usually doesn’t.

---

# 10) Scanner / Monitoring Administration

McGBot includes scanner / monitoring systems that can affect:

- auto-call behavior
- tracking flow
- review load
- signal quality
- system noise

These controls should be treated carefully.

---

## Scanner / monitoring commands

- `!scanner`
- `!scanner on`
- `!scanner off`
- `!monitorstatus`
- `!approvalstats`
- `!pendingapprovals`
- `!recentcalls`
- `!resetmonitor`

### Warning
`!resetmonitor` is destructive and should not be used casually.

---

## Admin guidance
If the scanner is too loose, you get junk.

If it is too strict, you miss useful signal.

Tuning should be done carefully, not emotionally.

---

# 11) Threshold / Tuning Controls

Some commands exist specifically to tune scanning / approval behavior.

These are not casual commands.

They directly affect how much junk or signal the bot lets through.

---

## Examples of tuning commands

### Threshold setters
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

---

## Admin guidance
These should only be changed if you understand:

- why they exist
- what system behavior they influence
- what failure mode you are trying to fix

Do not tune blindly.

---

# 12) X Integration / Posting Controls

McGBot includes X-linked systems that may affect:

- mention ingestion
- outbound replies
- milestone post formatting
- test posting
- preview behavior

These are high-visibility systems.

They should be treated carefully.

---

## Relevant commands / tools

- `!testx`
- `!xpostpreview <CA> [milestoneX]`
- owner-side X mention test / intake tools
- env-based X posting controls

---

## Admin guidance
Before changing X behavior, ask:

- does this affect public-facing output?
- does this affect attribution?
- does this affect posting safety?
- does this affect spam risk?
- does this affect trust or perception?

Because it probably does.

---

# 13) Repair / Utility / Backfill Tools

Some admin / ops tools exist for maintenance and repair.

These are useful, but should not be spammed or used blindly.

---

## Utility commands

- `!backfillprofiles`
- `!backfillprofiles run`
- `!truestats @user`
- `!truebotstats`
- `!resetbotstats`
- `!addlaunch <dev_wallet> <token_ca>`

---

## Admin guidance
Use these when needed, not casually.

These are support / maintenance tools — not everyday commands.

---

# 14) Known Operational Risks / Cautions

These are important.

---

## index.js is still heavy
A lot of systems are currently concentrated there.

That means:
- changes can have wider impact than expected
- careless edits can break multiple systems

Do not do giant casual refactors.

---

## Some duplication still exists
Examples include:
- formatting helpers
- caller label resolution
- help / command surfaces

These are real cleanup items, but not emergency refactor targets.

---

## Old review metadata may still reference legacy channels
Because moderation was centralized later, some old stored references may still point at deleted / old channels.

This is expected technical debt.

Do not panic if some old fetch / cleanup behavior fails on legacy refs.

---

## Guild selection can still be fragile
Some logic may still assume a single-guild model in ways that should eventually be hardened.

If McGBot expands to more than one guild, this needs attention.

---

# 15) Product Direction Responsibility

Admins are also responsible for keeping McGBot pointed in the right direction.

That matters more than people think.

McGBot works best when built around these principles:

## 1) Curated > Automated
More automation is not always better.

## 2) Better signal > More features
Feature bloat kills clarity fast.

## 3) Avoid data pollution
Weak data is expensive once it gets into the system.

## 4) Build foundations before flashy layers
Storage, review, moderation, and identity matter more than gimmicks.

## 5) Keep the server readable
Too many noisy systems will eventually make people ignore the bot entirely.

---

# Bottom Line

As an admin, your job is not just to keep McGBot online.

Your job is to keep it:

- stable
- intentional
- high-signal
- trustworthy
- well-routed
- worth using

That is what turns it from “a bot” into an actual useful product.