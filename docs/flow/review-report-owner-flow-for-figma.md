# Review Report — Program Owner flow for Figma

## 1. Mục tiêu

Tài liệu này định nghĩa flow để **Program owner review một vulnerability report riêng tư**, từ
inbox tại `/review` tới quyết định human review và reward settlement trên Arc Testnet.

Flow phải giúp owner:

- Chỉ thấy report thuộc program do mình sở hữu.
- Đọc đúng nội dung researcher đã submit, PoC, attachment và private discussion.
- Yêu cầu thêm thông tin mà không đóng report.
- Validate với final severity, reject hoặc đánh dấu duplicate bằng quyết định rõ ràng.
- Sau validation, reserve reward và hoàn tất payout USDC bằng flow Arc bền vững.
- Reload hoặc recover transaction đang dở mà không yêu cầu ký cùng một approval lần thứ hai.
- Nhận biết loading, empty, error, forbidden và terminal states trên desktop lẫn mobile.

AI chỉ là thông tin hỗ trợ. Chỉ human owner/reviewer được quyết định report; chỉ owner được reserve,
ký approval và khởi động reward settlement.

## 2. Phạm vi

### Trong phạm vi

- Owner/reviewer report inbox.
- Private report detail, attachment download, comment thread và audit timeline.
- Các quyết định: request information, validate, reject và mark duplicate.
- Vòng `needs_information` → researcher bổ sung → resubmit → review tiếp.
- Owner-only reward approval cho tier range, flat và percentage.
- Durable Arc reward settlement, recovery và terminal presentation.
- Desktop, tablet và mobile tại 1440 px, 768 px và 390 px.
- Loading, empty, filtered-empty, retry, unavailable và access-denied states.
- Accessibility và test matrix dùng để review Figma/implementation.

### Ngoài phạm vi

- Researcher submit/edit flow; xem `submit-bug-researcher-flow-for-figma.md`.
- Researcher My Reports; xem `my-reports-researcher-flow-for-figma.md`.
- Tạo, deploy hoặc fund program escrow; xem `create-program-owner-flow-for-figma.md`.
- Public disclosure/Known Issues sau khi program end.
- Reviewer invitation/assignment management.
- AI provider implementation hoặc tự động chạy AI khi mở report.
- Mainnet, token khác canonical Arc USDC hoặc payout qua chain khác Arc Testnet.
- Thay đổi smart contract, database, API, code hoặc Figma trong chính task viết flow này.

## 3. Nguồn sự thật và source map

### 3.1 Product và task source

| Nguồn                                             | Vai trò                                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `PROJECT_CONTEXT.md`                              | Vai trò, report lifecycle, privacy, human/AI boundary và Arc settlement nguyên tắc          |
| `docs/tasks/frontend.md`                          | Ticket family `FE-REV-001` đến `FE-REV-009` và frontend guardrails                          |
| `docs/tasks/backend.md`                           | Contract `BE-RPT-001`, `BE-RPT-003`, `BE-RPT-006` đến `BE-RPT-011`, attachment/comment APIs |
| Notion project `06a0ee55892f4852bffd3b871ef4df8d` | Status/dependency của ticket đang thực hiện; phải đọc live trước khi implement              |
| Tài liệu này                                      | Target UX/interaction requirement cho RR-01 đến RR-07                                       |

Notion là nguồn sự thật cho **trạng thái công việc**, không tự thay thế acceptance criteria trong
tài liệu này. Trước khi bắt đầu implementation, agent phải map RR screens vào ticket FE-REV tương
ứng, đọc requirement live và cập nhật ticket nếu requirement cũ còn dùng off-chain `approve/pay`
hoặc không có mobile/recovery. Không suy ra `Done` chỉ từ việc code đã tồn tại.

Mapping dự kiến:

| Flow                         | Ticket liên quan                                                           |
| ---------------------------- | -------------------------------------------------------------------------- |
| Inbox                        | FE-REV-001, BE-RPT-001                                                     |
| Detail, attachment, comments | FE-REV-002, FE-RPT-006/007/008, BE-RPT-003, BE-ATT-002, BE-CMT-001/002     |
| Request information          | FE-REV-004, BE-RPT-006                                                     |
| Validate                     | FE-REV-005, BE-RPT-007                                                     |
| Reject                       | FE-REV-006, BE-RPT-008                                                     |
| Duplicate                    | FE-REV-007, BE-RPT-009                                                     |
| Reward approval/settlement   | FE-REV-008/009, BE-RPT-010/011 và Arc reward-settlement contract hiện hành |

