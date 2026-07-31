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
- Kết quả AI review đã được tự động tạo từ lần submit/resubmit hiện hành, persist theo report revision
  và content hash, rồi hiển thị read-only như thông tin tư vấn cho human reviewer.
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
- UI/implementation chi tiết của submit/resubmit; flow đó chịu trách nhiệm atomically ghi nhận lần
  gửi và queue AI job tương ứng.
- AI provider, prompt orchestration, worker retry hoặc queue implementation. Inbox/detail chỉ đọc
  trạng thái và kết quả đã persist; mở screen không khởi chạy AI.
- Bất kỳ owner/reviewer control nào để Generate, Regenerate hoặc Retry AI review.
- Mainnet, token khác canonical Arc USDC hoặc payout qua chain khác Arc Testnet.
- Thay đổi smart contract, database, API hoặc application code trong chính task viết flow này.

## 3. Nguồn sự thật và source map

### 3.1 Product và task source

| Nguồn                                             | Vai trò                                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `PROJECT_CONTEXT.md`                              | Vai trò, report lifecycle, privacy, human/AI boundary và Arc settlement nguyên tắc          |
| `docs/tasks/frontend.md`                          | Ticket family `FE-REV-001` đến `FE-REV-009` và frontend guardrails                          |
| `docs/tasks/backend.md`                           | Contract `BE-RPT-001`, `BE-RPT-003`, `BE-RPT-006` đến `BE-RPT-011`, attachment/comment APIs |
| Notion project `06a0ee55892f4852bffd3b871ef4df8d` | Status/dependency của ticket đang thực hiện; phải đọc live trước khi implement              |
| Tài liệu này                                      | Target UX/interaction requirement cho RR-01 đến RR-08                                       |

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
| Persisted AI review          | Ticket AI review tương ứng phải được map từ Notion live; không suy đoán ID |

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

Current review UI chưa phải bằng chứng cho persisted AI review của revision hiện hành. Target flow
phải đọc AI run/result từ backend; không gọi AI provider từ inbox/detail và không suy ra result mới
chỉ vì owner/reviewer mở hoặc reload screen.

Legacy endpoints `POST /approve-reward`, `/pay` và `/confirm-payment` hiện trả
`reward_settlement_flow_required`. Figma/implementation mới không được gọi hoặc mô tả chúng như
happy path. Reward phải đi qua durable reward-settlement intents.

### 3.3 Figma source map

File:

