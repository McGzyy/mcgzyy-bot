## Data contracts — Dashboard (Supabase)

This document defines the **database contract** used by the Next.js dashboard in `mcgbot-dashboard/`. A short **Discord bot** Supabase appendix was added at the end for referral mirroring from the repo root.

**Maintenance rule:** When you change a table schema or an API response shape, update this file in the same change.

---

## `public.users` (authoritative profile schema)

### Primary identifier

- **`discord_id`**: `TEXT UNIQUE NOT NULL`  
  Canonical user id across the app. This is the value used in:
  - Profile routes: `/api/profile` (current user) and `/api/user/[id]` (public profile)
  - Follows: `user_follows.follower_id` / `following_id`
  - Badges: `user_badges.user_id`
  - Trophies: `user_trophies.user_id`

### Required / core fields

| Column | Type | Nullable | Notes |
|--------|------|----------|------|
| `id` | UUID | NO | Primary key (server-generated). |
| `discord_id` | TEXT | NO | Unique Discord snowflake. |
| `created_at` | TIMESTAMPTZ | NO | “Date Joined” source. |

### Profile fields

| Column | Type | Nullable | Notes |
|--------|------|----------|------|
| `bio` | TEXT | YES | User editable. |
| `banner_url` | TEXT | YES | User editable. |
| `banner_crop_x` | SMALLINT | YES | Banner focal X percent (0..100). |
| `banner_crop_y` | SMALLINT | YES | Banner focal Y percent (0..100). |
| `x_handle` | TEXT | YES | Stored without leading `@`. |
| `x_verified` | BOOLEAN | NO | Defaults false. |

### Profile UX fields

| Column | Type | Nullable | Notes |
|--------|------|----------|------|
| `profile_visibility` | JSONB | NO | Module toggles. |
| `pinned_call_id` | UUID | YES | References a `call_performance.id` that belongs to the user (validated server-side in pinned-call API). |

### `profile_visibility` JSONB contract

The UI treats missing keys as `true` (show module). Expected keys:

```json
{
  "show_stats": true,
  "show_trophies": true,
  "show_calls": true,
  "show_key_stats": true,
  "show_pinned_call": true,
  "show_distribution": true
}
```

---

## `public.user_trophies`

| Column | Type | Notes |
|--------|------|------|
| `user_id` | TEXT | Discord snowflake. |
| `rank` | INTEGER | Must be 1, 2, or 3. |
| `timeframe` | TEXT | `daily` / `weekly` / `monthly`. |
| `period_start_ms` | BIGINT | UTC bucket start (prevents duplicates). |
| `created_at` | TIMESTAMPTZ | Insert time. |

Unique constraint/index: `(user_id, timeframe, period_start_ms)`

---

## `public.user_milestone_trophies`

Permanent profile trophies (e.g. “10× club”), **one row per user per `milestone_key`**.

| Column | Type | Notes |
|--------|------|------|
| `user_id` | TEXT | Discord snowflake. |
| `milestone_key` | TEXT | Stable id, e.g. `call_club_10x`, `call_club_25x`, `call_club_50x`. |
| `call_performance_id` | UUID | Optional FK to the call that first unlocked the row. |
| `created_at` | TIMESTAMPTZ | Insert time. |

Unique constraint: `(user_id, milestone_key)`  
**Award path:** repo root `utils/callPerformanceSync.js` upserts after eligible `call_performance` user-call inserts/ATH updates (`source = user`, not stats-excluded).

---

## `public.user_badges`

| Column | Type | Notes |
|--------|------|------|
| `user_id` | TEXT | Discord snowflake. |
| `badge` | TEXT | Known values used by UI: `top_caller`, `trusted_pro`. |
| `created_at` | TIMESTAMPTZ | Insert time. |

Unique constraint: `(user_id, badge)`

---

## `public.user_inbox_notifications`

Persistent notifications shown in the dashboard **TopBar bell** (distinct from ephemeral toast notifications).

