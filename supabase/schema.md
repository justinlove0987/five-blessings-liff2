# Supabase 資料表結構

這份文件記錄「五重祝福」LINE LIFF 打卡 App 目前使用的 Supabase 資料庫結構與任務規則。

MVP 使用三張資料表：

- `users`：登入過 / 加入過的使用者，以及目前所在小隊。
- `teams`：小隊資料與邀請碼。
- `checkins`：每一次五重祝福打卡紀錄。

舊的彙整表已不再使用：

- `user_task_status`
- `user_daily_status`

## MVP 業務規則

- 不建立 `team_members` table。
- 一個 user 在 MVP 階段只能屬於一個 team，以 `users.team_id` 表示。
- 加入小隊時，直接更新 `users.team_id`。
- 打卡時，從 `users.team_id` 帶入 `checkins.team_id`（API 尚未實作）。
- 查小隊成員時，用 `users.team_id = teams.id`。
- 查小隊打卡進度時，用 `checkins.team_id = teams.id`。
- `checkins.team_id` 是「當次打卡時所屬小隊」的快照，不要用 join `users.team_id` 動態推算。

---

## 資料表：`users`

記錄登入過 / 加入過的人，以及目前所在小隊。

| 欄位 | 型別 | 可為空 | 說明 |
| --- | --- | --- | --- |
| `id` | `uuid` | 否 | 主鍵，預設 `gen_random_uuid()`。 |
| `line_user_id` | `text` | 否 | LINE 使用者唯一識別，unique。 |
| `display_name` | `text` | 否 | LINE 顯示名稱。 |
| `nickname` | `text` | 是 | 使用者自訂暱稱；小隊成員列表優先顯示此欄位。 |
| `picture_url` | `text` | 是 | LINE 頭像 URL。 |
| `team_id` | `uuid` | 是 | 目前所在小隊，FK → `teams(id)`。 |
| `created_at` | `timestamptz` | 否 | 建立時間，預設 `now()`。 |
| `updated_at` | `timestamptz` | 否 | 更新時間，預設 `now()`，由 trigger 自動更新。 |

### Constraints

- 主鍵：`id`
- `unique (line_user_id)`
- `team_id` → `teams(id)`

### Indexes

- `users_team_id_idx`：建立在 `team_id`

---

## 資料表：`teams`

記錄小隊資料與邀請碼。

| 欄位 | 型別 | 可為空 | 說明 |
| --- | --- | --- | --- |
| `id` | `uuid` | 否 | 主鍵，預設 `gen_random_uuid()`。 |
| `name` | `text` | 否 | 小隊名稱。 |
| `invite_code` | `text` | 否 | 邀請碼，unique。 |
| `created_by_user_id` | `uuid` | 是 | 建立小隊的人，FK → `users(id)`。 |
| `created_at` | `timestamptz` | 否 | 建立時間，預設 `now()`。 |
| `updated_at` | `timestamptz` | 否 | 更新時間，預設 `now()`，由 trigger 自動更新。 |

### Constraints

- 主鍵：`id`
- `unique (invite_code)`
- `created_by_user_id` → `users(id)`

### 備註

- 建立小隊後，應把建立者的 `users.team_id` 更新成該 team 的 `id`（API 尚未實作）。
- `users` 與 `teams` 有循環 FK，migration 分階段建立。

---

## 資料表：`checkins`

記錄每一次五重祝福打卡。只要存在對應 row，就代表該任務在該週期已完成。

| 欄位 | 型別 | 可為空 | 說明 |
| --- | --- | --- | --- |
| `id` | `uuid` | 否 | 主鍵，預設 `gen_random_uuid()`。 |
| `user_id` | `uuid` | 是 | 正式關聯 `users`，FK → `users(id)`。API 更新前可為空。 |
| `team_id` | `uuid` | 是 | 打卡當下所屬小隊快照，FK → `teams(id)`。 |
| `line_user_id` | `text` | 否 | 從 LINE ID token 取得的 LINE user id，方便 debug。 |
| `display_name` | `text` | 否 | 打卡當下的 LINE 顯示名稱。 |
| `blessing_type` | `text` | 否 | 任務代碼。 |
| `period_type` | `text` | 否 | 任務週期類型：`day`、`week`、`month`。 |
| `period_key` | `text` | 否 | 任務週期識別值。 |
| `checked_in_at` | `timestamptz` | 否 | 完成打卡時間。 |
| `created_at` | `timestamptz` | 否 | row 建立時間。 |

### Constraints

- 主鍵：`id`
- 同一任務週期只能完成一次（過渡期保留，供現有 API 使用）：
  - `unique (line_user_id, blessing_type, period_key)`
- 同一 user 在同一週期只能完成一次（`user_id` 有值時生效）：
  - `unique (user_id, blessing_type, period_type, period_key)`
