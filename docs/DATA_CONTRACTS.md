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

## `public.user_badges`

| Column | Type | Notes |
|--------|------|------|
| `user_id` | TEXT | Discord snowflake. |
| `badge` | TEXT | Known values used by UI: `top_caller`, `trusted_pro`. |
| `created_at` | TIMESTAMPTZ | Insert time. |

Unique constraint: `(user_id, badge)`

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
