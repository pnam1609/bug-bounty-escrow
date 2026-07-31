# API contracts

Tài liệu này ghi lại contract của các public API đã được chốt. Theo `docs/tasks/README.md`,
task nào thay đổi public API phải cập nhật file này trong chính task đó. Nguồn sự thật ở cấp
code là các Zod schema trong `packages/shared/src/contracts/`; tài liệu mô tả hành vi đã cam
kết, không thay thế schema.

Envelope chung:

- Thành công: `{ "success": true, "data": ... }` (list có thêm `metadata` phân trang).
- Thất bại: `{ "success": false, "error": { "code", "message", "details?" }, "correlationId" }`.
- `error.code` là mã máy đọc được ổn định để client rẽ nhánh; `message` không mang dữ liệu nhạy cảm.

---

## GET /api/programs — public bounty discovery (BT-03)

Public, không cần bearer token. Repository luôn áp `public_status is not null`; query tùy biến
không thể làm lộ program `draft`, `awaiting_funding` hoặc `paused`. Khi không chọn `status`, response
gồm cả `active` và ended (`expired`/`closed`), với active luôn đứng trước ended.

### Query — `programListQuerySchema`

| Field           | Giá trị                                                     | Default / semantics                                                            |
| --------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `page`, `limit` | positive integer; `limit ≤ 100`                             | `1`, `20`                                                                      |
| `search`        | chuỗi trim, ≤ 120                                           | tìm literal theo tên; wildcard/filter grammar được escape                      |
| `status`        | repeatable/CSV `active\|ended`                              | cả hai                                                                         |
| `assetType`     | repeatable/CSV `smart_contract\|website\|api\|mobile`       | overlap với asset in-scope                                                     |
| `severity`      | repeatable/CSV `critical\|high\|medium\|low\|informational` | overlap với severity có reward tier                                            |
| `minMaxReward`  | monetary string canonical, không âm                         | `max_bounty >= value`                                                          |
| `closing`       | `7d\|30d\|ongoing`                                          | `7d/30d` chỉ nhận deadline từ hiện tại tới horizon; `ongoing` là deadline null |
| `funded`        | `true\|false\|1\|0`                                         | chỉ `true` áp `available_pool > 0`                                             |
| `sort`          | `newest\|name\|deadline\|maxBounty\|totalPaid`              | `newest`                                                                       |
| `sortDirection` | `asc\|desc`                                                 | default theo column                                                            |

Các field filter dạng list nhận cả query lặp (`?assetType=website&assetType=api`) và CSV. Một
known query value không hợp lệ fallback về default/không áp filter thay vì trả 400 hoặc 500; một
list trộn valid + invalid bị bỏ cả filter để URL không tạo kết quả partial khó đoán. Query key lạ
vẫn bị `400 validation_error`.

### Sort privacy

`totalPaid` chỉ sort theo generated key `public_paid_pool`, key này bằng `paid_pool` khi visibility
là `public` và `null` khi `private`. Null luôn xếp cuối trong từng lifecycle group; mọi private row
tie-break bằng `id`, nên hidden payout không ảnh hưởng thứ tự quan sát được. Serializer đồng thời
trả `totalPaid: null` và `paidReportCount: null` cho private programs.

---

## POST /api/programs — tạo bug bounty program (CP-02)

Tạo một program mới ở trạng thái **draft, private**. Contract này theo
`docs/flow/create-program-owner-flow-for-figma.md` §3 (Target data contract) — tài liệu flow có
độ ưu tiên cao hơn khi hai bên khác nhau.

### Quyền truy cập

- Bearer JWT (Supabase). Thiếu/hết hạn: `401 unauthorized`.
- Chỉ account role `owner`; role khác nhận `403 forbidden` từ roles guard. RPC kiểm tra lại
  lần nữa (`owner_role_required`) nên bypass tầng HTTP cũng không tạo được.

### Request body — `createProgramRequestSchema`

