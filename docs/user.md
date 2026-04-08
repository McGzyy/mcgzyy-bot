# McGBot User Guide

McGBot is built to help you track calls, preserve context, and use the server more intelligently across **Discord and X**.

This guide is for regular users — not staff or admins.

If you want to know what you can actually do with the bot, start here.

---

# Quick Start

Most users will mainly use McGBot for these things:

- Make and track coin calls
- Look up coins and devs
- Check caller performance and leaderboards
- Submit low-cap coins or dev intel
- Connect Discord and X identity
- Use the bot as a signal and context layer

If you only learn a few commands, start with:

- `!call <ca>`
- `!watch <ca>`
- `!ca <ca>`
- `!lowcap <ca>`
- `!lowcaps`
- `!lowcapadd`
- `!dev <wallet | @x | nickname>`
- `!devcard <wallet | @x | nickname>`
- `!profile`
- `!credit <mode>`

---

# 1) Making and Tracking Calls

One of McGBot’s main jobs is turning calls into something that can actually be tracked.

Instead of a call disappearing into chat, the bot can preserve:

- the contract address
- who posted it
- when it was called
- how it performed after
- milestone progress over time

That gives the server a real memory instead of relying on screenshots and hindsight.

## `!call <ca>`

Use this when you want to make an official tracked call.

**Example**  
`!call 9abc123...`

**What it does**
- Creates a tracked call
- Ties the call to you
- Lets the bot follow it over time

If you want your call to actually count, this is the cleanest way to do it.

## `!watch <ca>`

Use this when you want to track a coin **without claiming it as your call**.

**Example**  
`!watch 9abc123...`

**What it does**
- Starts tracking the coin
- Does **not** treat it as your personal call

This is useful if you’re watching a setup but don’t want to take credit for it.

## `!tracked`

Shows a general view of tracked calls.

**Example**  
`!tracked`

## `!tracked <ca>`

Looks up a specific tracked coin.

**Example**  
`!tracked 9abc123...`

Use this if you want to check whether a coin is already being tracked and what its status looks like.

---

# 2) Quick Coin Lookup / Scanning

Sometimes you want context without fully tracking the coin.

McGBot supports that too.

## `!ca <ca>`

Runs a quick intel scan on a coin.

**Example**  
`!ca 9abc123...`

**Use this when**
- you want a quick read
- you don’t want to start tracking yet
- you just want context first

## `!scan`

Shows a generic scan-style output.

**Example**  
`!scan`

## `!scan <ca>`

Runs a deeper scan-style lookup on a specific coin.

**Example**  
`!scan 9abc123...`

---

# 3) Caller Stats and Performance

McGBot is also useful for checking who’s actually been cooking.

That includes:
- caller stats
- top callers
- best calls
- overall bot stats

## `!caller <name>` or `!caller @user`

Shows stats for a specific caller.

**Examples**
- `!caller Austin`
- `!caller @Austin`

Use this if you want to check how someone’s tracked calls have performed.

## `!callerboard`

Shows the top caller leaderboard.

**Example**  
`!callerboard`

## `!botstats`

Shows general McGBot stats.

**Example**  
`!botstats`

## Time-Based Performance Commands

These commands show best calls and top callers by timeframe.

### Best Calls
- `!bestcall24h`
- `!bestcallweek`
- `!bestcallmonth`

### Top Callers
- `!topcaller24h`
- `!topcallerweek`
- `!topcallermonth`

### Best Bot Calls
- `!bestbot24h`
- `!bestbotweek`
- `!bestbotmonth`

Use these when you want quick “who / what has been hitting lately?” context.

---

# 4) Low-Cap Watchlist

McGBot includes a curated low-cap system for tracking:

- sleeper coins
- revival plays
- forgotten runners
- low-cap setups with an actual thesis

This is **not** meant to be a random junk feed.

The point is to surface interesting low-cap ideas that are actually worth watching.

## `!lowcap <ca>`

Looks up a tracked low-cap entry.

**Example**  
`!lowcap 9abc123...`

Use this when you want to see:
- whether a coin is on the watchlist
- why it was added
- what the stored thesis is

## `!lowcaps`

Shows the current low-cap watchlist.

**Example**  
`!lowcaps`

This is useful for browsing what’s already being watched.

## `!lowcapadd`

Starts the low-cap submission flow.

