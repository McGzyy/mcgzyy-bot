# McGBot Moderator Guide

This guide is for moderators and staff who help keep McGBot’s systems clean, useful, and trustworthy.

McGBot is intentionally built around **curation over chaos**.  
A lot of its strongest systems only stay valuable if moderation is consistent.

This guide explains what moderators are responsible for, what tools exist, and how to use them well.

---

# Moderator Role in McGBot

Moderators are not just there to “approve stuff.”

In McGBot, staff helps protect:

- signal quality
- trust quality
- attribution quality
- watchlist quality
- review consistency
- system cleanliness

That matters because almost every good crypto tool becomes useless if nobody protects the signal.

---

# Core Moderator Responsibilities

Most moderator activity in McGBot falls into these buckets:

- reviewing submissions
- managing trust levels
- handling X verification
- handling low-cap entries
- handling dev intel
- handling memberships / referrals
- resolving moderation queue items
- keeping tracked systems clean

If you do those well, the bot stays sharp.

---

# 1) The Main Review Hub

McGBot is designed around a centralized moderation flow.

## Primary moderation channel
`#mod-approvals`

This is the main review hub for things like:

- X verification requests
- low-cap submissions
- dev intel submissions
- SOL membership claims
- tracked call review flows
- top caller review
- future approval systems

### Important
This should be treated as the **single source of truth** for moderation queue activity.

Legacy review channels should not be relied on unless explicitly still in use for some old item.

---

# 2) Low-Cap Review

The Low-Cap system is supposed to be **curated**, not noisy.

That means staff should be selective.

## What moderators should approve
Approve entries that are:

- genuinely interesting
- reasonably explained
- not obvious junk
- not duplicate spam
- not “just low cap bro”
- actually worth watching

A low-cap submission should have at least some kind of thesis.

## What moderators should deny
Deny entries that are:

- low effort
- obvious garbage
- duplicate junk
- pure shill with no reasoning
- too weak / empty to justify tracking

### Important principle
The low-cap system should stay **small and useful**, not big and noisy.

That matters more than submission volume.

---

## Low-Cap Review Flow

Users submit through:

`!lowcapadd`

That creates a review card in `#mod-approvals`.

### Staff actions
Use the review buttons on the card:

- Approve
- Deny

### What approval does
Approval will:

- mark the submission resolved
- create the authoritative low-cap entry
- post the approved entry into `#low-cap-tracker`

### What denial does
Denial will:

- resolve the submission
- prevent it from being added to the watchlist

---

# 3) Dev Intel Review

The Dev Intelligence system is one of the most valuable systems in the bot.

It should stay **clean, conservative, and useful**.

## What moderators should approve
Approve dev intel that is:

- specific
- believable
- useful
- not vague rumor spam
- not clearly weak / bad attribution

## What moderators should deny
Deny submissions that are:

- too vague
- clearly low-confidence guesswork
- duplicate noise
- “I think this is probably the same dev” with no real basis

### Important principle
Bad dev attribution is worse than no dev attribution.

Never approve weak identity data just because it *might* be right.

---

## Dev Intel Review Flow

Users submit through:

`!devsubmit`

That creates a review card in `#mod-approvals`.

### Staff actions
Use the review buttons on the card:

- Approve
- Deny

### What approval does
Approval will typically create or update tracked dev intelligence.

### What denial does
Denial keeps low-quality or weakly-supported intel out of the system.

---

# 4) X Verification Review

X verification helps connect Discord identity and X identity.

That improves:

- attribution
- milestone credit
- trust continuity
- cross-platform context

This is worth keeping clean.

## What to approve
Approve when the verification is clearly valid.

## What to deny
Deny when:

- it’s obviously fake
- it doesn’t match
- the verification is incomplete
- it looks manipulated / low confidence

### Important
This is an identity system.  
Treat it carefully.

---

## X Verification Flow

Users typically submit verification through their profile / verification UI.

That creates a review item in `#mod-approvals`.

### Staff actions
Use the verification buttons on the card:

- Approve
- Deny

### Related mod command
`!verifyx @user`

Use this when you need to manually approve a pending X verification.

---

# 5) Membership / Premium Review

McGBot supports a real internal membership system.

Moderators may help review and resolve:

- SOL membership claims
- manual membership adjustments
- role sync issues
- referral-related reward application

---

## Membership claim review

Users may submit proof of payment / claim flow.

That creates a review item for staff.

### Staff actions
Use the claim buttons:

- Approve
- Deny

### What approval does
Approval may:

- activate / extend membership
- sync Premium role
- update internal membership state

### What denial does
Denial rejects the claim, but should not randomly damage valid existing entitlement.

---

## Helpful membership commands

### `!memberstatus @user`
Check a user’s current membership state.

### `!syncmemberrole @user`
Force role sync if Discord role state is out of sync.

### `!grantmembership @user <tier> <months>`
Grant membership manually.

### `!extendmembership @user <months>`
Extend an active membership.

