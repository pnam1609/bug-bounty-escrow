# My Reports — Researcher flow for Figma

## 1. Mục tiêu

Tài liệu này định nghĩa màn hình **My Reports** dành cho Security Researcher trong BountyEscrow.

Màn hình là dashboard riêng tư tại `/reports`, giúp researcher:

- Xem toàn bộ report của chính mình.
- Nhận biết report nào đang cần bổ sung thông tin.
- Theo dõi trạng thái triage, validation, reward và payout.
- Lọc theo program, status và severity.
- Mở report detail tại `/reports/:id`.
- Đi tới `/programs` để tìm program và bắt đầu report mới.

Tài liệu đồng thời là requirement đầu vào cho:

- Figma và prototype.
- Frontend sử dụng shadcn/ui + Tailwind CSS.
- API contract.
- Database query, RLS và aggregate metrics.

Nội dung report là dữ liệu riêng tư. My Reports không phải trang public disclosure và không được dùng để công khai Known Issues.

## 2. Phạm vi

### Trong phạm vi

- My Reports desktop dark theme.
- Danh sách report có pagination.
- Program, status và severity filters.
- Summary metrics.
- Action-required state cho `needs_information`.
- Account-empty state.
- Filtered-empty, loading và error requirements.
- Điều hướng sang report detail và Browse Programs.
- Quy tắc status, severity, reward, timestamp và quyền truy cập.

### Ngoài phạm vi

- Form Submit Bug; xem `submit-bug-researcher-flow-for-figma.md`.
- Nội dung đầy đủ của report detail.
- Owner/reviewer report inbox.
- Public disclosure hoặc Known Issues.
- KYC.
- Mobile layout trong phase hiện tại.

## 3. Nguồn sự thật hiện tại

### Routes

| Mục đích | Route |
| --- | --- |
| My Reports | `/reports` |
| Private report detail | `/reports/:id` |
| Submit report | `/reports/new?programId=:programId` |
| Browse Programs | `/programs` |
| Program detail | `/programs/:id` |

### API

```text
GET /api/reports
GET /api/reports/:id
```

`GET /api/reports` được validate bằng `reportListQuerySchema`.

Query hiện có:

| Query | Kiểu | Ý nghĩa |
| --- | --- | --- |
| `page` | positive integer | Trang hiện tại, mặc định `1` |
| `limit` | positive integer | Số item mỗi trang, mặc định `20`, tối đa `100` |
| `programId` | UUID | Lọc theo program |
| `researcherId` | UUID | Lọc theo researcher; server vẫn phải áp quyền |
| `status` | report status | Lọc một status chính xác |
| `severity` | severity | Hiện lọc theo `proposed_severity` |

API hiện chưa hỗ trợ:

- Free-text search.
- Multi-status filter.
- Sort query.
- Summary/aggregate metrics.
- Human-readable report reference code.

### Quyền truy cập

- Route `/reports` chỉ dành cho authenticated researcher.
- Researcher chỉ được đọc report có `researcher_id = auth.uid()`.
- Owner/reviewer có thể đọc report thuộc program được cấp quyền ở flow riêng, nhưng không được sử dụng My Reports như researcher dashboard.
- Anonymous phải sign in và giữ internal `returnTo=/reports` an toàn.
- User sai role phải tới safe access-denied state.
- UI không được render dữ liệu report trước khi session và role được xác nhận.
- RLS là lớp bảo vệ bắt buộc; filter phía frontend không phải security boundary.

## 4. Figma inventory

File:

