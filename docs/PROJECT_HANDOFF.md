## Crypto Scanner — Project Handoff (Dashboard + Profile System)

This handoff reflects the **current Next.js dashboard** in `mcgbot-dashboard/` within `C:\Dev\Crypto Scanner`.

The dashboard is a **Next.js App Router** app backed by **Supabase** and **NextAuth (Discord)**. The **profile system is complete** (edit profile, badges, trophies, follows, pinned call, visibility toggles, profile stats).

---

## ChatGPT / new-session handoff (what to upload)

When you start a **fresh** assistant chat and want parity with this repo:

1. **Always useful:** `docs/PROJECT_HANDOFF.md` (this file), `docs/SYSTEM_MAP.md`, `docs/DATA_CONTRACTS.md`, `docs/ENVIRONMENT.md`, `docs/DEPLOYMENT.md`.
2. **If touching the dashboard:** also upload `mcgbot-dashboard/README.md` (if present) and any route you are editing under `mcgbot-dashboard/app/`.
3. **If touching the Discord bot:** also skim `docs/SYSTEM_MAP.md` §Runtime entry and §Root bot + Supabase (lazy client).

**Repo layout (two runtimes, same monorepo):**

| Area | Entry / path | Notes |
|------|----------------|-------|
| **Discord bot** | `index.js` (repo root) | `node index.js`; uses `dotenv`, `data/*.json`, optional Supabase for referrals only. |
| **Web dashboard** | `mcgbot-dashboard/` | Separate `package.json`; Vercel/Next; own `.env.local` / Vercel env. **Do not mix** dashboard env with bot `.env` unless intentional. |

### Discord bot — Supabase (root project only)

- **Client module:** `utils/supabaseClient.js` exports **`getSupabase()`** only. It **does not** call `createClient` at import time (avoids crashes when env loads late or is missing).
- **First use:** `getSupabase()` throws **`Error: Supabase env not loaded`** if `SUPABASE_URL` or `SUPABASE_ANON_KEY` is missing **at the moment of the call** (not at import).
- **Where it runs today:** `utils/referralService.js` calls `getSupabase()` **inside** the `guildMemberAdd` referral attribution path when inserting into Supabase — **not** on generic startup. `utils/adminReportsService.js` does **not** use Supabase.
- **Removed:** Startup “test referral insert” from `client.once('clientReady')` in `index.js` — Supabase is **not** initialized for testing on bot boot.
- **Scripts:** `scripts/*.js` that seed/fix data call `getSupabase()` inside their async IIFE when run manually (`node scripts/...`).

---

## Project overview

- **Frontend**: `mcgbot-dashboard/` (Next.js 16 App Router, Tailwind)
- **Auth**: NextAuth (Discord provider). The canonical user id is the Discord snowflake stored as `session.user.id`.
- **Database**: Supabase Postgres (tables for users, follows, trophies, badges, call performance).
- **Primary UX**:
  - Home dashboard (`/`): activity, top performers, your recent calls, etc.
  - Leaderboard (`/leaderboard`)
  - Settings (`/settings`)
  - Public profile (`/user/[id]`) with follow, trophies, stats, pinned call, and module visibility.

---

## Current working systems (confirmed in code)

### Profile system (complete)

- **Public profile page**: `mcgbot-dashboard/app/user/[id]/page.tsx`
  - Banner + avatar + display name + badges
  - Bio, X handle display, followers/following counts
  - Trophy case (daily/weekly/monthly)
  - Recent calls + key stats + call distribution
  - Pinned call card
  - Module visibility gating via `profile_visibility`

### Edit profile

- **Modal**: on your own profile (`/user/[yourId]`)
- **Load**: `GET /api/profile` (current user only)
- **Save**: `POST /api/profile`
- **Post-save**: modal closes and page hard reloads

### Follow system

- **API**: `mcgbot-dashboard/app/api/follow/route.ts`
- **Storage**: `public.user_follows`
- **UI**: `mcgbot-dashboard/app/components/FollowButton.tsx` and profile header integration

### Badges