Schema `strict()`: mọi field lạ đều bị từ chối `400 validation_error`, kể cả các field
platform-owned (`totalPaid`, `medianResolutionTime`, researcher quota, wallet, platform
acknowledgment, `status`, `totalPool`, `remainingPool`, `contractAddress`). Không tồn tại field
KYC hoặc Known Issues.

| Nhóm | Field | Ràng buộc |
| --- | --- | --- |
| Identity | `name` | trim, 1–200 ký tự |
| | `slug` | 1–120, `^[a-z0-9]+(?:-[a-z0-9]+)*$`, unique toàn hệ thống |
| | `shortSummary` | trim, 1–280 |
| | `description` | trim, 1–20,000 |
| | `websiteUrl` | HTTPS URL hợp lệ (bắt buộc) |
| | `logoStoragePath` | optional, object key hợp lệ từ endpoint upload logo |
| | `tags` | 1–10 tag, mỗi tag ≤ 40 ký tự; unique theo normalized tag |
| | `deadline` | optional; ISO date-time và phải ở tương lai |
| Resources | `resources[]` | 0–20; `resourceType` ∈ `documentation\|repository\|audit\|website\|other`, `title` 1–120, `url` HTTPS, `sortOrder` ≥ 0 |
| Scopes | `scopes[]` | 1–50, ít nhất 1 item in-scope; `assetType` chỉ nhận `smart_contract`\|`website` (`api`, `mobile` là enum-only, bị reject); `assetName` ≤ 200; `assetUrl` URL hợp lệ; `contractAddress` EVM address; `isInScope` mặc định `true`; `description` ≤ 2,000 |
| Impacts | `impacts[]` | mỗi asset type có in-scope asset phải có ≥ 1 impact `enabled`; `severity` ∈ `critical..informational`; `title` 1–300, không trùng normalized title trong cùng asset type; `source` `template`\|`custom` (`template` bắt buộc kèm `templateKey`, impact template được COPY thành row program-owned, không reference); asset type phải có scope entry trong payload |
| Reward tiers | `rewardTiers[]` | mỗi asset type có in-scope asset phải có ≥ 1 tier; unique theo `(assetType, severity)`; `calculationType`: `range` cần `minReward ≤ maxReward`, `flat` cần `flatAmount > 0`, `percentage` cần `percentageBps` 1–10,000 và `maxRewardCap > 0`; field ngoài shape của calculation type bị reject; asset type phải có scope entry trong payload |
| Rules | `rules.pocPolicy` | `required`\|`optional`, mặc định `required` |
| | `rules.pocPolicyNote` | optional, ≤ 2,000 |
| | `rules.rewardPolicy` | bắt buộc, markdown 1–20,000 |
| | `rules.prohibitedActivities` | 0–20 custom rule (mỗi rule ≤ 1,000); platform defaults luôn được server snapshot thêm vào, client không gửi |
| | `rules.testingRestrictions` | optional, ≤ 10,000 |
| | `rules.submissionAcknowledgment` | optional, ≤ 1,000 |
| | `rules.allowCustomImpact` | boolean, mặc định `true` |

### Giá trị server tự đặt

Client không gửi và không thể ép các giá trị sau:

- `status = draft`; program chưa public cho researcher tới khi deploy, fund và publish xong.
- `totalPool = 0`, `reservedPool = 0`, `remainingPool = 0`.
- Chưa có `contractAddress`, chưa có `publishedAt`.
- 5 platform prohibited-activity defaults được snapshot vào program (custom rules xếp sau).

### Response

`201` với `programResponseSchema`: `{ success: true, data: Program }` — program detail đầy đủ
(identity, `scopes`, `impacts`, `rewardTiers`, `resources`, `rules` gồm prohibited activities
default + custom, `metrics`). Read model dùng full `ASSET_TYPES` nên row `api`/`mobile` cũ (nếu
có) vẫn deserialize được; chỉ chiều ghi bị giới hạn.

### Error contract