[Bug Bounty Escrow — Dark Desktop Preview](https://www.figma.com/design/PXhIUlWSb44xjonYNxviCN/Bug-Bounty-Escrow-%E2%80%94-Dark-Desktop-Preview)

Page: `researcher`

| ID | View | Figma node |
| --- | --- | --- |
| MR-01 | My Reports — All | [281:1876](https://www.figma.com/design/PXhIUlWSb44xjonYNxviCN/Bug-Bounty-Escrow-%E2%80%94-Dark-Desktop-Preview?node-id=281-1876) |
| MR-02 | My Reports — Needs information | [281:1900](https://www.figma.com/design/PXhIUlWSb44xjonYNxviCN/Bug-Bounty-Escrow-%E2%80%94-Dark-Desktop-Preview?node-id=281-1900) |
| MR-03 | My Reports — Empty | [281:1924](https://www.figma.com/design/PXhIUlWSb44xjonYNxviCN/Bug-Bounty-Escrow-%E2%80%94-Dark-Desktop-Preview?node-id=281-1924) |
| SR-15 | Submitted report detail | [272:1882](https://www.figma.com/design/PXhIUlWSb44xjonYNxviCN/Bug-Bounty-Escrow-%E2%80%94-Dark-Desktop-Preview?node-id=272-1882) |
| RS-00 | Browse bounties | [116:4](https://www.figma.com/design/PXhIUlWSb44xjonYNxviCN/Bug-Bounty-Escrow-%E2%80%94-Dark-Desktop-Preview?node-id=116-4) |

Các giá trị tên program, report, reward, timestamp và metrics trong Figma là sample data để review visual; không phải production constants.

## 5. Data contract

### Report summary

Mỗi row của `GET /api/reports` có contract:

```ts
type ReportSummary = {
  id: string;
  programId: string;
  programName: string;
  programSlug: string;
  researcherId: string;
  affectedScopeId: string;
  title: string;
  proposedSeverity: Severity;
  finalSeverity?: Severity;
  status: ReportStatus;
  approvedReward?: string;
  submittedAt?: string;
  paidAt?: string;
  updatedAt: string;
};
```

Pagination metadata:

```ts
type PaginationMetadata = {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};
```

### Report statuses

Giá trị status phải dùng nguyên contract:

```text
draft
submitted
triaged
needs_information
rejected
duplicate
validated
reward_approved
payment_pending
paid
```

Không tạo status mới chỉ để phục vụ UI.

### Severity

```text
critical
high
medium
low
informational
```

UI hiển thị:

```ts
displaySeverity = finalSeverity ?? proposedSeverity
```

Nếu `finalSeverity` tồn tại, accessible label hoặc tooltip phải nói đây là final severity. Nếu chưa tồn tại, phải nói đây là proposed severity. Không được làm researcher hiểu nhầm proposed severity đã được program xác nhận.

### Reward

- Hiển thị `approvedReward` khi giá trị tồn tại.
- Token thanh toán của sản phẩm hiện là USDC.
- Nếu chưa có `approvedReward`, hiển thị em dash `—`; không hiển thị `0 USDC`.
- `paid` chỉ được coi là đã thanh toán khi report status là `paid` và dữ liệu settlement hợp lệ.
- `payment_pending` không được dùng màu success.
- Formatting phải giữ độ chính xác monetary contract; không parse bằng floating-point không an toàn.

## 6. Status presentation

| Status | Label UI | Nhóm | Tone gợi ý | Hành động chính |
| --- | --- | --- | --- | --- |
| `draft` | Draft | Draft | Neutral | Continue editing |
| `submitted` | Submitted | Under review | Info | View report |
| `triaged` | Triaged | Under review | Info | View report |
| `needs_information` | Needs information | Action required | Warning | Add information |
| `rejected` | Rejected | Closed | Destructive | View decision |
| `duplicate` | Duplicate | Closed | Neutral | View duplicate reference |
| `validated` | Validated | Decision | Success | View validation |
| `reward_approved` | Reward approved | Settlement | Success | View reward |
| `payment_pending` | Payment pending | Settlement | Warning/Info | Track payment |
| `paid` | Paid | Completed | Success | View payment |

Badge color chỉ là hỗ trợ thị giác. Text label luôn bắt buộc.

## 7. Information architecture

```text
Researcher navigation
  ├─ Browse Programs → /programs
  ├─ My Reports → /reports
  │    ├─ All reports
  │    ├─ Needs information
  │    ├─ Filters
  │    ├─ Pagination
  │    └─ Report row → /reports/:id
  └─ Submit report → /reports/new?programId=:programId
```

Account menu:

- `My reports` mở `/reports`.
- `Browse programs` mở `/programs`.

Report detail:

- Back action `My reports` mở `/reports`.
- Nếu đi vào detail từ một filtered list, frontend nên giữ query trong return URL hoặc browser history.

## 8. MR-01 — My Reports / All

### Header

- Dùng Researcher header của BBE Design System.
- Active navigation: `My reports`.
- Không dùng owner workspace navigation.

### Page heading

- Eyebrow: `Researcher workspace`.
- H1: `My reports`.
- Subtitle: giải thích đây là private report history và trạng thái mới nhất.
- Primary CTA: `Browse programs` → `/programs`.

Không đặt nút `Submit report` chung khi chưa có `programId`, vì report phải bắt đầu từ một active program cụ thể.

### Summary metrics

1. `All reports`
2. `Needs information`
3. `Under review`
4. `Rewards paid`

Ý nghĩa:

```text
All reports
  = tổng report researcher được phép xem

Needs information
  = count(status = needs_information)

Under review
  = count(status in [submitted, triaged])

Rewards paid
  = sum(approvedReward where status = paid)
```

Metrics phải được tính từ toàn bộ result set của researcher, không chỉ trang hiện tại.

### Filters

Filter bar gồm:

- Program.
- Status.
- Severity.
- Reset filters.

Quy tắc:

- Filter change reset `page=1`.
- State filter phải đồng bộ vào URL query để back/forward hoạt động.
- Không gửi option rỗng hoặc value ngoài schema.
- Reset đưa filter về mặc định và `page=1`.
- Program option dùng `programId`, label dùng `programName`.
- Severity filter hiện map vào `proposed_severity`, đúng với repository hiện tại.
- Không thêm search input trước khi API có search contract.

### Report table

Columns:

| Column | Data | Quy tắc |
| --- | --- | --- |
| Report | Reference + `title` | Title tối đa 2 dòng; không lộ description |
| Program | `programName` | Có thể link tới `/programs/:programId` nếu route hỗ trợ ID |
| Severity | `finalSeverity ?? proposedSeverity` | Badge có label accessible |
| Status | `status` | Dùng mapping ở mục 6 |
| Reward | `approvedReward` | USDC hoặc `—` |
| Updated | `updatedAt` | Relative time + exact datetime accessible |
| Action | Chevron | Toàn row mở `/reports/:id` |

Mobile action không nằm trong scope hiện tại, nhưng desktop row vẫn phải hỗ trợ keyboard focus và Enter.

### Human-readable report reference

Figma đang dùng mã ví dụ như:

```text
BBE-2026-0142
```

Contract hiện chỉ trả UUID `id`. Trước khi implement cần chọn một trong hai:

1. Bổ sung immutable `referenceCode`/`displayId` từ server và unique index trong database.
2. Tạm hiển thị short UUID có accessible label chứa full UUID.

Không được tự sinh mã theo thứ tự ở client vì có thể collision, thay đổi theo pagination và gây hiểu nhầm.

### Pagination

- Dùng metadata từ API, không tự suy ra từ số row hiện có.
- Disable Previous khi `hasPreviousPage = false`.
- Disable Next khi `hasNextPage = false`.
- Label dạng `1–20 of 126`.
- Figma hiển thị 5 row để giữ mật độ visual; production mặc định theo contract là `20`.
- Pagination change phải giữ các filter đang active.

### Sorting

Repository hiện sắp xếp:

```text
submitted_at DESC NULLS LAST
id ASC
```

Do đó:

- Copy production nên nói `Newest submitted first`.
- Column `Updated` vẫn hiển thị `updatedAt`.
- Nếu product muốn `Newest updated first`, phải bổ sung sort contract và index phù hợp; không chỉ đổi copy trong Figma.

## 9. MR-02 — Needs information

Đây là filtered state của `/reports`:

```text
status=needs_information
```

### Action-required alert

Alert xuất hiện phía trên table khi có ít nhất một report cần bổ sung:

- Title: `Action required`.
- Description: cho biết program team cần thêm thông tin trước khi tiếp tục review.
- Không hiển thị nội dung private comment trong list alert.

### Row behavior

- Status phải là exact `needs_information`.
- Primary row action mở `/reports/:id`.
- Report detail phải làm nổi bật latest request-information comment.
- Researcher chỉ được sửa report của mình ở state hợp lệ.
- Sau khi resubmit thành công, list invalidates/refetches và report rời filter này nếu status đổi sang `submitted`.
- `submittedAt` gốc phải được giữ nguyên để không làm sai review latency.

## 10. MR-03 — Account empty

Account empty nghĩa là researcher chưa có report nào trong toàn bộ dataset:

```text
metadata.totalItems = 0
and no active filters
```

UI:

- Icon mang nghĩa report/document.
- H2: `No reports yet`.
- Mô tả ngắn về cách bắt đầu.
- Primary CTA: `Browse programs` → `/programs`.
- Ba bước giải thích:
  1. Choose a program.
  2. Submit a private report.
  3. Track review and reward.
- Privacy note: report content remains participant-only unless a separate disclosure decision is published.

Không hiển thị KYC, wallet setup hoặc payout form trong empty state.

## 11. Filtered empty

Filtered empty khác account empty.

Điều kiện:

```text
metadata.totalItems = 0
and at least one filter is active
```

UI requirement:

- H2: `No reports match these filters`.
- Hiển thị filter chips đang active.
- CTA: `Clear filters`.
- Không hiển thị onboarding ba bước.
- Không kết luận user chưa từng submit report.

Filtered-empty view chưa có frame riêng trong Figma hiện tại; có thể triển khai từ `MR-03` bằng empty-state component variant.

## 12. Loading, refresh và error states

### Initial loading

- Giữ page heading và filter layout ổn định.
- Metrics dùng skeleton.
- Table dùng row skeleton có cùng column widths.
- Không dùng fake status/reward trong skeleton.

### Filter hoặc pagination loading

- Giữ dữ liệu cũ trong lúc fetch nếu query layer hỗ trợ.
- Hiển thị progress không chặn toàn page.
- Chống double navigation.

### API error

- Inline error card trong content area.
- Copy không lộ database, policy hoặc storage internals.
- Action: `Try again`.
- Header/navigation vẫn hoạt động.

### Unauthorized

- `401`: chuyển tới sign-in với safe internal return URL.
- `403`: chuyển tới access-denied.
- Không render stale cached private rows sau khi session mất hiệu lực.

### Deleted hoặc inaccessible report

Nếu row cũ mở detail và API trả `404`, hiển thị safe not-found state rồi cho quay lại My Reports. Không phân biệt “không tồn tại” và “không có quyền” bằng copy chi tiết.

## 13. Metrics và backend gap

List API hiện chưa cung cấp summary metrics.

### Có thể lấy ngay

- `All reports`: `metadata.totalItems` từ unfiltered list.
- Một count theo status: gọi list endpoint với status tương ứng và `limit=1`, đọc `metadata.totalItems`.

### Chưa tối ưu

- `Under review` cần tổng `submitted + triaged`, trong khi API chỉ nhận một status.
- `Rewards paid` cần aggregate `SUM(approved_reward)` cho report `paid`.
- Gọi nhiều list request chỉ để render dashboard làm tăng latency và tạo snapshot không đồng nhất.

### API đề xuất

```text
GET /api/reports/summary
```

Response đề xuất:

```ts
type ResearcherReportSummary = {
  allReports: number;
  needsInformation: number;
  underReview: number;
  rewardsPaid: string;
  paymentToken: 'USDC';
  calculatedAt: string;
};
```

Yêu cầu:

- Principal lấy từ session; không tin `researcherId` tùy ý từ browser.
- Aggregate bị giới hạn bởi RLS/authorization tương đương list.
- Monetary value giữ dưới dạng decimal string.
- Metrics và list có thể cache ngắn nhưng phải invalidate sau mutation.

Nếu chưa có endpoint summary, frontend có thể ẩn metrics chưa hỗ trợ hoặc dùng multiple requests có kiểm soát. Không hardcode số từ Figma.

## 14. Program filter data

List response đã có `programId`, `programName`, `programSlug`, nhưng chỉ cho các row của trang hiện tại.

Không nên xây toàn bộ Program dropdown chỉ từ page hiện tại vì sẽ thiếu option.

Chọn một trong các hướng:

1. API trả distinct programs có report của researcher.
2. Summary/filter-options endpoint trả danh sách option.
3. Dùng endpoint programs phù hợp và chỉ giữ program researcher có report.

Option contract đề xuất:

```ts
type ReportProgramFilterOption = {
  id: string;
  name: string;
  slug: string;
  reportCount?: number;
};
```

## 15. Report detail integration

Row click mở:

```text
/reports/:id
```

Detail dùng `GET /api/reports/:id` và có thể hiển thị:

- Program và affected scope.
- Title, description và reproduction steps.
- Proposed/final severity.
- Selected impacts.
- Attachments.
- Status timeline.
- Participant-only comments.
- Request for information.
- Reward và payment state.

Detail phải có:

- Back to My Reports.
- Safe loading/error/not-found.
- Exact status label.
- Private-content notice.
- Edit/resubmit action chỉ khi server cho phép.

Không dùng public program detail để hiển thị nội dung private report.

## 16. Privacy và security

- Report title cũng có thể chứa nhạy cảm; không đưa vào analytics, logs hoặc notification preview không an toàn.
- Không log description, reproduction steps, PoC, attachments, comments hoặc signed URLs.
- Attachment download chỉ qua short-lived signed URL sau khi verify report–attachment relation.
- Cache private response phải tách theo authenticated principal.
- Logout phải clear/invalidate private query cache.
- Không prefetch report detail của row nếu cơ chế prefetch có thể lưu private payload ngoài boundary mong muốn.
- Public Known Issues lấy từ `report_disclosures`, không đọc trực tiếp từ My Reports.
- Program owner quyết định disclosure riêng; trạng thái `paid` không tự động public report.
- Không có KYC trong sản phẩm.

## 17. Accessibility

- H1 duy nhất: `My reports`.
- Filter có visible label.
- Table dùng semantic header/cell hoặc grid semantics đúng.
- Row action truy cập được bằng keyboard.
- Focus ring dùng BBE Design System token.
- Status và severity không truyền nghĩa chỉ bằng màu.
- Relative time có accessible exact ISO/local datetime.
- Icon-only action có `aria-label`.
- Alert `needs_information` dùng semantics phù hợp nhưng không tự động gây screen-reader noise khi page load.
- Contrast theo WCAG AA cho text, badge và focus state.
- Empty-state illustration/icon là decorative nếu heading đã truyền đủ nghĩa.

## 18. Responsive rules

Phase hiện tại chỉ thiết kế dark desktop.

Desktop:

- Viewport tham chiếu tối thiểu 1440 px.
- Content container theo BBE Design System.
- Table không bị che bởi viewport height; page phải scroll theo content.
- Không khóa frame ở height 820 px.

Khi thiết kế tablet/mobile sau:

- Metrics chuyển từ 4 columns thành 2 hoặc 1.
- Filters chuyển sang drawer/sheet.
- Table chuyển thành report cards hoặc horizontal scroll có chỉ báo rõ.
- Status, title và primary action luôn được ưu tiên.
- Reward/timestamp có thể xuống secondary row.

## 19. shadcn/ui + Tailwind mapping

Figma phải giữ cấu trúc gần với implementation:

| Figma pattern | shadcn/ui |
| --- | --- |
| Primary/secondary action | `Button` |
| Program/status/severity filter | `Select` |
| Status/severity token | `Badge` |
| Metrics | `Card` |
| Report list | `Table` |
| Needs-information notice | `Alert` |
| Account/filtered empty | reusable empty-state composition |
| Pagination | `Button` + pagination composition |
| Loading | `Skeleton` |
| Error feedback | `Alert` |
| Relative timestamp detail | `Tooltip` where useful |

Tailwind conventions:

- Ưu tiên semantic CSS variables tương thích shadcn: `background`, `foreground`, `card`, `card-foreground`, `muted`, `muted-foreground`, `border`, `primary`, `destructive`.
- Không hardcode màu trực tiếp trong page component.
- Spacing dùng scale 4 px.
- Radius, border và shadow lấy từ Design System.
- Row, filter group và metrics dùng layout primitives rõ ràng để AI generate Auto Layout thành flex/grid dễ dự đoán.
- Lucide dùng cho icon; không dùng text glyph thay icon.

## 20. Analytics

Event có thể ghi:

```text
my_reports_viewed
my_reports_filter_changed
my_reports_page_changed
my_reports_row_opened
my_reports_browse_programs_clicked
my_reports_retry_clicked
```

Allowed properties:

- Filter enum.
- Page number.
- Result count.
- Status group.
- Severity enum.

Không gửi:

- Report title.
- UUID/report reference.
- Program-private identifiers nếu không cần.
- Description, PoC, comment hoặc attachment metadata.
- Reward amount gắn với một report cá nhân.

## 21. Acceptance criteria

### Functional

- [ ] Authenticated researcher mở `/reports` và chỉ thấy report của chính mình.
- [ ] Anonymous được đưa tới sign-in với safe `returnTo`.
- [ ] Sai role không thấy private report data.
- [ ] Program, status và severity filter map đúng query contract.
- [ ] Filter change reset page về 1.
- [ ] Pagination dùng metadata của server.
- [ ] Row mở đúng `/reports/:id`.
- [ ] `needs_information` có action-required presentation.
- [ ] Account empty và filtered empty dùng hai copy khác nhau.
- [ ] Reward chỉ hiển thị khi `approvedReward` tồn tại.
- [ ] Severity hiển thị `finalSeverity ?? proposedSeverity` và phân biệt Proposed/Final.
- [ ] API error có retry.
- [ ] Logout clear private data khỏi UI cache.

### Visual

- [ ] Dùng BBE Design System dark desktop.
- [ ] Background, card, border, typography và spacing dùng semantic tokens.
- [ ] Metrics, filters và table align theo cùng content grid.
- [ ] Status/severity badge không lệch text hoặc icon.
- [ ] Không có clipped content hoặc fixed-height viewport che table/pagination.
- [ ] Hover, focus, disabled và loading states được định nghĩa.
- [ ] Lucide icon được dùng nhất quán.

### Data/API

- [ ] Không hardcode Figma sample metrics.
- [ ] Production copy phản ánh sort `submitted_at DESC`, hoặc API được mở rộng trước khi nói “updated first”.
- [ ] Human-readable report code chỉ dùng sau khi server có contract, hoặc dùng short UUID rõ ràng.
- [ ] Metrics tính trên toàn dataset, không phải current page.
- [ ] Program dropdown không suy ra chỉ từ current page.
- [ ] Monetary values giữ dưới dạng decimal string.

### Security

- [ ] RLS participant-only được giữ nguyên.
- [ ] Không có report content trong logs/analytics.
- [ ] Public Known Issues chỉ đến từ disclosure projection.
- [ ] Signed attachment URL không được persist hoặc log.
- [ ] Unauthorized/not-found response không làm lộ report có tồn tại hay không.

## 22. Backend/database impact cần theo dõi

### Bắt buộc nếu giữ nguyên Figma metrics

- Thêm summary aggregate endpoint hoặc RPC tương đương.
- Có index/query plan phù hợp cho researcher + status.
- Aggregate rewards paid bằng numeric an toàn.

### Bắt buộc nếu giữ mã `BBE-YYYY-NNNN`

- Thêm immutable `reference_code`.
- Unique constraint/index.
- Sinh ở server/database, không sinh ở client.
- Quy tắc chống đoán tuần tự cần được security review.

### Cần mở rộng nếu muốn sort/filter nâng cao

- `sort` và `direction` trong query schema.
- Multi-status filter nếu dùng nhóm `Under review`.
- Index theo `researcher_id`, sort column và stable `id`.
- Có cursor pagination nếu volume lớn; hiện tại contract là page/limit.

### Không cần thay database

- Account empty.
- Filtered empty.
- Badge mapping.
- Relative time từ `updatedAt`.
- Link từ list sang detail.

## 23. Quyết định sản phẩm đã chốt

- Researcher và Program Owner dùng hai workspace khác nhau.
- My Reports thuộc Researcher workspace.
- Dark desktop được ưu tiên trước.
- UI follow BBE Design System, shadcn/ui, Tailwind CSS và Lucide.
- Report là participant-only.
- Không có KYC.
- Known Issue chỉ public khi owner có disclosure decision phù hợp; program kết thúc không tự động public mọi report.
- Payment token là USDC.

## 24. Handoff

Khi dùng tài liệu này để generate frontend:

1. Implement contract và security behavior trước sample copy.
2. Giữ exact enum values trong URL/API; label chỉ là presentation.
3. Không suy luận field chưa có từ screenshot.
4. Đánh dấu rõ các gap: metrics endpoint, program filter options và report reference code.
5. Reconcile Figma copy về sorting trước khi QA production.
6. Test bằng ít nhất các dataset:
   - Không có report.
   - Chỉ có draft/local draft.
   - Có `needs_information`.
   - Có đủ các settlement states.
   - Có hơn 20 report.
   - Filter không có kết quả.
   - Session hết hạn giữa lúc pagination.