[Bug Bounty Escrow — Dark Desktop Preview](https://www.figma.com/design/PXhIUlWSb44xjonYNxviCN/Bug-Bounty-Escrow-%E2%80%94-Dark-Desktop-Preview)

| Nguồn                             | Mục đích                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------- |
| `462:252`                         | Canonical target page `Review report`; không tạo page hoặc Figma file mới       |
| `462:253`                         | Canonical target section `RR · Owner review report flow` cho RR-01 đến RR-08    |
| `518:252`, `518:5068`, `518:5093` | RR-02 inline AI result tại desktop/tablet/mobile; không có `View AI review` CTA |
| `543:489`                         | Supporting reference: external AI state badge mapping; không phải runtime route |
| `106:680`                         | Program-owner workspace/sidebar geometry reference only                         |
| `106:535`                         | Program-owner page composition reference only                                   |
| `95:624`                          | Program-owner navigation/reference state only                                   |
| `272:1882`                        | Researcher report-detail visual reference only; không copy researcher actions   |

RR-01 đến RR-08 phải được đặt trong page `Review report` node `462:252`, section
`RR · Owner review report flow` node `462:253`, reuse BBE Design System và semantic layer names.
Các Program owner/Researcher node cũ chỉ là visual reference, không phải target hay contract đầy đủ.
Sample report IDs, wallet, reward, comments và timestamps chỉ là fixture review.

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
  content hash, report UUID, duplicate target và AI input/result không vào analytics, browser
  console, error tracker, notification preview hoặc public cache.
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

Mỗi successful submit và resubmit đồng thời ghi nhận submission revision/content hash hiện hành và
queue đúng một AI review job bằng transaction/outbox semantics. AI run được bind bằng `reportId` +
submission revision + source content hash; completed structured result được persist trước khi trở
thành `Ready` trên review UI. Queue/run/result không tạo report status mới và không được tự chuyển
report qua bất kỳ review hoặc settlement transition nào.

Happy path khi owner/reviewer mở detail là AI result của revision hiện hành đã `completed` và được
persist. `queued | running | failed` chỉ là trạng thái của AI run, độc lập với report lifecycle;
AI result luôn là optional/advisory input và human review tiếp tục được khi AI đang xử lý hoặc không
khả dụng.

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
| RR-08 | Persisted AI review        | Current revision result + processing/unavailable/stale/access-safe states      |

## 8. RR-01 — Review inbox

### Header và summary

- Eyebrow `Manual review`, H1 `Report inbox`.
- Copy nói rõ owner chỉ thấy owned programs; reviewer chỉ thấy assigned programs.
- Privacy/audit callout: quyết định được ghi nhận theo account.
- Không hiển thị tổng số private reports ở public header hoặc browser title.
- Có thể hiển thị indicator read-only `AI review: Ready | Processing | Unavailable`; indicator chỉ
  phản ánh persisted run hiện hành, không phải report decision/status.
- Không thêm AI action hoặc AI filter khi chưa có API contract tương ứng. Không có Generate,
  Regenerate hoặc Retry AI control trên inbox.

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

### Persisted AI summary

- Sau report evidence và audit context, trước full human decision controls, hiển thị summary của AI
  result đã persist và khớp current submission revision/content hash.
- Summary và inline result luôn mang label `AI suggestion`; không có action `View full AI review` và
  không mở AI result trong panel/dialog riêng.
- AI output không prefill final severity, duplicate target, decision form hoặc reward field. Human
  reviewer phải tự chọn và confirm mọi quyết định.
- Nếu result chưa current/valid/available, dùng safe state của RR-08 và vẫn để human decision
  controls khả dụng theo report status.

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
- Cùng resubmit transaction/outbox path tự động queue một AI run mới cho revision/content hash mới.
- AI result của revision trước chuyển thành `superseded`; không được render như current suggestion,
  kể cả khi run mới còn queued/running/failed.
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

## 15. RR-08 — Persisted AI review

### 15.1 Trigger và per-program serialization

- Mỗi successful submit/resubmit atomically persist immutable submission revision/content hash,
  allocate monotonic `programSubmissionSequence` và enqueue đúng một AI run. Unique key tối thiểu là
  `(reportId, submissionRevision, contentHash)`.
- Queue/outbox phải durable trong PostgreSQL. Không dùng process-memory queue vì nhiều API/worker
  replica có thể nhận hai report cùng lúc.
- Worker concurrency là `1` trên mỗi `programId` và FIFO theo `programSubmissionSequence`; các program
  khác có thể chạy song song. Job sequence `N` chỉ duplicate-check với report cùng program có sequence
  `< N`.
- Hai report giống nhau submit đồng thời vào cùng program phải nhận sequence khác nhau. Job sau chỉ
  được claim khi job trước completed hoặc terminal, nên report sau không thể bỏ qua report trước do
  race.
- Retry/double-click/reload không enqueue thêm run. Transient provider errors retry bounded với
  backoff/jitter; terminal failure giải phóng queue để job tiếp theo chạy và không chặn human review.
- Submit API không giữ HTTP request vô hạn để chờ Gemini. UI mở report detail ngay với
  `AI review: Processing`, rồi polling/realtime đọc result đã persist. Khi queue/quota khỏe, worker bắt
  đầu ngay sau commit; không hứa một latency cố định mà free tier không bảo đảm.

Duplicate pipeline là hai AI pass xen giữa một BE retrieval pass:

1. AI pass 1 đọc current report và tạo validated semantic fingerprint gồm affected components,
   functions, attack vector, vulnerability classes, prerequisites, security impacts và normalized
   summary. Fingerprint không lấy scope/impact researcher chọn làm authority.
2. BE persist fingerprint rồi union candidate signals trên mọi prior sequence cùng program: exact
   content hash, contract/function/endpoint identifiers, normalized full-text/trigram similarity,
   affected component, vulnerability class và attack vector. Scope/impact chỉ tăng ranking score,
   không được hard-filter; metadata cố tình sai vẫn có thể match nội dung thực.
3. AI pass 2 nhận current fingerprint/report và bounded top candidates để trả
   `duplicateAssessment = none | possible | likely`, confidence và bounded matching reasons.
4. Không gửi future sequence hoặc report thuộc program khác. Owner/reviewer candidate references được
   re-authorize lúc đọc; researcher chỉ thấy safe aggregate assessment, không thấy report
   ID/title/author/private excerpt của người khác.
5. AI không tự mark duplicate; RR-04 human duplicate dialog vẫn là transition authority duy nhất.

### 15.2 Data và provenance

- AI run status dùng `queued | running | completed | failed` hoặc equivalent stable server enum.
- Completed result gồm structured summary, completeness, suggested severity, scope assessment,
  missing information, confidence và authorized duplicate candidates nếu feature này được bật.
- Mỗi run/result ghi `reportId`, source submission revision, source content hash, `generatedAt` và
  `persistedAt`. UI chỉ coi result là current khi cả revision và hash khớp report đang đọc.
- Prior result được giữ cho audit nhưng mang `superseded`; không dùng làm current summary hoặc
  fallback khi revision mới chưa completed.
- Persist thêm `programId`, `programSubmissionSequence`, `provider`, exact `model`, `schemaVersion`,
  `attemptCount`, `startedAt`, terminal status/error code, `fingerprintSchemaVersion`,
  `candidateRetrievalVersion` và `comparisonSchemaVersion`. Persist validated fingerprint và result,
  nhưng không persist raw prompt hoặc raw provider response.

### 15.2a AI request contract

AI worker tách request thành **internal job envelope** và **provider-safe report snapshot**. Envelope dùng
để idempotency/authorization ở backend; snapshot mới là dữ liệu được gửi cho model.

```json
{
  "job": {
    "reportId": "internal-only",
    "programId": "internal-only",
    "submissionRevision": 8,
    "contentHash": "sha256:...",
    "programSubmissionSequence": 42,
    "idempotencyKey": "reportId:8:sha256:...",
    "promptVersion": "review-v1",
    "schemaVersion": "ai-review-v1",
    "model": "gemini-3.5-flash"
  },
  "report": {
    "title": "...",
    "affectedAsset": "...",
    "policyAndScope": "...",
    "description": "...",
    "reproductionSteps": ["..."],
    "expectedBehavior": "...",
    "actualBehavior": "...",
    "impact": "...",
    "researcherSeverity": "high"
  },
  "programRules": {
    "severityRubric": "...",
    "duplicatePolicy": "..."
  },
  "duplicateContext": {
    "priorSameProgramCandidates": [
      { "candidateRef": "opaque-ref", "sequence": 17, "fingerprint": "...", "boundedReasons": ["..."] }
    ]
  }
}
```

Request requirements:

- Snapshot phải lấy từ immutable current submission revision; không đọc lại mutable draft trong lúc worker
  chạy. `contentHash` và revision phải được kiểm tra trước khi claim job.
- `duplicateContext` chỉ gồm candidate cùng `programId` có sequence nhỏ hơn current sequence; candidate
  reference là opaque và được re-authorize ở read time.
- Có thể gửi policy/scope/severity rubric và report evidence đã sanitize; không gửi researcher identity,
  owner/reviewer identity, private comments không cần cho analysis, reward/wallet data hoặc decision history.
- Không gửi attachment binary, video, private Gist URL, signed URL, storage key, access token, API key,
  seed/private key, raw database row, report UUID của người khác hoặc provider metadata không cần thiết.
- Request phải bounded về độ dài field, số bước, số candidate và prompt variables; HTML/script/URL nhạy cảm
  phải được redact hoặc canonicalize trước khi gọi provider.
- Free/demo provider chỉ nhận synthetic data theo policy; private production report phải fail closed nếu
  provider mode/privacy acknowledgement không hợp lệ.

### 15.2b AI response contract

Provider chỉ được trả structured JSON theo schema versioned; backend validate bằng Zod (hoặc validator
tương đương) trước khi persist. Response hợp lệ là advisory, không phải transition command.

```json
{
  "schemaVersion": "ai-review-v1",
  "summary": "...",
  "completeness": {
    "score": 0.78,
    "checks": [
      { "key": "title_and_affected_component", "status": "present", "reason": "..." },
      { "key": "reproduction_steps", "status": "present", "reason": "..." },
      { "key": "expected_vs_actual", "status": "missing", "reason": "..." }
    ]
  },
  "suggestedSeverity": {
    "level": "high",
    "confidence": 0.82,
    "rationale": "..."
  },
  "scopeAssessment": {
    "result": "in_scope",
    "confidence": 0.76,
    "rationale": "..."
  },
  "missingInformation": ["..."],
  "duplicateAssessment": {
    "assessment": "possible",
    "confidence": 0.71,
    "matchingReasons": ["..."],
    "candidates": [
      { "candidateRef": "opaque-ref", "assessment": "possible", "confidence": 0.71, "reasons": ["..."] }
    ]
  }
}
```

Response requirements:

- `summary`, completeness checks, severity/scope suggestions, missing information và duplicate assessment
  đều có bounded length/count; confidence nằm trong `[0,1]`; enum ngoài allowlist là invalid.
- `candidateRef` chỉ là reference để backend re-authorize; AI không được trả private title, author,
  report UUID, excerpt hoặc metadata của candidate không được phép đọc.
- Không cho phép các field/command `decision`, `finalSeverity`, `reportStatus`, `validate`, `reject`,
  `requestInformation`, `markDuplicate`, `rewardAmount`, `reserve`, `sign`, `payout`, `disclose` hoặc
  `transaction`. Nếu provider trả các field này, schema validation phải reject hoặc strip fail-closed.
- Không render raw provider JSON, raw rationale có secret/URL hoặc lỗi provider. Parse/schema failure,
  prompt-injection signal, unauthorized candidate và privacy violation chuyển thành `AI review: Unavailable`
  hoặc safe redaction; human review không bị chặn.
- Persist result cùng source revision/content hash, `generatedAt`, `persistedAt`, provider/model,
  schema/prompt version, attempt/terminal status và validated fingerprint; không persist raw prompt/raw
  provider response.

### 15.3 Gemini Flash provider và privacy mode

- Exact default stable model: `gemini-3.5-flash`; không dùng `gemini-flash-latest` để tránh silent
  model changes. Model ID vẫn là server configuration và phải được allowlist.
- Dùng Gemini structured JSON output, sau đó validate lại bằng versioned Zod schema trước khi persist.
  Schema-conformant output vẫn chỉ là advisory, không phải business authority.
- Rate limit là per Gemini project và có thể thay đổi theo model/tier. Worker có global/provider rate
  limiter ngoài per-program serialization, xử lý `429 RESOURCE_EXHAUSTED`, timeout và `5xx` bằng
  bounded retry; không hard-code quota như một product guarantee.
- `gemini_free_demo` chỉ được nhận synthetic/demo/non-confidential report. Gemini unpaid service có
  thể dùng input/output để cải thiện sản phẩm và Terms yêu cầu không gửi sensitive/confidential data;
  vì vậy private vulnerability report thật phải fail closed ở mode này.
- Report thật chỉ dùng `gemini_paid` với active billing/privacy acknowledgement hoặc provider khác đã
  được duyệt. `disabled`/provider unavailable vẫn giữ đầy đủ submit và human-review flow.
- API key chỉ ở backend/worker; không browser bundle, database result, logs hoặc error payload.
- Official references: [models](https://ai.google.dev/gemini-api/docs/models),
  [pricing](https://ai.google.dev/gemini-api/docs/pricing),
  [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits),
  [structured outputs](https://ai.google.dev/gemini-api/docs/structured-output),
  [terms](https://ai.google.dev/gemini-api/terms).

### 15.4 Read-only states

| Server/evidence state                                        | Review UI                                                                                                                     |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Current result `completed`, schema valid                     | Compact `AI review · Ready` badge outside the AI box; persisted result is rendered inline in the RR-02 detail evidence column |
| Current run `queued \| running`                              | `AI review: Processing`; không spinner vô hạn, human actions vẫn dùng được                                                    |
| Current run `failed`                                         | `AI review: Unavailable`; safe copy, backend retry only                                                                       |
| Result parse/schema invalid                                  | Safe unavailable/invalid copy; không render raw payload                                                                       |
| Result hash/revision không khớp current report               | `AI review is being refreshed`; stale/superseded result bị ẩn                                                                 |
| AI endpoint/network load error                               | Safe unavailable; report/evidence/human actions không bị thay thế                                                             |
| Unauthorized candidate/result hoặc principal không còn quyền | Không render AI metadata; dùng cùng non-enumerating report access boundary                                                    |

Không có Generate, Regenerate hoặc Retry AI button ở bất kỳ state nào. Worker/backend chịu trách
nhiệm retry theo policy; UI reload/refetch thông thường chỉ đọc trạng thái đã persist và không tạo
AI run mới.

### 15.4a Inline result và external state badge

- RR-02 là màn hình quyết định duy nhất. Không dùng flow `View AI review`, không mở AI result trong
  panel/dialog riêng và không tạo navigation mới chỉ để đọc AI.
- AI result hiện ngay trong một box read-only của RR-02, sau audit timeline/evidence và trước human
  decision controls. Box gồm summary, completeness, suggested severity/scope, missing information,
  authorized duplicate candidates, provenance (revision + content hash + timestamps) và human decision
  boundary. Các action `Validate`, `Request information`, `Reject`, `Mark duplicate` vẫn nằm ở human
  action rail, không bị AI preselect.
- Bên ngoài box chỉ render một badge trạng thái nhỏ, không có affordance click:
  `AI review · Ready`, `AI review · Processing`, `AI review · Unavailable` hoặc
  `AI review · Superseded`. Badge là indicator, không phải button và không được diễn đạt như một
  recommendation/decision.
- Badge dùng outline semantic trên nền trong suốt (`fill: none`); dot, border và text dùng cùng màu
  state. Suggested severity badge cũng là outline transparent (ví dụ High dùng orange), không dùng
  dark/white filled pill làm nền trong AI result.
- `Ready` chỉ được render khi result completed/schema-valid và revision + content hash khớp report
  hiện tại. `Processing`/`Unavailable`/`Superseded` không render stale result như current; human review
  luôn tiếp tục được.
- Figma state inventory phải trình bày badge mapping như các ví dụ riêng; production chỉ render đúng
  một badge theo server state hiện tại. Không đặt các state cạnh nhau trong UI runtime.

### 15.5 Responsive presentation

- 1440 px: AI badge nằm ngoài inline AI box ở report/action summary; inline result nằm trong evidence
  column sau evidence/audit và trước decision rail action.
- 768 px: một cột theo reading order evidence → audit → external AI badge + inline result → human
  decision; provenance fields wrap, không tạo horizontal overflow.
- 390 px: badge compact, inline result xếp dọc trong cùng RR-02; long hash/timestamp/candidate
  reference wrap hoặc truncate kèm accessible full value.
- Processing/status announcement dùng `aria-live="polite"` có kiểm soát; polling không spam screen
  reader và AI tone không cạnh tranh với destructive/human decision semantics.

## 16. Attachment, comment và AI boundaries

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

- AI review tự động được queue ngay sau mỗi successful submit/resubmit; không tự chạy lại do mở,
  reload hoặc navigate inbox/detail.
- Request/response phải tuân theo contract tại §15.2a–§15.2b: provider chỉ nhận current immutable
  report snapshot + bounded same-program duplicate context và chỉ trả structured advisory fields.
- Queue được serialize FIFO theo `programId`; concurrency giữa program được phép. Candidate universe
  chỉ gồm prior sequence trong cùng program.
- Inbox/detail chỉ đọc `queued | running | completed | failed` (hoặc equivalent) và completed
  structured result đã persist cho current report revision/content hash.
- Completed output chỉ gồm summary/completeness/suggested severity/scope assessment/missing
  information/confidence và authorized duplicate candidates nếu enabled; luôn có label
  `AI suggestion`.
- Persist provenance tối thiểu gồm source revision, source content hash, `generatedAt` và
  `persistedAt`; stale/superseded result không được trình bày như current.
- AI không validate, reject, mark duplicate, chọn final severity, reserve reward, ký transaction,
  relay payout, thay đổi report status hoặc chặn human review.
- Không có owner/reviewer Generate/Regenerate/Retry control; retry AI chỉ do backend policy.
- AI duplicate candidates phải được re-authorize theo current principal khi đọc; suggestion không
  tự điền/confirm duplicate target và candidate mất quyền được redacted/non-enumerating.
- Không persist/render raw prompt, private attachment URL, signed URL, storage key hoặc provider raw
  payload. Không gửi toàn bộ video attachment cho AI trong scope này.
- Không gửi private production report qua Gemini free tier. Free mode chỉ cho synthetic/demo data;
  mode/config mismatch phải fail closed thành AI `Unavailable`, không fail report submission.

## 17. Responsive layout

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

## 18. Accessibility

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

## 19. Acceptance criteria

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
- [ ] AC-13 — Mỗi successful submit/resubmit atomically persist submission revision/content hash và
      queue đúng một AI run; result completed được persist cùng `generatedAt`/`persistedAt` và chỉ
      result khớp current revision + hash mới được trình bày là `Ready`.
- [ ] AC-14 — RR-08 có completed/processing/unavailable/failed/invalid/stale/access-safe states tại
      1440/768/390; prior result sau resubmit mang superseded và không fallback như current.
- [ ] AC-15 — Inbox/detail không có Generate, Regenerate hoặc Retry AI control và mở/reload screen
      không tạo run mới. AI luôn mang label `AI suggestion`, không prefill/mutate quyết định, reward,
      signature hoặc report status; human review vẫn khả dụng khi AI chưa sẵn sàng.
- [ ] AC-16 — Submit/resubmit atomically cấp monotonic per-program sequence và enqueue đúng một run;
      durable worker concurrency `1/program`, FIFO, cross-program parallelism và multi-replica race
      protection có automated evidence.
- [ ] AC-17 — Hai same-program reports submit đồng thời được order canonical; job sau duplicate-check
      được report trước. Candidate query không đọc future sequence/cross-program report và researcher
      không thấy candidate metadata.
- [ ] AC-18 — Gemini provider pin exact stable `gemini-3.5-flash`, structured output được Zod validate,
      quota/timeout/invalid output retry bounded và không chặn human review. Free tier chỉ chạy với
      synthetic/demo/non-confidential data; private production content fail closed.

## 20. Test matrix

| Nhóm        | Scenario                                       | Expected                                                        |
| ----------- | ---------------------------------------------- | --------------------------------------------------------------- |
| Auth        | Anonymous mở `/review/:id`                     | Login + safe returnTo; không flash private data                 |
| Auth        | Researcher/owner khác đoán UUID                | Safe unavailable/access denied; không lộ title/status           |
| Scope       | Owner và assigned reviewer xem inbox           | Mỗi role chỉ thấy đúng owned/assigned program reports           |
| Inbox       | Filter + load more + next-page failure         | Query giữ filters; rows đã tải còn nguyên; retry được           |
| Review      | Validate với từng severity                     | Một atomic transition; final severity đúng; chưa reserve tiền   |
| Review      | Request info → comment → researcher resubmit   | needs_information → submitted; audit giữ đủ vòng                |
| Review      | Reject thiếu reason hoặc double click          | Client/server chặn; không duplicate review record               |
| Duplicate   | Self/cross-program/cycle/unauthorized target   | Stable validation/forbidden; current report không đổi           |
| Race        | Hai reviewer quyết định cùng lúc               | Chỉ transition hợp lệ thắng; client thua refetch state          |
| Reward      | Range/flat ngoài tier hoặc pool thiếu          | Không tạo/reserve intent; safe field/business error             |
| Reward      | Percentage basis                               | Server derive amount/cap đúng; client không override amount     |
| Wallet      | Wrong owner wallet/network                     | Fail closed trước signature; không reserve/sign sai account     |
| Recovery    | Wallet reject chắc chắn trước submit           | Continue/cancel theo safe scan; không report paid               |
| Recovery    | Unknown wallet outcome hoặc reload sau tx      | Resume/reconcile only; không prompt approval lần hai            |
| Payout      | Circle accepts nhưng Arc chưa confirmed        | Chưa paid; tiếp tục provider/Arc reconciliation                 |
| Payout      | Deterministic payout failure                   | Linked replacement attempt; không reserve/reapprove lại         |
| Payout      | Exact Arc event + USDC Transfer verified       | reward_approved/payment_pending → paid đúng một lần             |
| Attachment  | Uploaded/pending/expired URL/forged attachment | Chỉ uploaded; refresh on click; forged relation denied          |
| Privacy     | Analytics/log/error capture                    | Không report body, UUID, Gist, URL, comment, wallet secret      |
| Responsive  | 390/768/1440 + 200% zoom                       | Không overflow/che action; keyboard/focus order đúng            |
| A11y        | Screen reader dialog/status/progress           | Label/effect/error rõ; poll không spam announcements            |
| AI trigger  | Submit/resubmit cùng revision/hash             | Persist enqueue record đúng một lần; không phụ thuộc mở review  |
| AI current  | Completed result khớp revision + content hash  | Ready badge + inline advisory result; human form không prefill  |
| AI stale    | Resubmit khi prior result đã completed         | Prior result superseded/ẩn; run mới Processing hoặc Unavailable |
| AI safety   | Failed/invalid/network/access-safe             | Không raw payload/metadata leak; không chặn human review        |
| AI control  | Mở/reload inbox/detail                         | Không tạo run; không có Generate/Regenerate/Retry button        |
| AI race     | Hai same-program submits đồng thời             | Sequence `N/N+1`; FIFO; report sau xét report trước             |
| AI parallel | Hai program submit đồng thời                   | Có thể chạy song song; không dùng global concurrency `1`        |
| AI retry    | Gemini 429/timeout/5xx                         | Bounded backoff; terminal Unavailable; queue tiếp tục           |
| AI privacy  | Private report ở `gemini_free_demo`            | Không gọi provider; AI Unavailable; human review vẫn dùng được  |
| AI access   | Researcher đọc possible duplicate              | Chỉ safe aggregate copy; không candidate ID/title/private body  |

## 21. Implementation gates

Không chuyển ticket sang Done trước khi đủ các gate sau:

1. Figma review: RR-01 đến RR-08 có desktop/mobile và design-system variants; owner/reviewer
   distinction, private copy, terminal/system states được duyệt.
2. Requirement review: Notion ticket liên quan được map/update theo durable Arc settlement và
   persisted current-revision AI review, responsive requirements; status live được xác nhận.
3. Contract review: shared schema/OpenAPI/API/database transition cùng một source of truth; legacy
   off-chain settlement endpoints không được frontend gọi; AI run/result provenance và status có
   canonical read contract.
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
