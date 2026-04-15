# McGBot Documentation

This folder contains the official human-readable guides for McGBot — for admins, moderators, users, and anyone curious about how the system works.

These docs explain **how McGBot works today**, not a future roadmap.

---

## Who should read what?

| Guide                | Who it’s for                          |
| -------------------- | ------------------------------------- |
| `beginner.md`        | New users / crypto newcomers          |
| `user.md`            | Regular Discord users                 |
| `mod.md`             | Moderators & staff                    |
| `admin.md`           | Server owner / operators              |
| `explanation.md`     | Overview + feature showcase           |
| `MASTER_COMMANDS.md` | Complete command reference (internal) |

If you’re new, start with:

👉 `beginner.md`

---

## Internal Documentation

These files support operations, development, and long-term maintenance:

| File                | Purpose                      |
| ------------------- | ---------------------------- |
| `PROJECT_HANDOFF.md`| **New-chat / ChatGPT bundle:** dashboard state + repo layout (bot vs `mcgbot-dashboard`) + Supabase bot notes |
| `SYSTEM_MAP.md`     | Architecture & system flow   |
| `DATA_CONTRACTS.md` | Data structures & schema     |
| `REFACTOR_PLAN.md`  | Refactor goals & migration   |
| `ENVIRONMENT.md`    | Runtime & setup requirements |
| `DEPLOYMENT.md`     | How to run & deploy McGBot   |

**Tip:** When starting a slow ChatGPT session fresh, upload **`PROJECT_HANDOFF.md`** plus **`SYSTEM_MAP.md`**, **`DATA_CONTRACTS.md`**, and **`ENVIRONMENT.md`** so the model matches this repo’s current behavior (see the “ChatGPT / new-session handoff” section at the top of `PROJECT_HANDOFF.md`).

---

## Updating These Docs

Whenever:

* Commands change
* Environment variables change
* Data structures change
* Workflows change

…these guides should be updated together to keep documentation consistent.

---

## Guiding Principles

McGBot is built around:

* Curation over chaos
* Signal over noise
* Context over raw data
* Trust over randomness

The documentation should reflect that.