### `!compmembership @user <tier> <months?>`
Grant a comped membership.

### `!cancelmembership @user`
Cancel active membership.

### `!removemembership @user`
Remove membership.

### Moderator guidance
Use manual membership commands carefully.

Membership state should stay:
- intentional
- explainable
- auditable

---

# 6) Referral Management

McGBot includes a referral system that supports attribution and reward tracking.

Mods may need to help resolve:

- referral attribution
- conversion state
- reward application
- edge cases / cleanup

---

## Referral commands

### `!referralstatus @user`
Check a user’s referral state.

### `!setreferrer @user @referrer`
Set referral attribution manually.

### `!clearreferrer @user`
Clear referral attribution.

### `!markreferralconverted @user <none|joined|paid|refunded>`
Set referral conversion state.

### `!referralrewardstatus @user`
Check referral reward state.

### `!grantreferralreward @user <months>`
Grant referral reward credit.

### `!applyreferralreward @user <months?>`
Apply reward credit into membership time.

### `!rewardreferrer @referredUser`
Optional helper flow for rewarding the referrer.

### Moderator guidance
This system should stay:
- clean
- intentional
- non-abusive
- explainable later if questioned

---

# 7) Trust and Caller Reputation

The trust system is one of the most important moderation tools in McGBot.

It helps separate:
- normal users
- approved callers
- top callers
- trusted pros
- restricted users

This affects how calls are interpreted and surfaced.

---

## Trust commands

### `!getcallertrust @user`
Check a user’s current trust level.

### `!setcallertrust @user <level>`
Set trust level manually.

### `!topcallercheck @user`
Check whether a user looks eligible for top caller consideration.

### `!approvetopcaller @user`
Promote a user to `top_caller`.

### `!removetopcaller @user`
Remove `top_caller` if appropriate.

---

## Trust guidance

### Use trust to reward:
- consistency
- good signal
- strong history
- clear value to the server

### Use restriction carefully for:
- abuse
- low-quality repeated behavior
- obvious trust misuse

### Important
Do **not** casually overwrite `trusted_pro`.

That status should stay curated and intentional.

---

# 8) Tracked Calls / Queue Cleanup

Moderators may also interact with tracked-call review and queue cleanup systems.

This helps keep call tracking clean instead of messy.

---

## Review buttons you may see

Tracked call cards / queue items may include actions like:

- Approve
- Deny
- Exclude
- Tag
- Note
- Done

### What these are for
These tools help moderators:

- resolve review items
- exclude junk
- tag useful context
- add moderation notes
- clean up lingering queue items

---

## Guidance
Use moderation actions to keep tracked call quality high.

Do not overcomplicate normal flow, but do not let obvious junk stay unresolved forever either.

---

# 9) Scanner / Monitoring Controls

Some moderators may also have access to scanner / monitoring controls.

Use these carefully.

---

## Monitoring commands

### `!scanner`
Check scanner state.

### `!scanner on`
Turn scanner / monitoring on.

### `!scanner off`
Turn scanner / monitoring off.

### `!monitorstatus`
Check current monitor / scanner state.

### `!approvalstats`
Check approval queue counts.

### `!pendingapprovals`
Check unresolved approval items.

### `!recentcalls`
See recent bot calls.

### `!resetmonitor`
Reset monitoring / tracked approval state.

### Warning
`!resetmonitor` is destructive and should not be used casually.

Only use it if you understand why you are doing it.

---

# 10) Profiles / Backfill / Utility Staff Tools

Some staff-facing utility commands exist for support and maintenance.

These are not “daily mod commands,” but they can still matter.

---

## Utility commands

### `!backfillprofiles`
Preview missing profile backfill.

### `!backfillprofiles run`
Create missing bot profiles.

### `!truestats @user`
Check “true” user stats including excluded/reset cases.

### `!truebotstats`
Check “true” aggregate bot stats.

### `!addlaunch <dev_wallet> <token_ca>`
Attach a launch to an existing tracked dev.

### `!resetbotstats`
Reset bot stat exclusions / state.

### `!testx`
Test X integration behavior.

### Moderator guidance
Use these carefully and only when you understand the reason.

Some of these are closer to support / operator tools than daily moderation tools.

---

# Moderator Principles

These matter more than any single command.

## 1) Curated > Automated
A smaller, cleaner system is better than a bigger, noisier one.

## 2) Bad data is expensive
Weak attribution, junk watchlist entries, and sloppy approvals damage trust quickly.

## 3) Review for usefulness, not just activity
Not everything needs to be approved just because it was submitted.

## 4) Protect the signal
That is the actual job.

## 5) Keep systems clean
Resolve queue items, avoid unnecessary clutter, and don’t let useful systems rot.

---

# Bottom Line

As a moderator, your job is not just to approve things.

Your job is to help McGBot stay:

- useful
- trustworthy
- curated
- clean
- high-signal

That is what makes the bot valuable in the first place.