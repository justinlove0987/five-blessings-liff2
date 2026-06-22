# Supabase 資料表結構

這份文件記錄「五重祝福」LINE LIFF 打卡 App 目前使用的 Supabase 資料庫結構與任務規則。

目前 App 以單一資料表作為資料來源：

- `checkins`：每位使用者、每個任務、每個週期只會有一筆完成紀錄。

舊的彙整表已不再使用：

- `user_task_status`
- `user_daily_status`

## 資料表：`checkins`

`checkins` 用來記錄使用者在某個任務週期內已完成打卡。只要存在對應 row，就代表該任務在該週期已完成。

| 欄位 | 型別 | 可為空 | 說明 |
| --- | --- | --- | --- |
| `id` | `uuid` | 否 | 主鍵，預設使用 `gen_random_uuid()` 產生。 |
| `line_user_id` | `text` | 否 | 從 LINE ID token 驗證後取得的 LINE user id。 |
| `display_name` | `text` | 否 | 打卡當下的 LINE 顯示名稱。 |
| `blessing_type` | `text` | 否 | 任務代碼，例如 `morningPrayer`、`smallGroup`、`sunday`、`tithe`。 |
| `period_type` | `text` | 否 | 任務週期類型：`day`、`week`、`month`。 |
| `period_key` | `text` | 否 | 任務週期識別值，用於查詢與避免重複打卡。 |
| `checked_in_at` | `timestamptz` | 否 | 使用者完成打卡的時間。 |
| `created_at` | `timestamptz` | 否 | row 建立時間。 |

## Constraints

- 主鍵：`id`
- 同一任務週期只能完成一次：
  - `unique (line_user_id, blessing_type, period_key)`
- `blessing_type` 允許值：
  - `morningPrayer`
  - `smallGroup`
  - `sunday`
  - `tithe`
- `period_type` 允許值：
  - `day`
  - `week`
  - `month`

## Indexes

- `checkins_line_user_id_idx`：建立在 `line_user_id`
- `checkins_period_key_idx`：建立在 `period_key`

## 任務週期規則

所有任務週期都以 `Asia/Taipei` 時區計算。

| 任務 | `blessing_type` | `period_type` | `period_key` 格式 | 範例 |
| --- | --- | --- | --- | --- |
| 晨禱 | `morningPrayer` | `day` | `YYYY-MM-DD` | `2026-06-22` |
| 小家 | `smallGroup` | `week` | 週日日期，`YYYY-MM-DD` | `2026-06-21` |
| 主日 | `sunday` | `week` | 週日日期，`YYYY-MM-DD` | `2026-06-21` |
| 十一奉獻 | `tithe` | `month` | `YYYY-MM` | `2026-06` |

## 任務出現規則

任務是否出現在 LIFF 頁面，應依照 `Asia/Taipei` 當日日期判斷。

| 任務 | 出現規則 | 打卡頻率 |
| --- | --- | --- |
| 晨禱 | 每週二到週六出現；週日與週一不出現。 | 出現日每天可打卡一次。 |
| 小家 | 週任務，每週日更新一次；日期顯示為週日到週六。 | 每個週日開始的週期可完成一次。 |
| 主日 | 週任務，每週日更新一次；日期顯示為週日到週六。 | 每個週日開始的週期可完成一次。 |
| 十一奉獻 | 月任務，每個月第一天更新一次。 | 每月可完成一次。 |

### 後端防呆規則

- `/api/status` 只回傳當天應該出現的任務狀態。
- `/api/checkin` 若收到當天不應出現的任務，會回傳錯誤且不寫入 `checkins`。
- 晨禱在週日與週一不可打卡，即使前端被繞過，後端也會拒絕寫入。

## App 資料流程

1. LIFF 頁面取得 LINE `idToken`。
2. `/api/status` 驗證 token，並查詢 `checkins`。
3. 如果找到符合目前任務週期的 `checkins` row，該任務顯示為 `已完成`。
4. 使用者點擊打卡時，`/api/checkin` 驗證 token。
5. `/api/checkin` 新增一筆 `checkins` row。
6. 若同一個 `line_user_id`、`blessing_type`、`period_key` 已經存在，API 回傳成功，不再新增重複 row。

## Production Migration Notes

在 Supabase SQL Editor 執行 `supabase/schema.sql`。

這份 migration 會：

- 刪除 `user_task_status`。
- 刪除 `user_daily_status`。
- 保留 `checkins` 作為目前唯一使用中的 App 資料表。
- 確認 `checkins` 必要欄位、constraints、indexes 都存在。
- 如果 `checkins` 中有同一個 `line_user_id`、`blessing_type`、`period_key` 的重複 row，保留最早的 `checked_in_at`，刪除其他重複資料。

## Row Level Security

`public.checkins` 已啟用 RLS。

目前 App 透過 Vercel serverless API routes 使用 `SUPABASE_SERVICE_ROLE_KEY` 讀寫資料，因此瀏覽器端不會直接存取 Supabase 資料表。