- `blessing_type` 允許值：
  - `morningPrayer`
  - `smallGroup`
  - `sunday`
  - `tithe`
  - `prayerMeeting`
- `period_type` 允許值：
  - `day`
  - `week`
  - `month`
- `user_id` → `users(id)`
- `team_id` → `teams(id)`

### Indexes

- `checkins_line_user_id_idx`：建立在 `line_user_id`
- `checkins_period_key_idx`：建立在 `period_key`
- `checkins_user_id_idx`：建立在 `user_id`
- `checkins_team_id_idx`：建立在 `team_id`
- `checkins_team_period_idx`：建立在 `(team_id, period_key)`

---

## 任務週期規則

所有任務週期都以 `Asia/Taipei` 時區計算。

| 任務 | `blessing_type` | `period_type` | `period_key` 格式 | 範例 |
| --- | --- | --- | --- | --- |
| 晨禱 | `morningPrayer` | `day` | `YYYY-MM-DD` | `2026-06-22` |
| 小家 | `smallGroup` | `month` | 月內第 1/2 次，`YYYY-MM#N` | `2026-07#1` |
| 主日 | `sunday` | `month` | 月內第 1/2/3/4 次，`YYYY-MM#N` | `2026-07#1` |
| 十一奉獻 | `tithe` | `month` | `YYYY-MM` | `2026-06` |
| 禱告會 | `prayerMeeting` | `week` | 該週週日，`YYYY-MM-DD` | `2026-06-21` |

### `period_key` 規則

- `day`：當天日期，例如 `2026-06-22`。
- `week`：固定使用**該週週日**日期，不要混用週一。
- 小家月內兩次：使用 `YYYY-MM#1`、`YYYY-MM#2`，整月可完成，但第 2 次需在第 1 次完成後才可打卡。
- 主日月內四次：使用 `YYYY-MM#1` 到 `YYYY-MM#4`，整月可完成，但需依序完成。
- `month`：`yyyy-MM`，例如 `2026-06`。

## 任務出現規則

任務是否出現在 LIFF 頁面，應依照 `Asia/Taipei` 當日日期判斷。

| 任務 | 出現規則 | 打卡頻率 |
| --- | --- | --- |
| 晨禱 | 每週二到週六出現；週日與週一不出現。 | 出現日每天可打卡一次。 |
| 小家 | 月任務，每月固定顯示第 1 次與第 2 次。 | 每月可完成兩次，第 1 次完成後才可完成第 2 次。 |
| 主日 | 月任務，每月固定顯示第 1 次到第 4 次。 | 每月可完成四次，需依序完成。 |
| 十一奉獻 | 月任務，每個月第一天更新一次。 | 每月可完成一次。 |
| 禱告會 | 依需求決定，可先用 week。 | API / UI 尚未實作。 |

### 後端防呆規則

- `/api/status` 只回傳當天應該出現的任務狀態。
- `/api/checkin` 若收到當天不應出現的任務，會回傳錯誤且不寫入 `checkins`。
- 晨禱在週日與週一不可打卡，即使前端被繞過，後端也會拒絕寫入。

## App 資料流程

1. LIFF 頁面取得 LINE `idToken`。
2. `/api/status` 驗證 token，並查詢 `checkins`（目前仍以 `line_user_id` 查詢）。
3. 如果找到符合目前任務週期的 `checkins` row，該任務顯示為 `已完成`。
4. 使用者點擊打卡時，`/api/checkin` 驗證 token。
5. `/api/checkin` 新增一筆 `checkins` row。
6. 若同一個 `line_user_id`、`blessing_type`、`period_key` 已經存在，API 回傳成功，不再新增重複 row。

## Production Migration Notes

在 Supabase SQL Editor 執行 `supabase/schema.sql`。

這份 migration 會：

- 刪除 `user_task_status`、`user_daily_status`。
- 確認 `checkins` 必要欄位、constraints、indexes 都存在。
- 建立 `teams`、`users` 表（分階段處理循環 FK）。
- 為 `checkins` 新增 `user_id`、`team_id` 欄位與相關 indexes。
- 從既有 `checkins` 回填 `users`，並更新 `checkins.user_id`。
- 歷史 `checkins.team_id` 維持 `null`。
- `user_id` 暫不设 NOT NULL，等 API 更新後再補。
- 若 `checkins` 中有重複 row，保留最早的 `checked_in_at`，刪除其他重複資料。

## Row Level Security

`public.checkins`、`public.users`、`public.teams` 均已啟用 RLS。

目前 App 透過 Vercel serverless API routes 使用 `SUPABASE_SERVICE_ROLE_KEY` 讀寫資料，因此瀏覽器端不會直接存取 Supabase 資料表。
