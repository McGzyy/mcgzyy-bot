# McGBot Moderator Guide

This guide is for moderators and staff responsible for keeping McGBot useful, clean, and trustworthy.

McGBot is built around **curation over chaos**.
Its value comes from consistent moderation, good judgment, and clean systems.

This guide explains what moderators are responsible for, what tools exist, and how to use them well.

---

## Moderator Role in McGBot

Moderators are not just “approvers.”
You help protect:

* Signal quality
* Trust & reputation integrity
* Attribution quality
* Watchlist quality
* Review consistency
* Overall system cleanliness

Without strong moderation, the system loses value quickly.

---

## Core Moderator Responsibilities

Most moderator work falls into these areas:

* Reviewing submissions
* Managing trust & reputation
* Handling X verification
* Reviewing low-cap entries
* Reviewing dev intel
* Handling membership & referrals
* Resolving moderation queue items
* Keeping tracked systems clean

Do these well and McGBot stays sharp.

---

## 1) The Main Review Hub

McGBot is built around a centralized moderation flow.

### Primary moderation channel

**`#mod-approvals`**

This is the main review hub for:

* X verification requests
* Low-cap submissions
* Dev intel submissions
* Membership claims
* Tracked call review flows
* Top caller reviews
* Future approval workflows

Treat `#mod-approvals` as the **single source of truth** for review activity.

> Legacy channels should not be used unless explicitly still needed.

---

## 2) Low-Cap Review

The Low-Cap system is intentionally curated — not a spam list.

### Approve when:

* The idea is genuinely interesting
* There is a real thesis
* It is not obvious junk or spam
* It adds something useful to the watchlist

### Deny when:

* It’s low effort or vague
* It’s duplicate junk
* It’s pure hype with no reasoning
* There’s no meaningful thesis

> The low-cap list should stay small, useful, and high-signal.

---

### Low-Cap Review Flow

Users submit via:

`!lowcapadd`

This creates a review card in `#mod-approvals`.

**Moderator actions:**

* Approve
* Deny

**Approval:**

* Marks the submission resolved
* Creates the official low-cap entry
* Posts it to `#low-cap-tracker`

**Denial:**

* Resolves the submission
* Prevents it from entering the watchlist

---

## 3) Dev Intel Review

Dev Intelligence is one of McGBot’s most valuable systems.
It must stay clean and credible.

### Approve when:

* Information is specific and useful
* The attribution is believable
* It adds real context

### Deny when:

* It’s vague or speculative
* Attribution is weak or rumor-based
* It’s duplicate or low-quality

> Bad attribution is worse than no attribution.

---

### Dev Intel Review Flow

Users submit via:

`!devsubmit`

This creates a review card in `#mod-approvals`.

**Moderator actions:**

* Approve → creates/updates tracked dev intel
* Deny → blocks weak or low-quality intel

---

## 4) X Verification Review

X verification connects Discord identity to X identity, improving:

* Attribution accuracy
* Milestone credit
* Cross-platform trust

### Approve when:

* Identity is clearly valid

### Deny when:

* Identity is mismatched or unverifiable
* The verification appears manipulated

**Manual command:**
`!verifyx @user`

---

## 5) Membership & Premium Review

McGBot supports real membership infrastructure.

Moderators may assist with:

* Membership claims
* Role syncing
* Manual adjustments
* Referral reward application

---

### Membership Claim Review

Claims create review cards in `#mod-approvals`.

**Approve:**

* Activates/extends membership
* Syncs roles
* Updates membership state

**Deny:**

* Rejects claim without affecting existing valid membership

---

### Membership Commands

* `!memberstatus @user`
* `!syncmemberrole @user`
* `!grantmembership @user <tier> <months>`
* `!extendmembership @user <months>`
* `!compmembership @user <tier> <months?>`
* `!cancelmembership @user`
* `!removemembership @user`

> Use manual changes carefully. Keep membership state explainable.

---

## 6) Referral Management

McGBot includes a referral system for attribution and rewards.

### Common actions:

* `!referralstatus @user`
* `!setreferrer @user @referrer`
* `!clearreferrer @user`
* `!markreferralconverted @user <state>`
* `!referralrewardstatus @user`
* `!grantreferralreward @user <months>`
* `!applyreferralreward @user <months?>`
* `!rewardreferrer @user`

> Keep this system clean, auditable, and abuse-resistant.

---

## 7) Trust & Caller Reputation

Trust levels help distinguish quality and reliability.

### Trust levels:

* `none`
* `approved`
* `top_caller`
* `trusted_pro`
* `restricted`

### Trust commands:

* `!getcallertrust @user`
* `!setcallertrust @user <level>`
* `!topcallercheck @user`
* `!approvetopcaller @user`
* `!removetopcaller @user`

**Guidelines:**

* Reward consistent, high-quality contributors
* Use `restricted` carefully
* `trusted_pro` should remain highly curated

---

## 8) Tracked Calls & Queue Cleanup

Moderators may resolve review items tied to tracked calls.

Common actions on cards:

* Approve
* Deny
* Exclude
* Tag
* Note
* Done

Use these to:

* Clean junk
* Resolve stuck items
* Keep the tracking system accurate

---

## 9) Scanner & Monitoring Controls

Some moderators may have access to scanner controls.

### Commands:

* `!scanner`
* `!scanner on`
* `!scanner off`
* `!monitorstatus`
* `!approvalstats`
* `!pendingapprovals`
* `!recentcalls`
* `!resetmonitor`

⚠️ `!resetmonitor` is destructive. Use with care.

---

## 10) Utility & Maintenance Tools

These are support tools, not everyday commands:

* `!backfillprofiles`
* `!backfillprofiles run`
* `!truestats @user`
* `!truebotstats`
* `!resetbotstats`
* `!addlaunch <dev_wallet> <token_ca>`
* `!testx`

Use only when necessary.

---

## Moderator Principles

These matter more than any command:

### 1) Curated > Automated

Quality beats volume.

### 2) Bad data is expensive

Low-quality data erodes trust fast.

### 3) Review for usefulness

Don’t approve just to clear a queue.

### 4) Protect the signal

Your role is to maintain quality.

### 5) Keep systems clean

Resolve issues, avoid clutter, prevent decay.

---

## Bottom Line

Your job is not just approving things.

Your job is keeping McGBot:

* Useful
* Trustworthy
* Curated
* Clean
* High-signal

That’s what makes the bot valuable.