Business rule được enforce trong PostgreSQL RPC `create_program_atomic` /
`write_program_children` (SECURITY DEFINER) và raise kèm mã máy đọc được; API map mã đó thẳng
vào `error.code`.

| HTTP | `error.code` | Khi nào |
| --- | --- | --- |
| 400 | `validation_error` | Zod reject; `details.fields[]` liệt kê path + message từng field |
| 401 | `unauthorized` | thiếu hoặc sai JWT |
| 403 | `forbidden` | role không phải `owner` (roles guard) |
| 403 | `owner_role_required` | RPC double-check role trong database |
| 409 | `deadline_not_in_future` | deadline ≤ thời điểm tạo |
| 409 | `asset_type_not_enabled` | scope/impact/tier dùng `api` hoặc `mobile` |
| 409 | `impact_coverage_missing` | asset type có in-scope asset nhưng không có enabled impact |
| 409 | `reward_tier_coverage_missing` | asset type có in-scope asset nhưng không có reward tier |
| 409 | `reward_tier_duplicate` | payload lặp `(assetType, severity)` |
| 409 | `impact_title_duplicate` | payload lặp normalized impact title trong cùng asset type |
| 409 | `impact_asset_type_not_in_scope` | impact trỏ tới asset type không có scope entry |
| 409 | `reward_tier_asset_type_not_in_scope` | tier trỏ tới asset type không có scope entry |
| 409 | `database_unique_violation` | trùng unique constraint, điển hình là `slug` đã tồn tại |

Ghi chú cho client: các mã 409 ở trên (trừ `database_unique_violation`) cũng được Zod chặn từ
phía form; nếu tới được server nghĩa là client bỏ qua validation hoặc contract lệch — hiển thị
save-error state và giữ nguyên payload để retry (CP-07).

---

## GET /api/programs/:slug — canonical program detail (SR-01)

Public program URL và public detail lookup dùng slug:

```text
/programs/aegis-protocol
GET /api/programs/aegis-protocol
```

- Path param dùng canonical lowercase kebab-case, 1–120 ký tự. Path không được silently trim;
  non-canonical input trả `400 validation_error`.
- Repository luôn query `programs.slug`; không fallback sang `programs.id`. Một chuỗi trông giống
  UUID nhưng không tồn tại dưới dạng slug vì vậy trả `404`.
- Anonymous chỉ đọc program có `public_status` khác null. Owner và assigned reviewer có thể đọc
  non-public program theo policy hiện hành; unknown và unauthorized đều trả `404` để không tạo
  enumeration oracle.
- `programs_slug_key` enforce unique toàn hệ thống. Trigger `programs_slug_immutable` chặn đổi slug
  sau create bằng detail code `program_slug_immutable`.
- Duplicate slug lúc create tiếp tục map `23505` thành stable `409 database_unique_violation`.

Owner editor đọc bằng protected `GET /api/owner/programs/:id`. PATCH/deploy/fund/publish/status,
report submission, foreign key và authorization nội bộ tiếp tục dùng UUID; không đổi chúng sang
slug.

Report composer canonical là `/reports/new?programSlug=:slug`: client GET detail bằng slug, sau đó
dùng `data.id` server trả về cho `POST /api/programs/:id/reports`.

---

## GET /api/reports/summary — researcher report metrics (MR-01)

Trả một snapshot aggregate trên **toàn bộ** report mà researcher hiện tại sở hữu; kết quả không
phụ thuộc pagination hoặc filter của `GET /api/reports`.

### Quyền truy cập và privacy

- Bearer JWT hợp lệ; thiếu/hết hạn nhận `401 unauthorized`.
- Chỉ role `researcher`; role khác nhận `403 forbidden`.
- Principal lấy từ session đã verify. Endpoint không nhận `researcherId` từ query hoặc body.
- RPC chỉ cấp `EXECUTE` cho `service_role`, xác nhận profile vẫn là researcher và luôn lọc
  `reports.researcher_id = principal.userId`.

