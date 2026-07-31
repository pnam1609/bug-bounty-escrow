# Database & API review — đối chiếu với `docs/flow/`

Tài liệu này review database migrations và NestJS API so với 4 flow doc trong
[`docs/flow/`](flow/), và định nghĩa target schema/API.

Nguồn sự thật theo thứ tự ưu tiên:

1. `docs/flow/*.md` — requirement thật của sản phẩm.
2. Tài liệu này — target contract suy ra từ flow.
3. `PROJECT_CONTEXT.md` — đã được sync theo tài liệu này.

> **Cập nhật sau bản sửa flow (submit bug + create program).** Xem mục 9 cho delta và những gì
> đã đổi theo.
>
> **Trạng thái: bước 1–12 của mục 7 đã được triển khai.** Migration được viết lại tại chỗ (dự án
> chưa có dữ liệu production). Mục 3–6 giữ nguyên như bản review gốc để làm hồ sơ quyết định,
> ngoại trừ bảng settlement route đã reconcile ở DOC-RR-02;
> cột "Trạng thái" ở mục 1 và mục 8 phản ánh những gì đã sửa. Còn lại: escrow on-chain thật
> (milestone 2, bước 13) và AI triage (milestone 3, bước 14).
>
> **DOC-RR-02 (settlement route reconciliation).** Các route report cũ
> `approve-reward`, `pay` và `confirm-payment` chỉ còn để giữ contract history và trả `410 Gone`
> (`reward_settlement_flow_required`); chúng không phải mutation hiện tại của owner/reviewer.
> Settlement dùng durable owner-only `POST /api/reports/:id/reward-settlement-intents` cùng
> các subroute `current`, `approval-observations`, `reconcile` và `cancel` (xem
> [api-contracts.md](api-contracts.md#reward-settlement-mutations--owner-only-durable-flow)).

---

## 1. Tổng kết

| Hạng mục | Trạng thái ban đầu | Sau khi sửa |
| --- | --- | --- |
| Onboarding + auth | Khớp flow | Không đổi; thêm mã lỗi conflict ổn định |
| Program CRUD | ~35% target contract | Đủ target contract: tags, resources, impacts, rules, logo |
| Public program list | Thiếu filter/sort/`totalPaid` | Đủ filter/sort; `totalPaid` có visibility server-side |
| Report submit | `reports.impact` free text | `report_impacts` ↔ `program_impacts` có snapshot |
| Manual review | Error mapping hỏng mọi UI error state | 22023/42501/P0002/28000 map đúng + mã máy đọc |
| Escrow / payout / publish | Chưa có | Có off-chain lifecycle; report settlement routes cũ `pay`/`confirm` là legacy `410`, flow hiện tại dùng durable owner-only intents |
| Disclosure / Known issues | Chưa có | `report_disclosures` + public read endpoint |
| Notifications API | Bảng có, API không | `GET /api/me/notifications` + mark read |
| Reviewer assignment | Bảng có, không gán được | API assign/remove + RLS write policy |

**5 defect nghiêm trọng nhất** (chi tiết ở mục 3–4) — tất cả đã sửa:

1. ✅ Mọi business-rule error từ RPC trả về **HTTP 500**, không phải 403/409.
2. ✅ `approve_report_reward_atomic` **không trừ `remaining_pool`** → over-commit reward pool.
3. ✅ `update_program_atomic` **xóa rồi insert lại `program_scopes`** → owner không bao giờ sửa được scope sau khi có report đầu tiên (FK restrict).
4. ✅ Public program list **hard-code `status = 'active'`** ở cả API lẫn RLS → không thể hiển thị ended programs như bounty-table flow yêu cầu.
5. ✅ (Lịch sử) Không có đường nào để **fund escrow** → route legacy `approve-reward` luôn fail vì
   `remaining_pool = 0`; route này hiện đã trả `410 Gone`.

Ngoài ra phát hiện thêm trong lúc sửa: `ESCROW_TRANSACTION_TYPES` và
`ESCROW_TRANSACTION_STATUSES` trong `packages/domain` không khớp CHECK constraint của
`escrow_transactions` (`payout` vs `reward_payment`, `reverted|timeout` vs `failed`). Đã thống
nhất theo domain và thêm assertion chống drift trong `verify_schema.sql`.

---

## 2. Chỗ `PROJECT_CONTEXT.md` cần sửa

| Mục | Nội dung hiện tại | Theo flow |
| --- | --- | --- |
| §8 `RewardTier` | Chỉ có `severity`, `minReward`, `maxReward` | Có `assetType`, `calculationType` (`range`/`flat`/`percentage`), `flatAmount`, `percentageBps`, `maxRewardCap`, `calculationNote`. Unique theo `(program, assetType, severity)`. |
| §8 `BountyProgram` | Thiếu `shortSummary`, `websiteUrl`, `logo`, `tags`, `resources`, policies | Create-program flow §3 yêu cầu đầy đủ |
| §8 `VulnerabilityReport` | `impact: string` | `report_impacts[]` (M2M có snapshot) + `program_impacts` catalog |
| §9 Database tables | 13 bảng | Thiếu `program_reviewers` (đã tồn tại trong code), `program_tags`, `program_resources`, `program_impacts`, `program_prohibited_activities`, `report_impacts`, `report_disclosures` |
| §11 API | Không có publish | Create-program flow CP-13 kết thúc bằng `Publish program` → cần `POST /api/programs/:id/publish` |
| §11 API | Không có notifications | Cả 2 flow researcher/owner đều có notification icon trong header |
| §9 Security rules | "Public chỉ xem active programs" | Bounty-table flow: public xem cả `active` và ended (`expired`/`closed`) |
| §7 routes | `programs/[slug]` | Đã chốt canonical public route `/programs/:slug`; owner mutations, report submission và foreign key tiếp tục dùng UUID. |
| §2 state machine | `SUBMITTED → TRIAGED → …` | Đúng, nhưng `DRAFT` không tồn tại server-side (submit flow §2: draft chỉ nằm trong `localStorage`) |

---

## 3. Defect trong code hiện tại

### D-1 · Business-rule error → HTTP 500 (nghiêm trọng)

Tất cả RPC trong [20260725002100_offchain_atomic_rpcs.sql](../packages/database/migrations/20260725002100_offchain_atomic_rpcs.sql)
raise bằng `errcode = '22023'` hoặc `'42501'`. Nhưng
[database-error.ts:51](../apps/api/src/database/database-error.ts#L51) chỉ map
`PGRST116`, `23505`, `23503`, `23514`, `40001`, `40P01`, `57014`. Mọi code khác rơi vào
`default → 'unknown'`, và [api-exception.filter.ts:101](../apps/api/src/common/filters/api-exception.filter.ts#L101)
biến `unknown` thành `500 internal_server_error`.

Hệ quả trực tiếp lên flow:

| Nghiệp vụ | errcode | Hiện tại | Cần |
| --- | --- | --- | --- |
| Submit vào program không active (SR-11) | `22023` | 500 | 409 + code riêng `program_not_accepting_reports` |
| Report transition không hợp lệ | `22023` | 500 | 409 `invalid_report_transition` |
| Reward ngoài min/max hoặc vượt pool | `22023` | 500 | 409 `reward_out_of_bounds` |
| Report/program không accessible | `42501` | 500 | 403 |
| Profile không tồn tại | `P0002` | 500 | 404 |
| Chưa authenticate trong RPC | `28000` | 500 | 401 |

Flow `SR-08 → SR-11` (submit error vs program closed) không thể phân biệt được nếu cả hai
đều là 500. Đây là fix bắt buộc trước mọi thứ khác.

**Fix:** thêm `22023`, `42501`, `P0002`, `28000` vào `normalizeDatabaseError`, và cho RPC
raise kèm `using errcode = '22023', message = '...', detail = '<machine_code>'` để API map
sang stable error code cho frontend.

### D-2 · `approve_report_reward_atomic` không reserve pool (nghiêm trọng)

[Dòng 710](../packages/database/migrations/20260725002100_offchain_atomic_rpcs.sql#L710) check
`reward_amount > program_record.remaining_pool` nhưng **không hề `update programs set remaining_pool = ...`**.
Hai report cùng được approve toàn bộ pool → tổng approved > số USDC thực có trong escrow.

**Fix:** tách `remaining_pool` thành hai khái niệm:

```
total_pool          -- đã fund vào escrow
reserved_pool       -- tổng approved_reward của report chưa paid
paid_pool           -- tổng đã payout on-chain
available = total_pool - reserved_pool - paid_pool
```

`approve_reward` phải `update programs set reserved_pool = reserved_pool + amount` trong
cùng transaction, và check `amount <= available`. Khi payout confirmed thì chuyển reserved → paid.

### D-3 · Không sửa được scope sau khi có report

[`update_program_atomic` dòng 233](../packages/database/migrations/20260725002100_offchain_atomic_rpcs.sql#L233)
làm `delete from public.program_scopes where program_id = ...` rồi insert lại. Nhưng
`reports.affected_scope_id` có FK `on delete restrict`
([DB-005](../packages/database/migrations/20260725000500_db_005_reports.sql#L12) và composite FK ở
[DB-014](../packages/database/migrations/20260725001400_db_014_indexes_and_constraints.sql#L10)).

→ Program active có 1 report là owner vĩnh viễn không PATCH được scope. Trả 409, không có
cách khắc phục.

**Fix:** đổi sang upsert theo `id` (client gửi `id` cho scope đã tồn tại), soft-delete
(`archived_at`) cho scope bị bỏ, và chặn xóa scope đang được report tham chiếu. Áp dụng
tương tự cho `program_reward_tiers` và `program_impacts` (impacts thì bắt buộc phải giữ
snapshot vì `report_impacts` cần lịch sử).

### D-4 · Public list không hỗ trợ ended programs

- API: [program.repository.ts:94](../apps/api/src/programs/program.repository.ts#L94) hard-code `.eq('status','active')`.
- RLS: [`programs_select_public_or_permitted`](../packages/database/migrations/20260725001700_rls_002_programs.sql#L60) chỉ `status = 'active'`.

Bounty-table flow §2 yêu cầu public thấy cả active và ended, active xếp trước. Phải sửa cả
hai (RLS quan trọng vì Supabase Realtime tôn trọng RLS, dù API dùng service role).

Đề xuất thêm cột dẫn xuất để tránh rải `in ('active','expired','closed')` khắp nơi:

```sql
alter table public.programs
  add column is_publicly_listed boolean
    generated always as (status in ('active', 'expired', 'closed')) stored;
```

### D-5 · Không có funding path

`programs.total_pool` / `remaining_pool` default `0` và **không có RPC/endpoint nào update chúng**.
`approve_report_reward_atomic` check `reward_amount > remaining_pool` → luôn fail trên dữ liệu
thật. Chỉ chạy được với seed data set sẵn pool.

Create-program flow CP-11 → CP-13 yêu cầu fund trong cùng user journey. Cần
`POST /api/programs/:id/fund` ngay cả ở giai đoạn off-chain (mock transaction).

### D-6 · Attachment row tạo trước khi upload thành công

[`prepare_report_attachment_atomic`](../packages/database/migrations/20260725002100_offchain_atomic_rpcs.sql#L400)
insert `report_attachments` rồi mới trả signed URL. Nếu upload fail (state `SR-09`), row vẫn
tồn tại và trỏ tới object không có thật. `attachment-cleanup.service.ts` chỉ dọn chiều ngược
lại (object không có row).

Ngoài ra `SR-09 · Retry attachment` sẽ tạo **row thứ hai** cho cùng một file.

**Fix:** thêm `report_attachments.upload_status` (`pending` | `uploaded` | `failed`) +
`uploaded_at`; chỉ trả về attachment `uploaded` trong report detail; retry thì reuse
`attachmentId` cũ thay vì insert mới; cleanup job xóa row `pending` quá hạn.

### D-7 · Các điểm nhỏ

| # | Vấn đề | File |
| --- | --- | --- |
| D-7a | `ilike('name', '%'+search+'%')` — `%`/`_` do user nhập thành wildcard; ký tự PostgREST-reserved (`,` `(` `)`) có thể làm lệch filter. Cần escape. | [program.repository.ts:98](../apps/api/src/programs/program.repository.ts#L98) |
| D-7b | Reviewer filter `status` != active → luôn trả rỗng (chỉ owner được filter) | [program.repository.ts:86](../apps/api/src/programs/program.repository.ts#L86) |
| D-7c | `reportSummarySchema` không có `programName`/`programSlug` → màn "My reports" và "Review inbox" phải N+1 | [report.ts:146](../packages/shared/src/contracts/report.ts#L146) |
| D-7d | `programSchema` không có `ownerId`, `createdAt`, `contractAddress` → owner dashboard thiếu dữ liệu | [program.ts:99](../packages/shared/src/contracts/program.ts#L99) |
| D-7e | `signedUploadResponse.expiresAt` được tính bằng `Date.now() + 60_000` ở controller thay vì lấy từ storage provider → có thể lệch | [collaboration.controller.ts:51](../apps/api/src/reports/collaboration.controller.ts#L51) |
| D-7f | `program_reviewers` có bảng + RLS nhưng không có API gán reviewer → role `reviewer` không dùng được | [rls_002](../packages/database/migrations/20260725001700_rls_002_programs.sql#L3) |
| D-7g | `reports.status = 'draft'` là dead state (server luôn tạo `submitted`) | [DB-005](../packages/database/migrations/20260725000500_db_005_reports.sql#L36) |
| D-7h | `reportContentHash` sẽ sai khi chuyển sang `report_impacts` — phải include selected impacts vào canonical payload | [report.service.ts:18](../apps/api/src/reports/report.service.ts#L18) |

---

## 4. Gap: bảng còn thiếu

Flow yêu cầu 7 bảng chưa tồn tại. Tất cả đều nằm trong
[create-program flow §3 "Database mapping requirement"](flow/create-program-owner-flow-for-figma.md).

### 4.1 `program_tags`

```sql
create table public.program_tags (
  id uuid default gen_random_uuid() primary key,
  program_id uuid not null references public.programs (id) on delete cascade,
  label text not null check (length(btrim(label)) between 1 and 40),
  normalized_tag text not null check (normalized_tag ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  created_at timestamptz not null default now(),
  unique (program_id, normalized_tag)
);
```

Constraint 1–10 tag/program: enforce ở Zod + RPC (Postgres không có declarative cardinality).

### 4.2 `program_resources`

```sql
create table public.program_resources (
  id uuid default gen_random_uuid() primary key,
  program_id uuid not null references public.programs (id) on delete cascade,
  resource_type text not null
    check (resource_type in ('documentation','repository','audit','website','other')),
  title text not null check (length(btrim(title)) between 1 and 120),
  url text not null check (url ~* '^https://'),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (program_id, sort_order) deferrable initially deferred
);
```

### 4.3 `program_impacts` — bảng quan trọng nhất còn thiếu

Catalog impact do owner cấu hình, researcher chọn khi submit.

```sql
create table public.program_impacts (
  id uuid default gen_random_uuid() primary key,
  program_id uuid not null references public.programs (id) on delete cascade,
  asset_type text not null
    check (asset_type in ('smart_contract','website','api','mobile')),
  severity text not null
    check (severity in ('critical','high','medium','low','informational')),
  title text not null check (length(btrim(title)) between 1 and 300),
  normalized_title text not null,
  description text check (description is null or length(description) <= 2000),
  source text not null default 'custom' check (source in ('template','custom')),
  template_key text,          -- snapshot key, không FK sang template toàn cục
  enabled boolean not null default true,
  sort_order integer not null default 0 check (sort_order >= 0),
  archived_at timestamptz,    -- soft delete: report_impacts cần giữ tham chiếu
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (program_id, asset_type, normalized_title)
);
```

Template impacts là **static catalog trong `packages/domain`**, copy thành row program-owned
lúc create (flow CP-02I: "lưu thành program-owned snapshot để thay đổi template sau này không
âm thầm đổi active program"). Không cần bảng template trong DB.

Ràng buộc "mỗi asset type có in-scope asset phải có ≥1 enabled impact" là cross-table →
enforce trong RPC `create_program_atomic` / `publish_program_atomic`, không phải CHECK.

### 4.4 `program_prohibited_activities`

```sql
create table public.program_prohibited_activities (
  id uuid default gen_random_uuid() primary key,
  program_id uuid not null references public.programs (id) on delete cascade,
  source text not null check (source in ('platform_default','custom')),
  rule_key text,              -- chỉ có với platform_default
  body text not null check (length(btrim(body)) between 1 and 1000),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now()
);
```

Platform defaults được **snapshot** vào từng program lúc create (flow: "Platform defaults luôn
tồn tại"), để sửa default sau này không đổi program đã publish.

### 4.5 `report_impacts`

```sql
create table public.report_impacts (
  id uuid default gen_random_uuid() primary key,
  report_id uuid not null references public.reports (id) on delete cascade,
  program_impact_id uuid references public.program_impacts (id) on delete restrict,
  source text not null check (source in ('program','custom')),
  custom_title text,
  impact_title_snapshot text not null,
  impact_severity_snapshot text
    check (impact_severity_snapshot is null
      or impact_severity_snapshot in ('critical','high','medium','low','informational')),
  asset_type_snapshot text not null
    check (asset_type_snapshot in ('smart_contract','website','api','mobile')),
  created_at timestamptz not null default now(),
  constraint report_impacts_source_check check (
    (source = 'program' and program_impact_id is not null and custom_title is null)
    or (source = 'custom' and program_impact_id is null
        and custom_title is not null and length(btrim(custom_title)) > 0)
  ),
  unique nulls not distinct (report_id, program_impact_id, custom_title)
);
```

Validate trong `submit_report_atomic`:

- ≥1 row cho mỗi report.
- `program_impact_id` phải thuộc `reports.program_id`, `enabled = true`, và
  `asset_type` khớp `program_scopes.asset_type` của `affected_scope_id`.
- Row `custom` chỉ được chấp nhận khi `programs.allow_custom_impact = true`.

### 4.6 `report_disclosures`

```sql
create table public.report_disclosures (
  id uuid default gen_random_uuid() primary key,
  report_id uuid not null unique references public.reports (id) on delete restrict,
  program_id uuid not null references public.programs (id) on delete restrict,
  decision text not null check (decision in ('keep_private','publish_summary','publish_full')),
  decided_by uuid not null references public.profiles (id) on delete restrict,
  decided_at timestamptz not null default now(),
  public_title text,
  public_summary text check (public_summary is null or length(public_summary) <= 5000),
  public_content text check (public_content is null or length(public_content) <= 50000),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint report_disclosures_published_content_check check (
    decision = 'keep_private'
    or (published_at is not null and public_title is not null and public_summary is not null)
  )
);
```

**Bảng tách riêng khỏi `reports` là bắt buộc** (create-program flow §3): public query không
được lỡ select nội dung private. Public read chỉ chạm `report_disclosures`, không join `reports`.

Chỉ cho tạo disclosure khi `programs.status in ('expired','closed')` và report ở trạng thái
resolved — enforce trong RPC.

### 4.7 `program_payout_totals` (view, cho `totalPaid`)

```sql
create view public.program_payout_totals as
select
  p.id as program_id,
  coalesce(sum(t.amount) filter (
    where t.transaction_type = 'reward_payment' and t.status = 'confirmed'
  ), 0) as total_paid,
  count(*) filter (
    where t.transaction_type = 'reward_payment' and t.status = 'confirmed'
  ) as paid_report_count
from public.programs p
left join public.escrow_transactions t on t.program_id = p.id
group by p.id;
```

---

## 5. Gap: cột còn thiếu trên bảng có sẵn

### 5.1 `programs`

```sql
alter table public.programs
  add column short_summary text not null default ''
    check (length(btrim(short_summary)) between 1 and 280),
  add column website_url text
    check (website_url is null or website_url ~* '^https://'),
  add column logo_storage_path text,
  add column poc_policy text not null default 'required'
    check (poc_policy in ('required','optional')),
  add column poc_policy_note text check (poc_policy_note is null or length(poc_policy_note) <= 2000),
  add column reward_policy text check (reward_policy is null or length(btrim(reward_policy)) between 1 and 20000),
  add column testing_restrictions text check (testing_restrictions is null or length(testing_restrictions) <= 10000),
  add column submission_acknowledgment text
    check (submission_acknowledgment is null or length(submission_acknowledgment) <= 1000),
  add column allow_custom_impact boolean not null default true,
  add column total_paid_visibility text not null default 'private'
    check (total_paid_visibility in ('public','private')),
  add column reserved_pool numeric(30,6) not null default 0 check (reserved_pool >= 0),
  add column paid_pool numeric(30,6) not null default 0 check (paid_pool >= 0),
  add column published_at timestamptz;
```

Bỏ `remaining_pool` (thay bằng generated column `total_pool - reserved_pool - paid_pool`) hoặc
giữ nhưng bắt buộc update trong `approve_reward`/`payout` — xem D-2. Khuyến nghị:

```sql
-- thay remaining_pool bằng available_pool có tính reserved
alter table public.programs
  add column available_pool numeric(30,6)
    generated always as (total_pool - reserved_pool - paid_pool) stored;
```

`reward_policy` là bắt buộc theo flow nhưng chỉ khi publish — giữ nullable ở DB, enforce trong
`publish_program_atomic`.

### 5.2 `program_reward_tiers` — breaking change

```sql
alter table public.program_reward_tiers
  drop constraint program_reward_tiers_program_id_severity_key,
  add column asset_type text not null default 'smart_contract'
    check (asset_type in ('smart_contract','website','api','mobile')),
  add column calculation_type text not null default 'range'
    check (calculation_type in ('range','flat','percentage')),
  add column flat_amount numeric(30,6) check (flat_amount is null or flat_amount > 0),
  add column percentage_bps integer check (percentage_bps is null or percentage_bps between 1 and 10000),
  add column max_reward_cap numeric(30,6) check (max_reward_cap is null or max_reward_cap > 0),
  add column calculation_note text check (calculation_note is null or length(calculation_note) <= 2000),
  add constraint program_reward_tiers_program_asset_severity_key
    unique (program_id, asset_type, severity),
  add constraint program_reward_tiers_calculation_check check (
    (calculation_type = 'range'
      and min_reward is not null and max_reward is not null
      and flat_amount is null and percentage_bps is null and max_reward_cap is null)
    or (calculation_type = 'flat'
      and flat_amount is not null
      and percentage_bps is null and max_reward_cap is null)
    or (calculation_type = 'percentage'
      and percentage_bps is not null and max_reward_cap is not null
      and flat_amount is null)
  );
```

`min_reward`/`max_reward` phải chuyển thành nullable để hỗ trợ `flat`/`percentage`.

⚠️ `approve_report_reward_atomic` hiện tra tier bằng `(program_id, severity)`
([dòng 703](../packages/database/migrations/20260725002100_offchain_atomic_rpcs.sql#L703)). Sau
thay đổi này sẽ trả nhiều row → **phải sửa** để join qua `affected_scope_id → asset_type`, và
tính bound theo `calculation_type`:

```
range      → min_reward .. max_reward
flat       → flat_amount .. flat_amount
percentage → 0 .. max_reward_cap   (số thực do reviewer nhập, cap là trần)
```

### 5.3 `reports`

```sql
alter table public.reports
  alter column impact drop not null,               -- thay bằng report_impacts
  alter column reproduction_steps drop not null,   -- optional khi poc_policy = 'optional'
  add column paid_at timestamptz;
```

Cộng thêm CHECK cross-table (enforce trong RPC, không phải DB): khi
`programs.poc_policy = 'required'` thì `reproduction_steps` bắt buộc.

Giữ `impact` (nullable) làm legacy field trong giai đoạn chuyển tiếp, hoặc drop hẳn nếu chấp
nhận reset dữ liệu — dự án chưa production nên khuyến nghị **drop và viết lại migration**.

### 5.4 `report_attachments`

```sql
alter table public.report_attachments
  add column upload_status text not null default 'pending'
    check (upload_status in ('pending','uploaded','failed')),
  add column uploaded_at timestamptz,
  add constraint report_attachments_upload_state_check
    check ((upload_status = 'uploaded') = (uploaded_at is not null));
```

### 5.5 `escrow_transactions`

Thêm `refund` khi close program đã có; hiện đã đủ. Chỉ cần thêm index cho query
`GET /api/transactions/:hash`:

```sql
create unique index escrow_transactions_hash_idx
  on public.escrow_transactions (chain_id, transaction_hash, coalesce(log_index, -1));
```

(đã có `escrow_transactions_chain_event_key`, nhưng lookup by hash-only cần thêm
`create index on public.escrow_transactions (transaction_hash);`)

---

## 6. Target API surface

Đánh dấu: ✅ đã có · ⚠️ có nhưng cần sửa · ❌ chưa có

### 6.1 Current user

| Method | Path | Trạng thái | Ghi chú |
| --- | --- | --- | --- |
| GET | `/api/me` | ✅ | |
| PATCH | `/api/me/onboarding` | ✅ | Conflict `23505` → 409 hoạt động đúng |
| PATCH | `/api/me` | ✅ | Chỉ `displayName`; role cố định sau onboarding |
| GET | `/api/me/notifications` | ❌ | Notification icon trong cả 2 header |
| POST | `/api/me/notifications/read` | ❌ | Mark read (bulk hoặc theo id) |

### 6.2 Programs — public

| Method | Path | Trạng thái | Ghi chú |
| --- | --- | --- | --- |
| GET | `/api/programs` | ⚠️ | Xem 6.3 |
| GET | `/api/programs/:slug` | ⚠️ | Canonical public detail lookup; cần trả thêm `impacts`, `tags`, `resources`, `prohibitedActivities`, `pocPolicy`, `rewardPolicy`, `totalPaid`, `totalPaidVisibility` |
| GET | `/api/programs/:id/disclosures` | ❌ | Known Issues — chỉ đọc `report_disclosures` đã published |

### 6.3 `GET /api/programs` — query contract đích

```ts
{
  page?: number,                 // ✅ default 1
  limit?: number,                // ✅ default 20, max 100
  search?: string,               // ⚠️ cần escape % _ và ký tự PostgREST-reserved
  sort?: 'newest' | 'deadline' | 'name'
       | 'maxBounty' | 'totalPaid',   // ❌ 2 giá trị sau
  sortDirection?: 'asc' | 'desc',     // ❌ bounty-table: click header lần 2 = desc
  status?: 'active' | 'ended',        // ❌ public enum, khác ProgramStatus nội bộ
  assetType?: AssetType[],            // ❌
  severity?: Severity[],              // ❌
  minMaxReward?: string,              // ❌ monetary
  closing?: '7d' | '30d' | 'ongoing', // ❌
  funded?: boolean,                   // ❌ available_pool > 0
}
```

Response item cần thêm:

```ts
type PublicProgramListItem = Program & {
  shortSummary: string;
  logoUrl: string | null;
  tags: string[];
  totalPaid: string | null;          // null khi visibility = private
  totalPaidVisibility: 'public' | 'private';
  maxBounty: string;                 // server-computed, vì cần sort được
};
```

`totalPaid` phải được **server quyết định trước khi serialize** — không trả số thật rồi ẩn ở UI
(bounty-table flow §2).

`status` public là enum riêng (`active` | `ended`) map sang
`active` / `expired|closed`. Không expose `draft`/`awaiting_funding`/`paused` ra public.

### 6.4 Programs — owner

| Method | Path | Trạng thái | Ghi chú |
| --- | --- | --- | --- |
| GET | `/api/owner/programs` | ❌ | Owner list riêng, không lẫn với public list (bỏ nhánh `or(...)` ở D-7b) |
| POST | `/api/programs` | ⚠️ | Payload cần mở rộng đầy đủ target contract §3 create-program flow |
| PATCH | `/api/programs/:id` | ⚠️ | D-3: upsert thay vì delete-all |
| POST | `/api/programs/:id/logo/upload-url` | ❌ | Signed upload cho logo (private draft bucket) |
| POST | `/api/programs/:id/deploy` | ❌ | CP-10 |
| POST | `/api/programs/:id/fund` | ❌ | CP-11/12/13 — bắt buộc, xem D-5 |
| POST | `/api/programs/:id/publish` | ❌ | CP-13 → `draft`/`awaiting_funding` → `active` |
| POST | `/api/programs/:id/pause` | ❌ | Status machine có `paused` nhưng không có transition |
| POST | `/api/programs/:id/close` | ❌ | + refund remaining |
| POST | `/api/programs/:id/reviewers` | ❌ | D-7f: gán reviewer |
| DELETE | `/api/programs/:id/reviewers/:userId` | ❌ | |

`POST /api/programs` body đích:

```ts
{
  name, slug, shortSummary, description, websiteUrl,
  logoStoragePath?: string,
  tags: string[],                        // 1..10
  deadline?: string,
  resources: ProgramResourceInput[],     // 0..20
  scopes: ProgramScopeInput[],           // 1..50
  impacts: ProgramImpactInput[],         // ≥1 enabled cho mỗi asset type có in-scope asset
  rewardTiers: RewardTierInput[],        // ≥1 cho mỗi asset type; unique (assetType, severity)
  rules: {
    pocPolicy: 'required' | 'optional',
    pocPolicyNote?: string,
    rewardPolicy: string,
    prohibitedActivities: string[],      // custom, 0..20 — defaults do server snapshot
    testingRestrictions?: string,
    submissionAcknowledgment?: string,
    allowCustomImpact: boolean,
  },
}
```

Server-created: `status='draft'`, `totalPool=0`, `reservedPool=0`, `paidPool=0`,
`contractAddress=null`, `publishedAt=null`.

### 6.5 Reports

| Method | Path | Trạng thái | Ghi chú |
| --- | --- | --- | --- |
| GET | `/api/reports` | ⚠️ | Thêm `programName`/`programSlug` vào summary (D-7c) |
| POST | `/api/programs/:id/reports` | ⚠️ | Body cần `selectedImpactIds` + `customImpacts`; bỏ `impact` free text |
| GET | `/api/reports/:id` | ⚠️ | Trả `impacts[]`, chỉ attachment `uploaded` |
| PATCH | `/api/reports/:id` | ✅ | |
| POST | `/api/reports/:id/request-information` | ✅ | |
| POST | `/api/reports/:id/validate` | ✅ | |
| POST | `/api/reports/:id/reject` | ✅ | |
| POST | `/api/reports/:id/mark-duplicate` | ✅ | |
| POST | `/api/reports/:id/approve-reward` | **410 legacy** | Giữ để tương thích contract history; không còn owner/reviewer mutation. Dùng owner-only reward-settlement intent |
| POST | `/api/reports/:id/pay` | **410 legacy** | Không còn chuyển state; dùng durable intent `reconcile`/permissionless `payReward` execution |
| POST | `/api/reports/:id/confirm-payment` | **410 legacy** | Không còn chuyển state; settlement evidence đi qua durable intent `reconcile` |
| POST | `/api/reports/:id/reward-settlement-intents` | ✅ owner-only | Tạo intent, derive amount/recipient/hash và reserve atomically |
| POST | `/api/reports/:id/reward-settlement-intents/:intentId/approval-observations` | ✅ owner-only | Lưu owner wallet `approveReward` submission/evidence |
| POST | `/api/reports/:id/reward-settlement-intents/:intentId/reconcile` | ✅ owner-only | Reconcile Arc evidence và payout relay; `payReward` execution không cấp quyền reviewer |
| POST | `/api/reports/:id/reward-settlement-intents/:intentId/cancel` | ✅ owner-only | Cancel an intent before submission and release reservation |
| POST | `/api/reports/:id/triage` | ❌ | AI (milestone 3) |
| POST | `/api/reports/:id/disclosure` | ❌ | Owner quyết định disclosure sau khi program end |

`POST /api/programs/:id/reports` body đích:

```ts
{
  affectedScopeId: string,
  selectedImpactIds: string[],           // ≥1, phải thuộc program + enabled + khớp asset type
  customImpacts?: string[],              // chỉ khi program.allowCustomImpact
  title: string,                         // 1..300
  description: string,                   // 1..50_000
  reproductionSteps?: string,            // bắt buộc khi program.pocPolicy = 'required'
  proposedSeverity: Severity,
}
```

Bỏ `impact` khỏi request. `contentHash` canonical payload phải include
`selectedImpactIds` (đã sort) và `customImpacts` (D-7h).

### 6.6 Report collaboration

| Method | Path | Trạng thái |
| --- | --- | --- |
| POST | `/api/reports/:id/attachments/upload-url` | ⚠️ D-6: hỗ trợ `attachmentId` để retry |
| POST | `/api/reports/:id/attachments/:attachmentId/complete` | ❌ Đánh dấu `uploaded` sau khi PUT thành công |
| GET | `/api/reports/:id/attachments/:attachmentId/download-url` | ✅ |
| GET / POST | `/api/reports/:id/comments` | ✅ |

### 6.7 Transactions

| Method | Path | Trạng thái |
| --- | --- | --- |
| GET | `/api/programs/:id/transactions` | ❌ |
| GET | `/api/transactions/:hash` | ❌ |
| GET | `/api/me/rewards` | ❌ Researcher "Rewards" nav |

---

## 7. Thứ tự triển khai đề xuất

Dự án chưa production → **được phép sửa migration tại chỗ** thay vì chồng `alter table`.
Khuyến nghị viết lại DB-002..DB-005 và RPC file, sạch hơn nhiều so với 15 migration vá.

| Bước | Nội dung | Chặn cái gì | Trạng thái |
| --- | --- | --- | --- |
| 1 | **D-1** error mapping (`22023`/`42501`/`P0002`/`28000`) + stable error codes | Mọi error state trong 3 flow | ✅ |
| 2 | **D-2** reserved/paid pool + fix tier lookup | Đúng đắn tài chính | ✅ |
| 3 | **D-3** upsert scope/tier thay vì delete-all | Owner edit program | ✅ |
| 4 | `program_impacts` + `report_impacts` + bỏ `reports.impact` | Submit bug flow đích | ✅ |
| 5 | `programs` columns mới + `program_tags`/`resources`/`prohibited_activities` | Create program flow đích | ✅ |
| 6 | `program_reward_tiers` asset_type + calculation_type | Create program flow đích | ✅ |
| 7 | **D-4** public ended programs (API + RLS) + `totalPaid` + `total_paid_visibility` | Bounty table flow | ✅ |
| 8 | Public list filters/sort đầy đủ | Bounty table flow | ✅ |
| 9 | `publish` / `status` + `deploy` / `fund` (off-chain trước) | CP-10..CP-13 | ✅ |
| 10 | **D-6** attachment `upload_status` + complete endpoint | SR-06/SR-09 | ✅ |
| 11 | Notifications API + reviewer assignment API | Header + reviewer workspace | ✅ |
| 12 | `report_disclosures` + Known Issues public read | Post-program disclosure | ✅ |
| 13 | Escrow thật (deploy/fund/pay on-chain) + contracts | Milestone 2 | ⬜ |
| 14 | AI triage | Milestone 3 | ⬜ |

---

## 8. Những gì đã thay đổi

### Migrations

Viết lại tại chỗ: `db_002_programs`, `db_003_program_scopes`, `db_004_program_reward_tiers`,
`db_005_reports`, `db_006_report_attachments`, `db_008_report_reviews`,
`db_011_escrow_transactions`, `db_012_notifications`, `db_014_indexes_and_constraints`,
`rls_002_programs`, `rls_003_reports`, `rls_004_report_collaboration`,
`storage_report_attachments`, `offchain_atomic_rpcs`.

Thêm mới:

| File | Nội dung |
| --- | --- |
| `20260725000410_db_004b_program_taxonomy.sql` | `program_tags`, `program_resources`, `program_impacts`, `program_prohibited_activities` |
| `20260725000550_db_005b_report_impacts.sql` | `report_impacts` với composite FK chứng minh impact thuộc đúng program và asset type |
| `20260725000560_db_005c_report_disclosures.sql` | `report_disclosures`, tách khỏi `reports` |
| `20260725002200_lifecycle_and_settlement_rpcs.sql` | escrow deploy/fund, publish/status, payout, reviewer, disclosure, notifications |

### Điểm thiết kế đáng lưu ý

- **Pool accounting.** `programs.available_pool` là generated column
  `total_pool - reserved_pool - paid_pool`, kèm CHECK `total_pool >= reserved_pool + paid_pool`.
  `approve_report_reward_atomic` lock program row rồi cộng vào `reserved_pool` trong cùng
  transaction; `confirm_report_payment_atomic` chuyển reserved → paid.
- **Public boundary.** `programs.public_status` là generated column (`active` / `ended` / null).
  RLS và mọi public query lọc trên cột này thay vì liệt kê status rải rác.
- **List projection.** `max_bounty`, `in_scope_asset_types`, `reward_severities` được
  denormalize trên `programs` (refresh bởi `refresh_program_projection`) để bounty table sort và
  filter không phải join child table mỗi request. GIN index cho hai cột mảng.
- **Soft delete.** `program_scopes.archived_at` và `program_impacts.archived_at`. RPC xoá cứng
  row chưa được tham chiếu và archive row đã được tham chiếu.
- **Snapshot.** Impact template và platform prohibited rules được copy thành row program-owned
  lúc create; `report_impacts` giữ snapshot title/severity/asset type lúc submit.
- **Content hash.** Canonical payload gồm cả `selectedImpactIds` (đã sort) và `customImpacts`.

### Kiểm chứng

`packages/database` chạy migrations thật trên PGlite:

```text
node scripts/verify-migrations.mjs   # 25 migration đúng thứ tự + contract check
node scripts/verify-offchain.mjs     # core schema, full schema, RLS matrix, seed x2, workflows
```

`verify_schema.sql` và `verify_core_schema.sql` trước đây chỉ là text chết (không có runner nào
thực thi). Cả hai đã được viết lại theo schema mới **và** được wire vào harness PGlite, nên giờ
chúng thực sự chạy.

`verify_workflows.sql` bổ sung test cho: reserve pool khi approve, settlement chuyển reserved →
paid đúng một lần, submit vào program đã đóng phải là lỗi phân biệt được, report bắt buộc có
impact, impact của program khác bị từ chối, và sửa scope sau khi đã có report thì scope được
archive chứ không bị xoá.

---

## 9. Delta từ bản cập nhật flow

Bốn thay đổi trong flow doc chạm tới data contract, không chỉ UI.

### 9.1 Asset type bị giới hạn ở MVP

> "MVP UI nhận `smart_contract` hoặc `website` … API target phải reject type chưa được product
> enable thay vì âm thầm tạo asset mà UI không quản lý được."
> — create-program §3

`PRODUCT_ENABLED_ASSET_TYPES` trong `packages/domain` giờ tách khỏi `ASSET_TYPES`. Write schema
(scope, impact, reward tier) dùng `authorableAssetTypeSchema`; read schema vẫn dùng enum đầy đủ
nên dữ liệu cũ và type tương lai vẫn deserialize được. CHECK trong database giữ cả 4 giá trị:
đây là quyết định sản phẩm, không phải data invariant, nên mở rộng sau này không cần migration.

### 9.2 Percentage tier được server tính, không phải guidance text

> "Với tier `percentage`, reviewer phải cung cấp verified `calculationBasisAmount` khi approve
> reward. Backend tính amount từ basis + percentage, áp dụng cap và lưu snapshot … percentage
> không chỉ là guidance text."
> — create-program §3

Đoạn trên là target/historical contract của review flow cũ. Trong settlement contract hiện tại,
reviewer vẫn chỉ validate; owner-only durable intent mới derive amount/recipient/content hash và
reserve atomically. Không dùng `approve_report_reward_atomic` hoặc route `approve-reward` như một
mutation reviewer hiện tại (route HTTP cũ trả `410 Gone`).

Historical RPC contract: `approve_report_reward_atomic` nhận thêm `calculation_basis_amount`:

| Calculation type | Historical reviewer input | Server làm |
| --- | --- | --- |
| `range` / `flat` | `amount` | Bounds-check theo tier |
| `percentage` | `calculationBasisAmount` | `min(basis × bps / 10000, cap)`; `amount` bị bỏ qua |

Thiếu basis trên tier percentage → `reward_basis_required`. Thiếu amount trên tier range/flat →
`reward_amount_required`. Mọi input (basis, bps, cap, min/max/flat, kết quả) được snapshot vào
`report_reviews.metadata` để con số vẫn tái lập được sau khi owner sửa catalog.

Client không được quyết định payout: nếu UI tính sai, server vẫn dùng số của mình.

### 9.3 Report có thêm hai field

> Target submit payload — submit-bug §3

| Field | Cột | Ghi chú |
| --- | --- | --- |
| `secretGistUrl` | `reports.secret_gist_url` | HTTPS-only; không thay thế PoC bắt buộc |
| `severityMismatchAcknowledged` | `reports.severity_mismatch_acknowledged` | Audit signal, không biến proposal thành final severity |

Payload key `selectedImpactIds` đổi thành `programImpactIds` cho khớp contract trong flow.

Cả hai field mới nằm trong canonical payload của `contentHash`: flow định nghĩa hash là "SHA-256
of canonical report payload" và cả hai đều thuộc payload đó.

### 9.4 Reward tier có lịch sử không được xoá

> "Child records đã được report/review tham chiếu phải giữ stable ID … không delete-and-recreate
> scope, impact hoặc reward rows đã có lịch sử."
> — create-program §3

Scope và impact đã archive từ trước. Reward tier giờ cũng có `archived_at`, và unique index
chuyển thành partial (`where archived_at is null`) để severity đó vẫn thêm lại được sau này.
`write_program_children` xoá cứng tier chưa từng định giá approval nào, và archive tier đã có —
xác định bằng report `reward_approved`/`payment_pending`/`paid` khớp `(asset_type, severity)`
của tier.

### 9.5 Metric derived cho Program Detail

PG-DETAIL nói metrics là server-derived. `program.metrics` giờ có `totalAssetsInScope` và
`medianResolutionSeconds`.

`medianResolutionSeconds` được tính khi đọc bằng `program_median_resolution_seconds()`:
median của khoảng cách giữa `submitted_at` và review đầu tiên có `to_status` thuộc
`rejected`/`duplicate`/`validated`. Hai flow Figma giờ định nghĩa đây là **review resolution**:
quyết định đầu tiên về tính hợp lệ của report. Các bước reward approval, payment pending và paid
là settlement riêng và không thay đổi resolution time.

### 9.6 Không cần đổi

- PoC policy "global toàn program trong MVP" — đúng như đã implement, không có override theo
  asset type/severity.
- Composer đổi từ `Scope, Details, Proof, Review` sang `Assets & Impact, Severity, Main Report,
  Review`, và create program vẫn 7 bước: thuần UI/Figma, không chạm API.
- `Program configuration được submit flow tiêu thụ` (submit-bug §3) đã được
  `submit_report_atomic` validate lại trên server.

---

## 10. Còn lại ngoài phạm vi

- ~~Frontend mới dừng ở mức khớp contract~~ — **đã dựng lại toàn bộ trên shadcn + Tailwind theo
  Figma**: component library trong `packages/ui` (26 file), landing, auth, onboarding, create
  program wizard 7 bước, bounty table với infinite scroll + filter popover + mobile vertical row,
  program detail, submit-bug composer 4 bước, report/review surfaces. Xem `PROJECT_CONTEXT.md` §5b.
- `deploy`/`fund`/`pay` hiện ghi nhận transaction do client cung cấp; chưa gọi contract thật.
- `POST /api/reports/:id/triage` chưa có (milestone 3).
- `pnpm --filter @bug-bounty-escrow/database types:check` cần Docker + Supabase CLI nên chưa
  regenerate được `Database` types.
- Chưa có wallet connector, nên CP-10 deploy và CP-11 fund thu `transactionHash` bằng tay. Đúng
  cho off-chain MVP; sẽ thay khi làm milestone 2.
- Ba màn không có thiết kế Figma — reports list, review inbox, review detail — được soạn từ
  component library theo đúng ngôn ngữ đã có, mỗi file ghi chú rõ ở đầu là không có nguồn Figma.
- `POST /api/reports/:id/triage` vẫn chưa có (milestone 3), nên trạng thái `triaged` không đến
  được từ UI dù timeline và action map đã xử lý nó.
