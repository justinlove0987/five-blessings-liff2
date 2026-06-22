# Supabase Table Schema

This document records the current database structure used by the Five Blessings LIFF check-in app.

The app now uses a single table as the source of truth:

- `checkins`: one completed check-in record per user, task, and period.

The previous summary tables, `user_task_status` and `user_daily_status`, are no longer used.

## Table: `checkins`

Stores one completion record per LINE user, blessing task, and period. The row itself means the task is completed for that period.

| Column | Type | Nullable | Description |
| --- | --- | --- | --- |
| `id` | `uuid` | No | Primary key. Generated with `gen_random_uuid()`. |
| `line_user_id` | `text` | No | LINE user id from the verified LINE ID token. |
| `display_name` | `text` | No | LINE display name at the time of check-in. |
| `blessing_type` | `text` | No | Task key, such as `morningPrayer`, `smallGroup`, `sunday`, or `tithe`. |
| `period_type` | `text` | No | Check-in period type: `day`, `week`, or `month`. |
| `period_key` | `text` | No | Period identifier used for lookup and duplicate prevention. |
| `checked_in_at` | `timestamptz` | No | Timestamp when the task was checked in. |
| `created_at` | `timestamptz` | No | Timestamp when the row was created. |

## Constraints

- Primary key: `id`
- Unique completion record:
  - `unique (line_user_id, blessing_type, period_key)`
- Allowed `blessing_type` values:
  - `morningPrayer`
  - `smallGroup`
  - `sunday`
  - `tithe`
- Allowed `period_type` values:
  - `day`
  - `week`
  - `month`

## Indexes

- `checkins_line_user_id_idx` on `line_user_id`
- `checkins_period_key_idx` on `period_key`

## Task Period Rules

The app calculates all periods in the `Asia/Taipei` time zone.

| Task | `blessing_type` | `period_type` | `period_key` format | Example |
| --- | --- | --- | --- | --- |
| 晨禱 | `morningPrayer` | `day` | `YYYY-MM-DD` | `2026-06-22` |
| 小家 | `smallGroup` | `week` | Monday date, `YYYY-MM-DD` | `2026-06-22` |
| 主日 | `sunday` | `week` | Monday date, `YYYY-MM-DD` | `2026-06-22` |
| 十一奉獻 | `tithe` | `month` | `YYYY-MM` | `2026-06` |

## App Data Flow

1. The LIFF page gets a LINE `idToken`.
2. `/api/status` verifies the token and reads `checkins`.
3. If a matching `checkins` row exists, the task is shown as `已完成`.
4. When the user checks in, `/api/checkin` verifies the token.
5. `/api/checkin` inserts one row into `checkins`.
6. Duplicate check-ins for the same `line_user_id`, `blessing_type`, and `period_key` return success without creating another row.

## Production Migration Notes

Run `supabase/schema.sql` in Supabase SQL Editor.

The migration:

- Drops `user_task_status`.
- Drops `user_daily_status`.
- Keeps `checkins` as the only active app table.
- Ensures required `checkins` columns, constraints, and indexes exist.
- Removes duplicate `checkins` rows for the same `line_user_id`, `blessing_type`, and `period_key`, keeping the earliest `checked_in_at`.

## Row Level Security

RLS is enabled on `public.checkins`.

The current app writes and reads through Vercel serverless API routes using `SUPABASE_SERVICE_ROLE_KEY`, so browser clients do not access this table directly.