| Column | Type | Notes |
|--------|------|------|
| `id` | UUID | Primary key. |
| `user_id` | TEXT | Discord snowflake (matches `users.discord_id`). |
| `title` | TEXT | Short subject line. |
| `body` | TEXT | Message body. |
| `kind` | TEXT | Free-form discriminator (e.g. `bug_closed`). |
| `created_at` | TIMESTAMPTZ | Insert time. |
| `read_at` | TIMESTAMPTZ | Null = unread. |

Indexes:
- `(user_id, created_at desc)`
- Partial unread index on `(user_id)` where `read_at is null`

---

## `public.user_profile_reports`

Reports against a user profile (rugs, harassment, impersonation, etc). Reviewed by staff.

| Column | Type | Notes |
|--------|------|------|
| `reporter_user_id` | TEXT | Discord snowflake for reporter. |
| `target_user_id` | TEXT | Discord snowflake for the reported profile. |
| `reason` | TEXT | Short reason code/label. |
| `details` | TEXT | Optional free text. |
| `evidence_urls` | JSONB | Optional array of URLs (one per line in UI). |
| `status` | TEXT | `open` / `reviewing` / `resolved` / `rejected`. |
| `staff_notes` | TEXT | Internal notes. |
| `reviewed_by_discord_id` | TEXT | Staff Discord id (nullable). |
| `reviewed_at` | TIMESTAMPTZ | Nullable. |

---

## `public.call_reports`

Reports against a `call_performance` row (scam/rug/bundle). Reviewed by staff; may result in excluding the call from stats.

| Column | Type | Notes |
|--------|------|------|
| `reporter_user_id` | TEXT | Reporter Discord id. |
| `call_performance_id` | UUID | FK to `public.call_performance(id)` (cascade delete). |
| `reason` | TEXT | Short reason code/label. |
| `details` | TEXT | Optional free text. |
| `evidence_urls` | JSONB | Optional array of URLs. |
| `status` | TEXT | `open` / `reviewing` / `resolved` / `rejected`. |
| `staff_notes` | TEXT | Internal notes. |
| `reviewed_by_discord_id` | TEXT | Staff Discord id (nullable). |
| `reviewed_at` | TIMESTAMPTZ | Nullable. |

---

## `public.bug_reports`

User submitted bug reports. Closing a bug should send a `user_inbox_notifications` row to the reporter.

| Column | Type | Notes |
|--------|------|------|
| `reporter_user_id` | TEXT | Reporter Discord id. |
| `title` | TEXT | Short title. |
| `description` | TEXT | Full description. |
| `reproduction_steps` | TEXT | Optional. |
| `page_url` | TEXT | Optional page where bug happened. |
| `screenshot_urls` | JSONB | Optional array of URLs. |
| `status` | TEXT | `open` / `triaged` / `closed`. |
| `staff_notes` | TEXT | Internal notes. |
| `closed_at` | TIMESTAMPTZ | Nullable. |
| `closed_by_discord_id` | TEXT | Nullable. |

---

## Discord bot (repo root) — Supabase touchpoints

This section complements the dashboard schema above. The bot uses the **same Supabase project** only when `SUPABASE_URL` and `SUPABASE_ANON_KEY` are set in the **root** `.env`.

### Client access pattern

- **File:** `utils/supabaseClient.js`
- **API:** `getSupabase()` — lazy singleton; throws if URL/key missing **when invoked** (not at `require()` time).

### `public.referrals` (used by `utils/referralService.js`)

Inserted when a new member is attributed to a referrer’s invite (after local `data/referrals.json` update). Typical row shape from code:

| Column | Type (conceptual) | Notes |
|--------|-------------------|-------|
| `owner_discord_id` | text | Referrer Discord snowflake |
| `referred_user_id` | text | New member snowflake |
| `joined_at` | bigint / number | `Date.now()` style ms |

**Schema truth:** Confirm column names and types in Supabase migrations / Table Editor; bot code assumes the insert shape above matches your live table.