- **Storage**: `public.user_badges` (one row per badge string)
- **Profile**: `GET /api/user/[id]/badges`
- **Batch fetch**: `POST /api/badges` for leaderboards/home lists
- **UI**: `mcgbot-dashboard/app/components/UserBadgeIcons.tsx`

### Trophies

- **Storage**: `public.user_trophies` (rank + timeframe + `period_start_ms`)
- **API**: `GET /api/user/[id]/trophies?timeframe=daily|weekly|monthly`
- **Awarding (server-side helper)**: `mcgbot-dashboard/lib/awardTrophies.ts` (prevents duplicates with unique index)

---

## Database schema (relevant tables)

### `public.users` (profile + settings)

Core columns used by dashboard/profile:

- `id` UUID PK
- `discord_id` TEXT UNIQUE NOT NULL (Discord snowflake; primary user identifier)
- `tier` TEXT NOT NULL DEFAULT `'free'`
- `created_at` TIMESTAMPTZ NOT NULL DEFAULT `now()`

Profile columns:

- `bio` TEXT NULL
- `banner_url` TEXT NULL
- `x_handle` TEXT NULL
- `x_verified` BOOLEAN NOT NULL DEFAULT `false`

Profile UX features:

- `pinned_call_id` UUID NULL
- `profile_visibility` JSONB NOT NULL DEFAULT (keys below)
  - `show_stats` boolean
  - `show_trophies` boolean
  - `show_calls` boolean
  - `show_key_stats` boolean
  - `show_pinned_call` boolean
  - `show_distribution` boolean

### `public.user_trophies`

- `id` UUID PK
- `user_id` TEXT NOT NULL (Discord snowflake)
- `rank` INTEGER NOT NULL CHECK \(rank IN \(1,2,3\)\)
- `timeframe` TEXT NOT NULL (`daily` | `weekly` | `monthly`)
- `period_start_ms` BIGINT NOT NULL (UTC period bucket start)
- `created_at` TIMESTAMPTZ NOT NULL DEFAULT `now()`
- Unique: `(user_id, timeframe, period_start_ms)`

### `public.user_badges`

- `id` UUID PK
- `user_id` TEXT NOT NULL (Discord snowflake)
- `badge` TEXT NOT NULL (e.g. `top_caller`, `trusted_pro`)
- `created_at` TIMESTAMPTZ NOT NULL DEFAULT `now()`
- Unique: `(user_id, badge)`

### `public.user_follows`

- `id` UUID PK
- `follower_id` TEXT NOT NULL
- `following_id` TEXT NOT NULL
- `created_at` TIMESTAMP DEFAULT `now()`
- Unique: `(follower_id, following_id)`
- Indexes on `follower_id`, `following_id`

---

## Environment variables (mcgbot-dashboard)

### NextAuth / Discord

- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL` (required for correct cookie/session behavior on Vercel)

### Supabase

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

**Important**: `SUPABASE_SERVICE_ROLE_KEY` must only be used server-side (API routes / server code). Never expose it to client components.

---

## Known pitfalls (practical)

### Users table columns drifting from code

- If Supabase doesn’t have all expected `users` columns (bio/banner/x/pinned/profile_visibility), Supabase will return errors like “column does not exist”.
- Fix by applying migrations under `supabase/migrations/`.

### Service role usage (read/write consistency)

The profile UI **reads** the public profile via `GET /api/user/[id]` and **writes** via `POST /api/profile`.

- If writes use service role but reads use anon (or vice versa), you can get “saved but not visible” behavior when RLS/policies differ.
- Current code uses service role for profile save and profile read of `users`.

### Multiple projects / wrong environment

If `SUPABASE_URL` differs between local/Vercel, you may be saving to one project and checking another.

---

## Next steps (recommended)

### Date Joined

- Add a “Date Joined” widget using `users.created_at` (already selected in `GET /api/user/[id]`).
- Add formatted display helpers and consistent UI placement (profile summary card is the best home).

### Profile upgrades

- Expand profile fields (links, pinned bio highlights, theme) while keeping `profile_visibility` stable.
- Consider a server-side validation layer for banner URLs / X handle.

### Follow feed

- Add a “Following feed” view (calls from followed users) using `user_follows` + `call_performance`.