### Response — `researcherReportSummaryResponseSchema`

```json
{
  "success": true,
  "data": {
    "allReports": 12,
    "needsInformation": 2,
    "underReview": 5,
    "rewardsPaid": "48500.000000",
    "paymentToken": "USDC",
    "calculatedAt": "2026-07-27T10:00:00.000Z"
  }
}
```

- `allReports`: count mọi status.
- `needsInformation`: count `status = needs_information`.
- `underReview`: count `status in (submitted, triaged)`.
- `rewardsPaid`: `SUM(approved_reward)` chỉ với `status = paid`; PostgreSQL tính bằng `numeric`
  rồi serialize thẳng thành decimal string, không đi qua JavaScript floating point.
- `paymentToken` cố định là `USDC`.
- `calculatedAt` là ISO date-time lúc API tạo response.

Aggregate chạy trong một query và dùng index `reports_researcher_status_submitted_at_idx`. Client
có thể cache ngắn theo query key `['reports', 'summary']`; mọi mutation report invalidate prefix
`['reports']`, bao gồm cả list và summary.

---

## GET /api/reports/filter-options/programs — program filter options (MR-02)

Trả toàn bộ program được đại diện trong dataset report riêng của researcher hiện tại. Endpoint
không phân trang và không suy ra option từ page hiện tại của `GET /api/reports`.

### Quyền truy cập và privacy

- Bearer JWT hợp lệ; thiếu/hết hạn nhận `401 unauthorized`.
- Chỉ role `researcher`; role khác nhận `403 forbidden`.
- Principal lấy từ session đã verify. Endpoint không nhận `researcherId` từ query hoặc body.
- Database read model lọc `reports.researcher_id = principal.userId` trước khi group, nên không trả
  program mà researcher chưa từng có report.
- RPC chỉ cấp quyền `service_role`; database xác nhận actor vẫn có profile researcher.

### Response — `reportProgramFilterOptionsResponseSchema`

```json
{
  "success": true,
  "data": [
    {
      "id": "10000000-0000-4000-8000-000000000001",
      "name": "Aegis Protocol",
      "slug": "aegis-protocol",
      "reportCount": 3
    }
  ]
}
```

Mỗi option tuân theo `ReportProgramFilterOption`:

- `id`: program UUID, dùng làm `programId` trong list filter.
- `name`: label hiển thị.
- `slug`: slug server lưu.
- `reportCount`: tổng report của researcher hiện tại trong program đó, trên toàn dataset và mọi
  status.

Danh sách distinct được sắp xếp ổn định theo tên không phân biệt hoa thường, sau đó tên gốc và
program UUID. Researcher chưa có report nhận `200 { success: true, data: [] }`.

---

## Report reference presentation — short UUID (MR-03)

Canonical report identifier vẫn là UUID bất biến trong field `id`; API và database không thêm
`referenceCode` hoặc `displayId`. UI được phép hiển thị 8 ký tự đầu của UUID kèm dấu ellipsis,
nhưng đây chỉ là presentation:

- Accessible name của mọi short UUID phải chứa full UUID, và copy action luôn copy full UUID.
- URL, API request, cache key và đối chiếu report luôn dùng full UUID.
- Client không được sinh mã `BBE-YYYY-NNNN`, không suy ra sequence từ pagination và không coi short
  UUID là unique identifier.
- Analytics không được nhận full UUID, short UUID hay bất kỳ report reference nào; event chỉ dùng
  các enum/filter/page/result-count đã cho phép trong flow My Reports.

Chọn hướng này vì UUID server-issued đã là canonical contract, không cần migration/rollback, không
tạo một namespace identifier thứ hai, và không công khai sequence có thể làm lộ volume report hoặc
hỗ trợ enumeration. Copy Figma `BBE-2026-0142` vì vậy được reconcile thành short UUID trước QA.

---

## GET /api/rewards — researcher reward activity (RW-02)