### 3.2 Current code map

| Surface                         | Current implementation                                            |
| ------------------------------- | ----------------------------------------------------------------- |
| Inbox route                     | `apps/web/src/app/review/page.tsx`                                |
| Detail route                    | `apps/web/src/app/review/[id]/page.tsx`                           |
| Shared owner/reviewer shell     | `components/reports/review-shell.tsx`                             |
| Inbox query/filter/list         | `components/reports/review-inbox-view.tsx`                        |
| Detail composition              | `components/reports/review-detail-view.tsx`                       |
| Private report renderer         | `components/reports/report-content.tsx`                           |
| Decision UI                     | `components/reports/review-actions.tsx`                           |
| UI transition map               | `components/reports/review-transitions.ts`                        |
| Private discussion              | `components/reports/comment-thread.tsx`                           |
| Report/read/review API          | `apps/api/src/reports/report.controller.ts`                       |
| Attachment/comment API          | `apps/api/src/reports/collaboration.controller.ts`                |
| Durable reward API              | `apps/api/src/escrow/reward-settlement.controller.ts`             |
| Shared request/response schemas | `packages/shared/src/contracts/report.ts`, `reward-settlement.ts` |

Code hiện tại đã có `/review` và `/review/[id]`, nhưng comment trong source ghi **No Figma source**.
Vì vậy Figma phải mô tả lại flow có hệ thống; không được lấy layout hiện tại làm bằng chứng rằng tất
cả responsive, access, privacy và settlement states đã đạt.

Legacy endpoints `POST /approve-reward`, `/pay` và `/confirm-payment` hiện trả
`reward_settlement_flow_required`. Figma/implementation mới không được gọi hoặc mô tả chúng như
happy path. Reward phải đi qua durable reward-settlement intents.

### 3.3 Figma source map

File:

