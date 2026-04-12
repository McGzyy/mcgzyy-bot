# McGBot User Guide

McGBot helps you track calls, preserve context, and use the server more intelligently across **Discord and X**.

This guide is for regular users — not staff or admins.
If you want to know what you can actually do with the bot, start here.

---

## Quick Start

Most people use McGBot for:

* Making and tracking coin calls
* Looking up coins and devs
* Checking caller performance and leaderboards
* Submitting low-cap ideas or dev intel
* Connecting Discord and X identity
* Using the bot as a signal and context layer

If you only learn a few commands, start with:

* `!call <ca>`
* `!watch <ca>`
* `!ca <ca>`
* `!lowcap <ca>`
* `!lowcaps`
* `!lowcapadd`
* `!dev <wallet | @x | nickname>`
* `!devcard <wallet | @x | nickname>`
* `!profile`
* `!credit <mode>`

---

## 1) Making and Tracking Calls

McGBot turns calls into something that can actually be tracked over time.

Instead of a call disappearing into chat, the bot preserves:

* The contract address
* Who posted it
* When it was called
* How it performed
* Milestone progress over time

That gives the server real memory instead of relying on screenshots and hindsight.

---

### `!call <ca>`

Creates an official tracked call.

**Example:**
`!call 9abc123...`

**What it does**

* Creates a tracked call
* Ties the call to you
* Tracks performance over time

If you want your call to actually count, this is the right command.

---

### `!watch <ca>`

Tracks a coin without claiming it as your call.

**Example:**
`!watch 9abc123...`

**What it does**

* Starts tracking the coin
* Does **not** treat it as your personal call

Use this when you’re interested, but don’t want to claim credit.

---

### `!tracked`

Shows a summary of tracked calls.

### `!tracked <ca>`

Shows detailed tracking info for a specific coin.

---

## 2) Quick Coin Lookup / Scanning

Sometimes you want context without committing to tracking.

---

### `!ca <ca>`

Quick intel scan.

**Example:**
`!ca 9abc123...`

Use this when:

* You want a quick read
* You’re not ready to track yet
* You just want context

---

### `!scan`

Generic scan output.

### `!scan <ca>`

Deeper scan-style lookup.

---

## 3) Caller Stats & Performance

McGBot makes it easy to see who’s actually been performing.

---

### `!caller <name>` or `!caller @user`

Shows stats for a specific caller.

### `!callerboard`

Top caller leaderboard.

### `!botstats`

Overall bot stats.

---

### Time-Based Performance

**Best Calls**

* `!bestcall24h`
* `!bestcallweek`
* `!bestcallmonth`

**Top Callers**

* `!topcaller24h`
* `!topcallerweek`
* `!topcallermonth`

**Best Bot Calls**

* `!bestbot24h`
* `!bestbotweek`
* `!bestbotmonth`

---

## 4) Low-Cap Watchlist

McGBot includes a curated low-cap system for tracking:

* Sleeper coins
* Revival plays
* Interesting setups with a thesis

This is **not** a spam feed.

---

### `!lowcap <ca>`

Look up a low-cap entry.

### `!lowcaps`

Browse the watchlist.

### `!lowcapadd`

Submit a coin for review.

Submissions are reviewed before going live — that’s what keeps the list useful.

---

## 5) Dev Intelligence

Dev Intelligence helps track useful dev context like:

* Wallets
* X handles
* Known launches
* Notes & tags

---

### `!dev <wallet | @x | nickname>`

Quick lookup.

### `!devcard <wallet | @x | nickname>`

Cleaner profile-style view.

### `!devleaderboard`

Dev leaderboard.

### `!devsubmit`

Submit dev intel for review.

---

## 6) Profiles, Credit, and Identity

---

### `!profile` / `!profile @user`

View a profile.

### `!myprofile`

Shortcut for your own profile.

---

### `!credit <mode>`

Controls how your call credit is displayed.

Options:

* `anonymous` → hides identity
* `discord` → shows Discord identity
* `xtag` → shows X identity (requires verification)

---

## 7) X Verification

X verification connects your Discord and X identity.

Benefits:

* Better attribution
* Proper milestone credit
* Cross-platform recognition

If you use both platforms, it’s worth doing.

---

## 8) Cross-Platform Features

McGBot isn’t limited to Discord.

Depending on server setup, it can:

* Track X-originated calls
* Ingest mentions
* Link X activity to Discord identity

This helps keep signal unified across platforms.

---

## 9) Membership & Premium

For most users, these commands are informational.

* `!membership`
* `!premium`
* `!plans`

---

## 10) Trusted Pro Calls

Some higher-trust users have access to:

`!procall <ca> | <title> | <why> | <risk?>`

This is a structured, higher-conviction call format.

This is gated and not available to everyone.

---

## 11) Automatic Features

Some systems work automatically:

* Auto-scanning pasted contract addresses
* Background monitoring
* Milestone tracking
* Review and approval systems

You don’t need to trigger everything manually.

---

## Best Way to Use McGBot

Use it as a **signal and context tool**, not a magic solution.

Best practices:

* Check context before acting
* Use calls and watchlists as inputs, not guarantees
* Research devs before trusting
* Submit meaningful ideas, not spam
* Pay attention to who performs consistently

---

## What McGBot Is Not

McGBot is not:

* A replacement for judgment
* A guaranteed alpha feed
* A bot that makes bad setups good

It’s a structure and context layer.

Used properly, it makes the room sharper.