Read model phân trang dành riêng cho authenticated researcher. Server lấy actor từ session; query
chỉ nhận `page`, `limit` và optional `status = reward_approved|payment_pending|paid`.
`researcherId` và mọi query key lạ bị `400 validation_error`.

Mỗi `ResearcherRewardSummary` chỉ gồm:

- `reportId`, `programId`, `programName`, `reportTitle`, `finalSeverity`.
- `status`, `approvedReward`, `submittedAt`, `rewardApprovedAt`, optional `paidAt`.
- Optional `payment`: `chainId` dạng decimal string, `tokenAddress`, `transactionHash`,
  `status = pending|confirmed|failed`, optional `confirmations`, optional `confirmedAt`.

`approvedReward` đi từ PostgreSQL `numeric` sang decimal string, không qua JavaScript floating
point. `paidAt` bắt buộc khi `status = paid`. Payment chỉ được tạo từ payout transaction thật có
`report_id` trùng report researcher sở hữu; `reverted|timeout` được project thành `failed`.

Database RPC `researcher_rewards`:

- Double-check profile role `researcher`.
- Lọc `reports.researcher_id = principal.userId` trước pagination.
- Chỉ được `service_role` execute.
- Không trả description, reproduction steps, impact, attachment, comment hoặc private report body.

`GET /api/programs/:id/transactions` và `GET /api/transactions/:hash` vẫn là program-side endpoint,
được gate `owner|reviewer` và tiếp tục kiểm tra owner/assignment theo program. Researcher đọc payout
của mình qua `/api/rewards`, không probe transaction của report khác.

### Reward settlement mutations — owner-only durable flow

Các route legacy `POST /api/reports/:id/approve-reward`, `POST /api/reports/:id/pay` và
`POST /api/reports/:id/confirm-payment` không còn là settlement API; chúng trả `410 Gone` với
`error.code = reward_settlement_flow_required`. Reviewer vẫn có thể validate/reject/request
information/mark duplicate theo review flow, nhưng không được reserve reward hoặc ký approval.

Settlement dùng các route durable `POST /api/reports/:id/reward-settlement-intents` và các
`current`, `approval-observations`, `reconcile`, `cancel` subroutes. Toàn bộ mutation này là
`owner`-only: server kiểm tra program ownership, derive amount/recipient/content hash, reserve
atomically/idempotently, rồi chỉ owner browser wallet mới ký `approveReward`. Sau owner approval,
`payReward` execution có thể permissionless; việc thực thi không cấp thêm quyền reserve/sign cho
reviewer hay relayer. AI triage rows chỉ là advisory/persisted evidence và không tự gọi settlement.

---

## GET/PUT /api/rewards/payout-wallet — payout destination (RW-04)

Dedicated contract dành cho authenticated researcher; `PATCH /api/me` không nhận wallet. Server
lấy actor từ session và chỉ nhận body strict `{ address, confirmActiveRewardChange? }`. Address phải
là EVM address khác zero address, được normalize lowercase; mọi identity override, private key,
seed phrase, signature, connected-wallet field hoặc field lạ bị reject.

Response cố định `network = Arc`, `token = USDC`; summary UI chỉ hiện `maskedAddress`, còn full
`address` chỉ cấp cho thao tác Copy rõ ràng. Wallet chỉ có thể set/change khi researcher có report
`reward_approved` hoặc `payment_pending`. Đổi một wallet đã lưu trong trạng thái đó cần confirmation
rõ ràng; server trả stable conflict `wallet_change_confirmation_required` nếu UI state bị race.

Database RPC khóa profile và toàn bộ report set của researcher trước khi kiểm tra lifecycle, nên
wallet write serialize với approve/start/confirm payment. Write và redacted audit event nằm trong
cùng transaction; retry cùng address không update timestamp và không tạo audit mới. Audit metadata
không chứa wallet address. Cả read/write RPC chỉ cấp execute cho `service_role`.