[Bug Bounty Escrow — Dark Desktop Preview](https://www.figma.com/design/PXhIUlWSb44xjonYNxviCN/Bug-Bounty-Escrow-%E2%80%94-Dark-Desktop-Preview)

| Nguồn      | Mục đích                                                                         |
| ---------- | -------------------------------------------------------------------------------- |
| `106:680`  | Program-owner workspace/sidebar geometry reference                               |
| `106:535`  | Program-owner page composition reference                                         |
| `95:624`   | Program-owner navigation/reference state                                         |
| `272:1882` | Researcher report-detail content/status reference; không copy researcher actions |

Các node trên là visual reference, không phải contract đầy đủ cho review flow. RR-01 đến RR-07 là
frame inventory mới cần đặt trong page Program owner, reuse BBE Design System và semantic layer
names. Sample report IDs, wallet, reward, comments và timestamps chỉ là fixture review.

## 4. Roles, quyền và privacy

### Program owner

- `/review` chỉ trả report thuộc program có `owner_id = auth.uid()`.
- Được request information, validate, reject và mark duplicate ở transition hợp lệ.
- Là role duy nhất được tạo/cancel reward settlement intent, kết nối owner wallet, ký
  `approveReward` và resume/reconcile payout.
- Không được review report của program owner khác dù biết UUID.

### Assigned reviewer

- Chỉ thấy report thuộc program có assignment hiện hành.
- Được thực hiện human review decisions giống owner khi status cho phép.
- Không thấy owner-only program routes, không reserve reward, không connect owner wallet và không
  ký/khởi động settlement.
- Ở report `validated`, panel nói rõ `Waiting for the program owner to approve the reward`.

### Researcher

- Không truy cập `/review`.
- Chỉ đọc report của chính mình ở `/reports/:id`, trả lời comment và resubmit khi
  `needs_information`.
- Không thấy internal reviewer identity/assignment, private review note hoặc settlement control.

### Privacy boundary

- Anonymous phải sign in bằng safe internal `returnTo`; wrong role nhận access-denied state.
- Session/role đang loading phải render full-page loading, không flash report data.
- Server authorization và RLS là boundary; ẩn button phía client không phải authorization.
- Report body, reproduction steps, custom impacts, secret Gist URL, attachment metadata, comments,
  content hash, report UUID và duplicate target không vào analytics, browser console, error tracker,
  notification preview hoặc public cache.
- 403 và 404 dùng cùng safe detail `This report is not available` để tránh enumeration.
- Logout hoặc principal change phải clear/invalidate toàn bộ private query cache.

## 5. Routes và navigation

| Mục đích              | Route                    |
| --------------------- | ------------------------ |
| Review inbox          | `/review`                |
| Private review detail | `/review/:reportId`      |
| Public program detail | `/programs/:programSlug` |
| Owner program list    | `/owner/programs`        |
| Account settings      | `/account/settings`      |

Owner và reviewer dùng chung Review workspace shell để detail rendering không drift. Owner có thêm
`My programs`; assigned reviewer không thấy link này. Active nav luôn là `Review inbox` ở cả inbox
và detail. Breadcrumb detail quay về `/review` và nên giữ query/filter trong return URL hoặc browser
history. Canonical request/cache key luôn dùng full report UUID; UI chỉ được rút gọn 8 ký tự đầu và
copy action phải copy full UUID.

## 6. Lifecycle và action contract

### 6.1 Report state machine

```text
draft
  └─ researcher submit → submitted

submitted | triaged
  ├─ request information → needs_information
  ├─ validate(finalSeverity) → validated
  ├─ reject(reason) → rejected
  └─ mark duplicate(originalReportId, reason?) → duplicate

needs_information
  └─ researcher answers/edits and resubmits → submitted

validated
  └─ owner reward settlement approval confirmed → reward_approved

reward_approved
  └─ payout submitted and verified → payment_pending → paid

rejected | duplicate | paid
  └─ terminal for this review flow
```

`resolvedAt` là human review đầu tiên chuyển sang `validated | rejected | duplicate`; thời gian
reward/payout không thuộc resolution metric. Không tạo status UI mới để biểu diễn modal, wallet
prompt hoặc provider progress.

### 6.2 Action availability

| Status                               | Owner                                                 | Assigned reviewer                     |
| ------------------------------------ | ----------------------------------------------------- | ------------------------------------- |
| `submitted`, `triaged`               | Validate, Request information, Reject, Mark duplicate | Cùng bốn review actions               |
| `needs_information`                  | Comment/view; chờ researcher resubmit                 | Comment/view; chờ researcher resubmit |
| `validated`                          | Approve reward / continue or resume settlement        | Chỉ xem, chờ owner                    |
| `reward_approved`, `payment_pending` | Resume/reconcile settlement khi cần                   | Chỉ xem progress                      |
| `rejected`, `duplicate`, `paid`      | Read-only terminal                                    | Read-only terminal                    |
| `draft`                              | Không xuất hiện trong review inbox                    | Không xuất hiện trong review inbox    |

Mọi mutation phải chặn double-submit, giữ dialog mở khi error, refresh đúng report/inbox query sau
success và xử lý conflict do status đổi ở tab khác bằng server response thay vì overwrite.

## 7. Figma frame inventory

Mỗi RR view cần desktop 1440 px và mobile 390 px. Tablet 768 px có thể dùng component state nếu
không cần frame riêng, nhưng phải được kiểm tra trong prototype.

| ID    | View                       | Bắt buộc                                                                       |
| ----- | -------------------------- | ------------------------------------------------------------------------------ |
| RR-01 | Review inbox               | Desktop + mobile, default/loading/empty/filtered-empty/error                   |
| RR-02 | Submitted/Triaged detail   | Desktop + mobile, private content + decision summary                           |
| RR-03 | Needs information          | Desktop + mobile, request, discussion, resubmitted signal                      |
| RR-04 | Decision dialogs           | Validate, Request information, Reject, Duplicate + validation/error            |
| RR-05 | Validated / approve reward | Range-flat, percentage, reviewer-waiting, reserve error                        |
| RR-06 | Arc settlement             | Awaiting signature, uncertain, submitted/reconciling, failed/replacement, paid |
| RR-07 | Terminal/system states     | Rejected, duplicate, paid, safe unavailable và access denied                   |

## 8. RR-01 — Review inbox

### Header và summary

- Eyebrow `Manual review`, H1 `Report inbox`.
- Copy nói rõ owner chỉ thấy owned programs; reviewer chỉ thấy assigned programs.
- Privacy/audit callout: quyết định được ghi nhận theo account.
- Không hiển thị tổng số private reports ở public header hoặc browser title.

### Filters

- Program, Status, Severity và Reset.
- Filter lưu ở URL; thay filter reset page về 1; back/forward khôi phục state.
- Program options phải đến từ authorized result scope, không từ public programs list.
- Không thêm search nếu API chưa có search contract.
- `Needs action` phải dễ nhận biết bằng text + tone, không chỉ màu.

### Desktop table

| Column   | Nội dung                                                      |
| -------- | ------------------------------------------------------------- |
| Report   | Short UUID + title, không lộ description                      |
| Program  | Authorized program name                                       |
| Severity | `finalSeverity ?? proposedSeverity`, label nói Proposed/Final |
| Status   | Canonical status badge có dot + text                          |
| Reward   | Approved USDC hoặc `—`                                        |
| Updated  | Relative + exact accessible timestamp                         |
| Action   | `Review` → `/review/:reportId`                                |

### Mobile cards

- Không ép table scroll ngang. Dùng card list cùng data contract.
- Thứ tự: report/title → program → status/severity → updated/reward → full-width `Review`.
- Nội dung private dài không xuất hiện trong card.
- Filter chuyển thành compact controls/sheet có label; active count không chỉ biểu diễn bằng icon.
- Load more giữ filter và scroll context; request đang chạy disable action tương ứng.

### States

- Initial loading: skeleton đúng geometry, `aria-live` báo `Loading the inbox…`.
- Account empty: `Inbox clear`; không ám chỉ chưa có report toàn hệ thống.
- Filtered empty: `No reports match these filters` + `Clear filters`.
- First-page error: retry; filter vẫn giữ nguyên.
- Next-page error: giữ các row đã tải, retry không xóa chúng.

## 9. RR-02 — Submitted/Triaged detail

### Header

- Breadcrumb `Review inbox / <short report id>`.
- H1 report title, status badge và Proposed/Final severity badge.
- Program link, submitted time, optional approved reward và Copy full report ID.
- Notice `Private disclosure` luôn nằm trước content.

### Main content

- Affected scope và immutable snapshot của asset.
- Vulnerability description giữ whitespace, wrap text an toàn.
- Claimed program impacts và custom impacts được phân biệt; custom không mượn severity authority.
- PoC/reproduction steps; Secret Gist mở tab mới với `noopener noreferrer`.
- Chỉ attachment status `uploaded` được render.
- Content hash hiển thị đầy đủ để đối chiếu, không dùng làm public identifier.
- Private comments dùng chung giữa researcher và authorized owner/reviewer.

### Decision rail

- Desktop: hai cột; content chính và rail 338 px, rail sticky sau khi header đã qua.
- Rail đầu tiên là `Review decision`, tiếp theo `Where it stands`/timeline.
- `Validate` là primary; request/reject/duplicate là secondary/destructive theo design system.
- Không preselect hay auto-submit quyết định dựa trên AI.

### Mobile

- Một cột. Sau header có compact sticky action summary/status; tap mở/scroll tới decision panel.
- Report content, attachments và discussion đến trước full decision controls để owner đọc bằng chứng.
- Sticky bar không che footer, keyboard hoặc dialog; safe-area inset được tôn trọng.
- Long UUID, address, URL, code/PoC và filename phải wrap/truncate có cách xem/copy đầy đủ.

## 10. RR-03 — Needs information và private discussion

### Request từ reviewer

- Hiển thị latest request với author role, exact time và reason đầy đủ.
- Status `Needs information` dùng warning tone + text; không dùng destructive red.
- Owner/reviewer không còn validate/reject/duplicate trong lúc chờ researcher theo state machine.
- Primary state copy: `Waiting for the researcher to respond`; comment vẫn khả dụng.

### Discussion

- Comment body tối đa 10,000 ký tự, empty/oversize bị chặn.
- Author và time accessible; deleted comment dùng tombstone, không render nội dung cũ.
- Pagination/order ổn định; loading/empty/error và retry riêng, không làm mất report content.
- Mutation đang pending chặn submit trùng; error giữ draft comment.
- Comment không thay thế request-information transition và không tự đổi report status.

### Researcher resubmit

- Researcher bổ sung ở private detail của họ rồi `PATCH ... { resubmit: true }`.
- Server transition report về `submitted`; owner inbox/detail refetch hiển thị action set mới.
- Timeline giữ request và resubmit audit event; `submittedAt` ban đầu không reset.
- Nếu owner đang mở stale `needs_information`, mutation conflict phải refresh, không ghi đè response.

## 11. RR-04 — Decision dialogs

Mọi dialog có title, effect copy, required fields, server-error region, Cancel và explicit confirm.
Focus đi vào dialog, bị trap đúng cách, Escape/Cancel không mutation và đóng xong trả focus về trigger.

### Validate

- Chỉ từ `submitted | triaged`.
- Required `finalSeverity`: critical, high, medium, low hoặc informational.
- Hiển thị proposed severity để so sánh, nhưng human selection mới là final.
- Warning: one-way review transition; **không reserve hoặc chuyển tiền**.
- Confirm `Validate report`; success → `validated` và RR-05.

### Request information

- Chỉ từ `submitted | triaged`.
- Required reason, trim, 1–2,000 ký tự; counter visible.
- Copy nói researcher nhìn thấy reason.
- Confirm → `needs_information`, timeline/comment notification được cập nhật atomically.

### Reject

- Chỉ từ `submitted | triaged`.
- Required reason, trim, 1–2,000 ký tự.
- Destructive tone; nói rõ closed, không reopen/validate/reward từ screen này.
- Không dùng reject như duplicate shortcut.

### Mark duplicate

- Chỉ từ `submitted | triaged`.
- Original report full UUID bắt buộc; optional reason tối đa 2,000 ký tự.
- Target phải tồn tại, cùng program, reviewer có quyền đọc, không self-reference và không tạo cycle.
- UI target cuối cùng nên search/select authorized report theo FE-REV-007; input UUID hiện tại chỉ là
  implementation baseline, không phải trải nghiệm cuối cùng.
- Trước confirm hiển thị target title + short ID để owner đối chiếu; không lộ candidate ngoài quyền.
- Success → `duplicate`, hiển thị linked original; duplicate không nhận reward.

### Error/race behavior

- Client schema error gắn với field; server business error dùng stable safe copy.
- 409/invalid transition: đóng action set cũ sau refetch và nói report đã đổi trạng thái.
- Network timeout không giả định success/failure; refetch report/audit before enabling action again.
- Không optimistic terminal status cho review decisions.

## 12. RR-05 — Validated và owner reward approval

Validation chỉ ghi quyết định human + final severity. Reward là bước riêng và chỉ owner thấy.

### Preflight summary

- Final severity và reward tier áp dụng cho affected asset type.
- Escrow/chain `Arc Testnet`, token `USDC`.
- Available pool, reserved pool, amount/basis và recipient wallet được server derive/verify.
- Connected wallet phải đúng locked owner/admin wallet; account/network mismatch fail closed.
- Reviewer không phải owner chỉ thấy waiting state, không thấy connect/sign controls.

### Range hoặc flat tier

- Owner nhập reward amount dạng decimal string.
- Server kiểm tra tier bounds, remaining pool, canonical USDC decimals và current report status.
- Không parse monetary values qua JavaScript floating point.

### Percentage tier

- Owner nhập `Verified funds at risk` (`calculationBasisAmount`) lớn hơn zero.
- Server derive reward theo snapshotted `percentageBps`, áp `maxRewardCap` và trả computed amount.
- Browser không gửi một amount tự tính để override kết quả.
- Review screen cho owner xem basis, rate, cap và computed amount trước signature.

### Reserve semantics

- Create intent dùng idempotency key UUID v4 và owner wallet.
- Database atomically khóa report/program pool, snapshot content hash/tier/recipient và reserve đúng
  một amount. Retry cùng intent/key không reserve lần hai.
- `Approve reward` không đồng nghĩa `Paid`; chỉ sau exact Arc settlement proof report mới tới paid.
- Intent còn `awaiting_approval` và chắc chắn chưa submit có thể cancel để release reservation sau
  server Arc scan. Có known/uncertain submission thì không cho cancel mù quáng.

## 13. RR-06 — Owner-only durable Arc reward settlement

### 13.1 Nguyên tắc

- Browser owner chỉ ký **một** `approveReward` cho immutable report key/content hash/recipient/amount.
- Sau approval confirmed, Circle developer-controlled wallet gọi permissionless `payReward`.
- Circle API key, Entity Secret và Deployment Wallet ID chỉ ở backend; không xuống browser/Figma
  sample/log.
- Client result, wallet popup đóng, provider status hoặc live balance không phải settlement proof.
- Backend là authority: verify exact Arc Testnet receipt, escrow event, canonical USDC Transfer,
  addresses, report key, amount, log indexes, block number/hash và ledger transition.

### 13.2 UI states

| Durable state                             | UI                                                                         |
| ----------------------------------------- | -------------------------------------------------------------------------- |
| `awaiting_approval`                       | `Continue approval`; owner review immutable amount/recipient rồi mở wallet |
| Wallet user reject trước submission       | Giữ intent/reservation; cho Continue hoặc Cancel sau safe scan             |
| `submission_uncertain`                    | `Resume settlement`; không hiện button ký mới                              |
| Approval `submitted`                      | Hiển thị hash/progress; poll/reconcile, không ký lại                       |
| Approval `confirmed` / `ready_for_payout` | Backend relays payout; owner không ký payout lần hai                       |
| Payout `provider_accepted`/`submitted`    | Circle/Arc progress và explorer link khi có hash                           |
| Deterministic failed attempt              | Safe failure code; replacement attempt liên kết, không tạo reservation mới |
| `paid`                                    | Exact amount/recipient/Arc tx confirmation; terminal success               |

### 13.3 No-double-sign và recovery

- Ngay khi wallet trả tx hash, persist server observation; local recovery chỉ là hỗ trợ.
- Nếu wallet call đã diễn ra nhưng response không chắc broadcast, lưu marker
  `submission_uncertain`; reload chỉ resume/reconcile.
- Bất kỳ approval operation nào ở `submission_uncertain | submitted | confirmed`, hoặc local
  recovery evidence, đều ẩn `Continue approval` và chặn signature thứ hai.
- Optional recovery hash chỉ được attach sau validation; hash không tự chứng minh ownership/success.
- Server scan Arc theo immutable intent before cancel/replacement.
- Deterministic failed payout được tạo linked replacement operation với attempt number/idempotency
  mới; không reopen old operation và không reserve/reapprove cùng report.
- Timeout, reload, provider 5xx hoặc unknown outcome không được coi là deterministic failure.

### 13.4 Paid authority và accounting

Chỉ chuyển `payment_pending → paid` khi worker/server chứng minh cùng một Arc transaction có:

- Success receipt ở Arc Testnet và canonical deployed escrow.
- Exact `RewardPaid`/payout event bind đúng report key, recipient và amount.
- Exact canonical Arc USDC `Transfer` từ escrow tới locked recipient cùng amount.
- Event/log identity, block hash/number và transaction hash chưa được dùng để settle report khác.
- Atomic accounting chuyển `reserved_pool` sang `paid_pool` một lần; retry idempotent.

UI không được cho phép owner bấm `Confirm paid`, nhập arbitrary transaction hash để force paid hoặc
coi Circle provider acceptance là paid.

## 14. RR-07 — Terminal và system states

### Rejected

- Destructive/closed badge, reviewer reason và decision time.
- Không render review/reward actions.
- Private comments/history vẫn đọc được bởi authorized participants.

### Duplicate

- Closed/neutral badge, linked original report short ID/title và optional reason.
- Link chỉ hoạt động nếu current principal được đọc original; nếu quyền mất, render safe unavailable.
- Không hiển thị reward action.

### Paid

- Success badge, exact USDC amount, recipient masked + copy, Arc transaction link/hash và paid time.
- Final severity và review history vẫn giữ.
- Paid không tự public report; disclosure là owner flow riêng sau program end.

### Loading/error/access

- Full detail skeleton trong lúc auth/report loading; không flash protected content.
- Generic unavailable cho 403/404.
- Network/5xx có Retry + Back to inbox, nói rõ report không bị thay đổi.
- Expired signed attachment URL được lấy lại khi user click; không reuse URL persisted.
- Settlement state load error phải disable approval và cho `Retry status check`; không fallback sang
  intent/signature mới.
- Session expired đưa về login với safe returnTo; clear private cache.
- Wrong role render access denied trong shell an toàn, không render report title/content phía sau.

## 15. Attachment, comment và AI boundaries

### Attachments

- Report detail chỉ trả/render row `uploaded`; `pending` không tạo phantom file.
- Download URL chỉ tạo khi click, TTL ngắn (current API: 60 giây), giữ trong local variable đủ cho
  navigation; không state/storage/log/DOM href lâu dài.
- Server verify principal → report → attachment relation trước khi cấp URL.
- Filename/MIME/size là untrusted display data; sanitize, wrap và không auto-preview video/image.
- Không prefetch private attachment hoặc Secret Gist.

### Comments

- Chỉ report researcher, program owner và assigned reviewer hợp lệ được đọc/ghi.
- Comment là private collaboration, không phải public disclosure và không phải hidden system note.
- Author lấy từ token; client không gửi author ID.
- Notification failure không được tạo duplicate comment khi retry.

### AI

- AI triage không tự chạy khi mở inbox/detail.
- Output, nếu có ở phase riêng, chỉ gồm summary/completeness/suggested severity/scope assessment/
  missing information/confidence và luôn có label `AI suggestion`.
- AI không validate, reject, mark duplicate, chọn final severity, reserve reward, ký transaction,
  relay payout hoặc thay đổi report status.
- AI duplicate candidates chỉ search trong reports principal được phép đọc; suggestion không tự
  điền/confirm duplicate target.
- Không gửi toàn bộ video attachment cho AI trong scope này.

## 16. Responsive layout

### 1440 px desktop

- Workspace shell theo owner geometry: header, 240 px rail, main max-width khoảng 1200 px.
- Inbox dùng table; detail dùng `minmax(0, 1fr) + 338 px` decision rail.
- Dialog không vượt viewport; content dài scroll bên trong, footer actions vẫn thấy.

### 768 px tablet

- Sidebar collapse theo design system; navigation vẫn reachable bằng keyboard.
- Inbox có thể chuyển sang card hoặc compact table chỉ khi không gây horizontal overflow.
- Detail một cột; decision summary ngay sau header, full panel sau report evidence.
- Dialog width fluid với page gutter tối thiểu.

### 390 px mobile

- Không horizontal scroll ở page level.
- Gutter/padding theo mobile design tokens; card, badge và long text wrap an toàn.
- Filter, dialogs và attachment action dùng full available width.
- Sticky action summary tôn trọng safe area và không che input/keyboard.
- Primary/secondary/destructive controls không chỉ khác nhau bằng vị trí hoặc màu.

## 17. Accessibility

- Mọi interactive target tối thiểu 44 × 44 px.
- Visible focus ring theo BBE Design System; keyboard order đi theo visual reading order.
- H1 duy nhất; section headings có hierarchy; table có caption và column headers.
- Status/severity/busy/error có text; dot/color chỉ hỗ trợ.
- Filter sheet/dialog có accessible name, focus trap, close semantics và restore focus.
- `aria-live="polite"` cho load count/progress; error cần chú ý dùng `role="alert"` có kiểm soát.
- Wallet/settlement progress không announce lặp theo mỗi poll.
- Relative time có exact datetime trong title/accessible description.
- Icon decorative là `aria-hidden`; icon-only control có accessible label.
- `prefers-reduced-motion` tắt animation không thiết yếu; spinner vẫn có text loading.
- Zoom 200%, font scaling và reflow không mất content/action.

## 18. Acceptance criteria

- [ ] AC-01 — Owner inbox chỉ liệt kê report thuộc owned programs; reviewer chỉ assignments; direct
      UUID access ngoài quyền trả safe unavailable mà không lộ metadata.
- [ ] AC-02 — RR-01 có desktop/mobile, URL-synced filters, loading, empty, filtered-empty, initial
      error và next-page error giữ data cũ.
- [ ] AC-03 — RR-02 render cùng immutable private content contract researcher đã submit, gồm scope,
      impacts, PoC, uploaded attachments, discussion, content hash và audit timeline.
- [ ] AC-04 — RR-04 chỉ cho bốn quyết định ở `submitted | triaged`; required fields, destructive
      warning, double-submit guard, conflict refetch và server error behavior đều được thiết kế.
- [ ] AC-05 — Needs-information giữ report private, lưu reason/audit, chờ researcher resubmit và sau
      resubmit quay đúng action set mà không reset initial submitted timestamp.
- [ ] AC-06 — Duplicate target cùng program, readable, không self/cycle; UI review target trước
      confirm và không lộ candidate ngoài quyền.
- [ ] AC-07 — Validate chỉ ghi final severity; không reserve/payout. Assigned reviewer dừng ở waiting
      state, chỉ owner thấy reward settlement controls.
- [ ] AC-08 — Range/flat amount và percentage basis dùng decimal-safe/server-derived rules; reserve
      pool atomic/idempotent và không gọi legacy approve/pay/confirm endpoints.
- [ ] AC-09 — Owner chỉ ký một approval; uncertain/submitted/confirmed evidence luôn dẫn tới
      resume/reconcile, không mở signature thứ hai.
- [ ] AC-10 — Paid chỉ sau exact Arc escrow + canonical USDC events và atomic ledger update; provider
      acceptance, client result hoặc balance polling không đủ.
- [ ] AC-11 — Attachment URL chỉ lấy on demand, TTL ngắn, không persist/prefetch; report/comment/AI
      privacy boundaries được thể hiện bằng UI copy và test.
- [ ] AC-12 — 390/768/1440 không overflow, targets ≥ 44 px, focus/labels/live regions/reduced motion
      đạt và terminal/loading/error/access states đều có frame hoặc component state reviewable.

## 19. Test matrix

| Nhóm       | Scenario                                       | Expected                                                      |
| ---------- | ---------------------------------------------- | ------------------------------------------------------------- |
| Auth       | Anonymous mở `/review/:id`                     | Login + safe returnTo; không flash private data               |
| Auth       | Researcher/owner khác đoán UUID                | Safe unavailable/access denied; không lộ title/status         |
| Scope      | Owner và assigned reviewer xem inbox           | Mỗi role chỉ thấy đúng owned/assigned program reports         |
| Inbox      | Filter + load more + next-page failure         | Query giữ filters; rows đã tải còn nguyên; retry được         |
| Review     | Validate với từng severity                     | Một atomic transition; final severity đúng; chưa reserve tiền |
| Review     | Request info → comment → researcher resubmit   | needs_information → submitted; audit giữ đủ vòng              |
| Review     | Reject thiếu reason hoặc double click          | Client/server chặn; không duplicate review record             |
| Duplicate  | Self/cross-program/cycle/unauthorized target   | Stable validation/forbidden; current report không đổi         |
| Race       | Hai reviewer quyết định cùng lúc               | Chỉ transition hợp lệ thắng; client thua refetch state        |
| Reward     | Range/flat ngoài tier hoặc pool thiếu          | Không tạo/reserve intent; safe field/business error           |
| Reward     | Percentage basis                               | Server derive amount/cap đúng; client không override amount   |
| Wallet     | Wrong owner wallet/network                     | Fail closed trước signature; không reserve/sign sai account   |
| Recovery   | Wallet reject chắc chắn trước submit           | Continue/cancel theo safe scan; không report paid             |
| Recovery   | Unknown wallet outcome hoặc reload sau tx      | Resume/reconcile only; không prompt approval lần hai          |
| Payout     | Circle accepts nhưng Arc chưa confirmed        | Chưa paid; tiếp tục provider/Arc reconciliation               |
| Payout     | Deterministic payout failure                   | Linked replacement attempt; không reserve/reapprove lại       |
| Payout     | Exact Arc event + USDC Transfer verified       | reward_approved/payment_pending → paid đúng một lần           |
| Attachment | Uploaded/pending/expired URL/forged attachment | Chỉ uploaded; refresh on click; forged relation denied        |
| Privacy    | Analytics/log/error capture                    | Không report body, UUID, Gist, URL, comment, wallet secret    |
| Responsive | 390/768/1440 + 200% zoom                       | Không overflow/che action; keyboard/focus order đúng          |
| A11y       | Screen reader dialog/status/progress           | Label/effect/error rõ; poll không spam announcements          |

## 20. Implementation gates

Không chuyển ticket sang Done trước khi đủ các gate sau:

1. Figma review: RR-01 đến RR-07 có desktop/mobile và design-system variants; owner/reviewer
   distinction, private copy, terminal/system states được duyệt.
2. Requirement review: Notion ticket liên quan được map/update theo durable Arc settlement và
   responsive requirements; status live được xác nhận.
3. Contract review: shared schema/OpenAPI/API/database transition cùng một source of truth; legacy
   off-chain settlement endpoints không được frontend gọi.
4. Security review: authorization/RLS, non-enumeration, private cache clearing, attachment signed URL,
   analytics/log redaction và owner-wallet enforcement có automated evidence.
5. State-machine review: invalid/racing/retry/uncertain/replacement paths có integration tests và
   không double decision, reserve, approval signature hoặc payout.
6. Arc settlement review: exact receipt/event/token/address/amount/accounting proofs có unit,
   integration và contract tests; provider result không là authority.
7. Responsive/a11y review: visual QA tại 390/768/1440 và 200% zoom; keyboard, screen reader,
   reduced-motion và 44 px targets đạt.
8. Quality gate: lint, typecheck, unit/integration/E2E, production build và migration verification
   pass trên clean checkout; reviewer độc lập đối chiếu acceptance criteria trước cập nhật Notion.

Live Arc QA cần public owner wallet ID/address, manual wallet signatures và testnet funds. Không yêu
cầu hoặc ghi vào ticket/chat private key, seed phrase, Circle Entity Secret, API secret hay recovery
file.
