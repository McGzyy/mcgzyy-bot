# McGBot Master Commands Reference

This is the authoritative reference for all McGBot commands, actions, and interaction flows.

This document is intentionally more complete than the user, mod, or admin guides. It reflects the **real command surface**, including:

* Public commands
* Moderator tools
* Admin tools
* Owner-only controls
* Non-command interaction flows
* Background behaviors

If it exists in the bot, it belongs here.

---

## 1) Regular User Commands

### Basic / Utility

`!ping` — Basic alive check
`!status` — Bot status
`!help` / `!commands` — Command list

---

### Profile & Membership

* `!profile` / `!profile @user` — View profile
* `!myprofile` — Shortcut to your own profile
* `!credit <anonymous|discord|xtag>` — Set caller credit display
* `!membership` — Membership info
* `!premium` — Premium info
* `!plans` — Plan information

---

### Calls & Tracking

* `!call <ca>` — Make a tracked call
* `!watch <ca>` — Track without caller credit
* `!tracked` — View tracked calls
* `!tracked <ca>` — View specific tracked call
* `!ca <ca>` — Quick scan
* `!scan` — Scan output
* `!scan <ca>` — Deeper scan
* `!testreal <ca>` — Debug provider fetch
* `!autoscantest [profile]` — Simulate auto-alert filter

---

### Caller Stats

* `!caller <name|@user>` — View caller stats
* `!callerboard` — Leaderboard
* `!botstats` — Bot stats

#### Time Windows

* `!bestcall24h | week | month`
* `!topcaller24h | week | month`
* `!bestbot24h | week | month`

---

### Dev Intelligence

* `!dev <wallet|@x|nickname>`
* `!devcard <wallet|@x|nickname>`
* `!devleaderboard`
* `!devsubmit`

---

### Low-Cap System

* `!lowcap <ca>` — View low-cap entry
* `!lowcaps` — Browse watchlist
* `!lowcapadd` — Submit low-cap entry

---

## 2) Trusted / Special Commands

* `!procall <ca> | <title> | <why> | <risk?>`
  (Trusted Pro only)

---

## 3) Moderator Commands

### Scanner & Monitoring

* `!scanner [on|off]`
* `!monitorstatus`
* `!approvalstats`
* `!pendingapprovals`
* `!recentcalls`
* `!resetmonitor` ⚠️ destructive

---

### Trust & Reputation

* `!getcallertrust @user`
* `!setcallertrust @user <level>`
* `!topcallercheck @user`
* `!approvetopcaller @user`
* `!removetopcaller @user`

---

### Membership & Referrals

* `!memberstatus @user`
* `!syncmemberrole @user`
* `!grantmembership @user <tier> <months>`
* `!extendmembership @user <months>`
* `!compmembership @user <tier> <months?>`
* `!cancelmembership @user`
* `!removemembership @user`

Referral commands:

* `!referralstatus @user`
* `!setreferrer @user @referrer`
* `!clearreferrer @user`
* `!markreferralconverted @user <state>`
* `!referralrewardstatus @user`
* `!grantreferralreward @user <months>`
* `!applyreferralreward @user <months?>`
* `!rewardreferrer @user`

---

### Dev & Data Tools

* `!addlaunch <dev_wallet> <token_ca>`
* `!backfillprofiles [run]`
* `!resetbotstats`
* `!truestats @user`
* `!truebotstats`
* `!testx`

---

## 4) Admin / Owner Commands

### X & Posting

* `!xpostpreview <CA> [milestoneX]`

---

### Scanner & Threshold Controls

* `!setminmc`
* `!setminliq`
* `!setminvol5m`
* `!setminvol1h`
* `!setmintxns5m`
* `!setmintxns1h`
* `!setapprovalx`
* `!setapprovalladder`

Sanity filters:

* `!setsanityminmc`
* `!setsanityminliq`
* `!setsanityminliqratio`
* `!setsanitymaxliqratio`
* `!setsanitymaxratio5m`
* `!setsanitymaxratio1h`

---

## 5) Non-Command Interaction Flows

* Profile buttons (credit, verify)
* X verification modals
* Dev submission flows
* Low-cap submission flows
* Call moderation buttons
* Watch / Call buttons
* Membership claim flows
* Top caller review

---

## 6) Background Behaviors

* Auto-scan on pasted CAs
* X mention ingestion
* Background monitoring & milestones

---

## 7) Notes

* Some commands may have duplicate implementations
* Some features rely on channel placement rather than explicit permissions
* This file should be updated as the bot evolves