**Example**  
`!lowcapadd`

This opens a submission form where you can submit:
- coin name
- contract address
- narrative
- why it’s interesting
- optional extra context

### Important
Low-cap submissions do **not** go live instantly.

They are reviewed before being added.

That’s intentional — it keeps the list curated instead of useless.

---

# 5) Dev Intelligence

McGBot also lets you look up known dev context.

This is useful when you want to know whether a wallet, X handle, or nickname is already tied to known history.

## `!dev <wallet | @x | nickname>`

Looks up a tracked dev.

**Examples**
- `!dev @exampledev`
- `!dev 9abc123wallet...`
- `!dev nickname`

Use this when you want a quick lookup.

## `!devcard <wallet | @x | nickname>`

Shows a cleaner profile-style dev card.

**Example**  
`!devcard @exampledev`

This is usually the nicer way to view dev context.

## `!devleaderboard`

Shows dev leaderboard information.

**Example**  
`!devleaderboard`

## `!devsubmit`

Starts the dev intel submission flow.

**Example**  
`!devsubmit`

Use this when you want to submit useful dev context for staff review.

Like the low-cap system, this is reviewed intentionally.

---

# 6) Profiles, Credit, and Identity

McGBot also lets you control how you show up in the system.

That matters because attribution is a real part of the bot.

## `!profile`

Shows a user profile card.

**Examples**
- `!profile`
- `!profile @user`

## `!myprofile`

Shortcut for viewing your own profile.

**Example**  
`!myprofile`

## `!credit <mode>`

Controls how your call credit is displayed.

**Examples**
- `!credit anonymous`
- `!credit discord`
- `!credit xtag`

### Credit Modes
- `anonymous` → hides your public caller identity
- `discord` → shows Discord-style credit
- `xtag` → uses your X tag (**requires X verification**)

This is useful if you care about how your calls are attributed publicly.

---

# 7) X Verification

McGBot supports X verification so your Discord identity and X identity can connect properly.

This matters because it can improve:

- attribution
- milestone credit
- cross-platform continuity
- trust context

## Why it matters

If you make calls on X and in Discord, verification helps the bot connect that activity more cleanly.

That can improve how your calls are credited and recognized over time.

In some flows, it can also help milestone posts properly reflect your identity.

---

# 8) X + Discord Cross-Platform Features

One of the cooler parts of McGBot is that it is not locked to Discord only.

Depending on how the server has it configured, McGBot can also interact with X-side call activity.

That can include things like:

- X-originated calls
- tagged bot flows
- mention ingestion
- X-linked attribution

This helps the bot preserve signal across platforms instead of letting it stay fragmented.

---

# 9) Membership / Premium

McGBot also supports membership / Premium infrastructure.

For most users, these commands are mainly informational.

## `!membership`

Shows membership-related info.

**Example**  
`!membership`

## `!premium`

Shows Premium-related info.

**Example**  
`!premium`

## `!plans`

Shows membership / plan info.

**Example**  
`!plans`

---

# 10) Trusted Pro Calls

Some higher-trust users may have access to:

## `!procall <ca> | <title> | <why> | <risk?>`

This is a structured higher-conviction call format.

**Example**  
`!procall 9abc123... | Strong CTO setup | Clean narrative + known community | Could still fail if no volume returns`

This is **not** a normal user command.  
It is intentionally gated.

But if you see these calls, that’s what they are.

---

# 11) Things That Happen Automatically

Some parts of McGBot work without you manually typing commands.

That includes things like:

- auto-scanning pasted contract addresses
- X-side ingestion flows
- milestone tracking
- review / approval systems
- background monitoring

So even if you’re not manually using commands constantly, the bot may still be doing useful work in the background.

---

# Best Way to Use McGBot

You’ll get the most value from the bot if you use it like a **signal and context tool**, not a magic answer machine.

Best uses:
- track calls cleanly
- check context before aping
- look up devs before trusting them
- use the low-cap watchlist for ideas, not gospel
- submit things with an actual thesis
- pay attention to who is consistently right

That’s where the edge is.

---

# What McGBot Is Not

McGBot is not trying to be:

- a replacement for your judgment
- a blind auto-alpha feed
- a spam scanner
- a bot that magically makes bad setups good

It’s a structure layer.

Used properly, it makes the room sharper.