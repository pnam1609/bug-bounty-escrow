# Reward center — Researcher future flow for Figma

## 1. Mục tiêu

Tài liệu này định nghĩa page **Reward - future** dành cho security researcher trong
BountyEscrow.

Ở trạng thái sản phẩm hiện tại, page chỉ là bản giới thiệu có nhãn `Future release`. Nó giải thích
cách reward và USDC settlement sẽ hoạt động, đồng thời đưa researcher trở lại các chức năng đang
có thật là `My reports` và `Browse programs`.

Page không được giả lập reward balance, transaction, thời gian thanh toán hoặc wallet đã kết nối
khi backend chưa cung cấp dữ liệu tương ứng.

## 2. Trạng thái feature và phạm vi

### Hiện tại

- Account menu hiển thị `Rewards · Future` ở trạng thái disabled.
- Chưa có route Reward có thể truy cập trong MVP.
- Reward đã approve và `paidAt` hiện được xem trong report detail.
- Page Figma là future-facing product preview, không phải dashboard đang hoạt động.
- Các CTA trong implementation tương lai quay về `/reports` và `/programs`.

### Khi feature được triển khai

Route khuyến nghị:

```text
/rewards
```

Feature hoàn chỉnh sẽ cho researcher:

- Xem reward đã được human reviewer/owner approve.
- Theo dõi settlement từ `reward_approved` tới `payment_pending` và `paid`.
- Xem transaction evidence do backend xác nhận.
- Cấu hình hoặc xác nhận payout wallet chỉ khi reward flow thực sự cần.

### Không thuộc phạm vi

- Approve report hoặc chọn final severity.
- Tự quyết định reward amount.
- Kích hoạt payout thay owner/reviewer.
- AI auto-approval hoặc AI auto-payout.
- Ví custody, lưu private key hoặc seed phrase.
- Swap, bridge, multi-chain balance hoặc portfolio.
- Public disclosure của vulnerability report.
- Guaranteed payout claim trước human validation và reward approval.

## 3. Nguồn sự thật

### Product lifecycle

```text
Researcher submits report
        ↓
Human reviewer validates report
        ↓
Owner/reviewer approves reward
        ↓
Escrow payment starts
        ↓
Blockchain confirmation is recorded
        ↓
Researcher sees Paid and transaction evidence
```

Canonical settlement states:

```text
validated
    ↓
reward_approved
    ↓
payment_pending
    ↓
paid
```

Các trạng thái `rejected` và `duplicate` đóng report mà không đi vào reward settlement.

### Domain rules

- AI chỉ hỗ trợ triage; AI không validate report, chọn reward hoặc release USDC.
- `validated` là quyết định review của con người.
- `reward_approved` nghĩa là reward đã được approve và reserve từ program pool; chưa có nghĩa tiền
  đã được gửi.
- `payment_pending` nghĩa transaction đã được ghi nhận và đang chờ xác nhận.
- `paid` chỉ được hiển thị sau khi backend xác nhận settlement evidence.
- Reward approval và payment time không thuộc `medianResolutionSeconds`; metric đó chỉ đo tốc độ
  ra quyết định review.
- Researcher chỉ xem reward gắn với report của chính mình.
- Report body, PoC và private attachment không xuất hiện trong reward list.

### Design system

Nguồn sự thật thị giác:

- Figma file: `PXhIUlWSb44xjonYNxviCN`.
- Page: `BBE Design System` (`2:3`).
- Implementation conventions: `packages/ui/CONVENTIONS.md`.
- Chỉ có dark theme.
- Violet là primary/current action.
- Mint chỉ dùng cho escrow hoặc trạng thái hoàn tất.
- Red chỉ dùng cho error/destructive.
- Typography dùng Inter.
- Icon dùng Lucide hoặc component icon đã có trong BBE Design System.

## 4. Figma placement

Page hiện tại:

| Thành phần | Tên / node                                       |
| ---------- | ------------------------------------------------ |
| Figma page | `Reward - future` (`284:4513`)                   |
| Section    | `Researcher · Rewards future` (`284:4514`)       |
| Desktop    | `RF-01 · Rewards future · Desktop` (`284:4515`)  |
| Mobile web | `RF-M-01 · Rewards future · Mobile` (`284:4516`) |

Links:

- Page:
  `https://www.figma.com/design/PXhIUlWSb44xjonYNxviCN/?node-id=284-4513`
- Desktop:
  `https://www.figma.com/design/PXhIUlWSb44xjonYNxviCN/?node-id=284-4515`
- Mobile:
  `https://www.figma.com/design/PXhIUlWSb44xjonYNxviCN/?node-id=284-4516`

Prototype starting points:

- `Rewards future · Desktop`.
- `Rewards future · Mobile`.

Figma không cho `NAVIGATE` tới top-level frame ở page khác. Vì Programs và Reports nằm trong page
`researcher`, các CTA của page này không được gắn reaction cross-page không hợp lệ. Trong code,
CTA phải dùng route thật.

## 5. Researcher shell

### Desktop

- Frame: `1440 × 1368`.
- Header cao `80px`, trải toàn chiều rộng.
- Không có left sidebar.
- Main content rộng tối đa `1312px`, căn giữa.
- Short footer nằm sau toàn bộ content, không overlay card hoặc CTA.
- Header dùng researcher account menu hiện có.

Navigation/account menu:

- `Browse programs`.
- `My reports`.
- `Rewards · Future`.
- `Account settings`.
- `Logout`.

### Mobile web

- Frame: `390 × 2200`.
- Dùng compact mobile header.
- Main content có horizontal inset `24px`.
- Page phải đủ dài để hiển thị trọn nội dung; không cắt card theo viewport ngắn.
- Các button xếp dọc và full-width.
- Không thiết kế native iOS/Android navigation.

### Footer

- Desktop dùng `Footer / Desktop · Short`.
- Mobile future preview không cần footer nếu tạo khoảng trống cuối page rõ ràng và không có nội dung
  bị cắt.
- Infinite-scroll reward list trong feature hoàn chỉnh có thể bỏ footer theo cùng rule của
  `ResearcherShell`.

## 6. Information architecture

Page future preview gồm:

1. Breadcrumb/context.
2. `Future release` badge.
3. Page title và subtitle.
4. Future hero.
5. Planned capability cards.
6. Payout lifecycle.
7. Wallet boundary note.
8. Current-feature guidance.

Hierarchy:

```text
Researcher shell
└── Rewards & payouts
    ├── Future release hero
    │   ├── View my reports
    │   └── Browse programs
    ├── What this page will include
    │   ├── Track reward approvals
    │   ├── Verify on-chain settlement
    │   └── Manage payout wallet
    ├── How payouts will work
    │   ├── Validated
    │   ├── Reward approved
    │   ├── Payment pending
    │   └── Paid
    └── For now, follow My reports
        └── Open my reports
```

## 7. User flow

```mermaid
flowchart TD
  A[Researcher account menu] --> B[Rewards · Future disabled]
  C[Future preview entry] --> D[RF-01 Rewards future]
  D -->|View my reports| E[/reports]
  D -->|Browse programs| F[/programs]
  D --> G[Read planned payout lifecycle]
  G --> H[No payout action is available]
```

Target flow khi feature hoàn chỉnh:

```mermaid
flowchart TD
  A[/rewards] --> B[Load researcher-owned reward summaries]
  B -->|No eligible reports| C[Empty state]
  B -->|Request failed| D[Error and retry]
  B -->|Rewards found| E[Reward list]
  E --> F[Select reward]
  F --> G[/reports/:id reward and transaction detail]
  G -->|Reward approved and wallet required| H[Confirm payout wallet]
  G -->|Payment pending| I[View pending transaction]
  G -->|Paid| J[Verify confirmed transaction evidence]
```

## 8. Screen inventory

### Current Figma scope

| ID      | Screen                 | Route/state    | Mục đích                                            |
| ------- | ---------------------- | -------------- | --------------------------------------------------- |
| RF-01   | Rewards future desktop | Future preview | Giải thích feature và đưa user về chức năng hiện có |
| RF-M-01 | Rewards future mobile  | Future preview | Responsive version, không cắt nội dung              |

### Target implementation states

Các state dưới đây là requirement tương lai, không được trộn vào preview như dữ liệu đang hoạt
động:

| ID    | Screen/state            | Mục đích                                    |
| ----- | ----------------------- | ------------------------------------------- |
| RW-00 | Loading                 | Chờ reward summary của researcher           |
| RW-01 | Empty                   | Chưa có report ở settlement lifecycle       |
| RW-02 | Reward list             | Liệt kê reward theo report                  |
| RW-03 | Filtered list           | Lọc theo approved, pending hoặc paid        |
| RW-04 | Load error              | Retry request, không dựng dữ liệu giả       |
| RW-05 | Session expired         | Sign in lại với safe internal return path   |
| RW-06 | Wrong role              | Safe forbidden state                        |
| RW-07 | Wallet not set          | Giải thích lý do cần wallet trước khi lưu   |
| RW-08 | Wallet validation error | Địa chỉ không hợp lệ hoặc network mismatch  |
| RW-09 | Wallet saved            | Xác nhận masked address                     |
| RW-10 | Payment pending         | Hiển thị transaction đang chờ confirmations |
| RW-11 | Paid                    | Hiển thị confirmed settlement evidence      |

## 9. Chi tiết RF-01 — Rewards future desktop

### Intro

Breadcrumb:

```text
Researcher workspace / Rewards
```

Badge:

```text
FUTURE RELEASE
```

Title:

```text
Rewards & payouts
```

Subtitle:

```text
Follow approved rewards and verifiable USDC settlement from one private researcher workspace.
```

### Hero

Eyebrow:

```text
REWARD CENTER
```

Heading:

```text
Your reward center is on the way
```

Body:

```text
Today, report status stays in My reports. This future page will bring approvals, settlement
progress and paid transaction evidence together.
```

Actions:

- Primary: `View my reports` → `/reports`.
- Secondary: `Browse programs` → `/programs`.

Settlement model:

```text
Human decision first. On-chain settlement second.
```

Steps:

1. Human reviewer validates.
2. Owner approves reward.
3. Payment confirms on-chain.
4. Researcher sees Paid.

Settlement model chỉ là explanatory content. Các row không phải clickable stepper và không được
hiểu là tiến độ của một reward cụ thể.

### Planned capabilities

#### Track reward approvals

```text
See the approved USDC amount and the human decision behind it.
```

Icon: `file-text`.

#### Verify on-chain settlement

```text
Follow payment pending, confirmations and the final transaction evidence.
```

Icon: `external-link`.

#### Manage payout wallet

```text
Add or update a payout destination only when a reward is ready.
```

Icon: `wallet`.

### Payout lifecycle

Heading:

```text
How payouts will work
```

Supporting copy:

```text
Human review stays separate from blockchain settlement.
```

| UI label        | Domain state      | Supporting copy                    | Icon           |
| --------------- | ----------------- | ---------------------------------- | -------------- |
| Validated       | `validated`       | A human confirms the finding.      | `shield-check` |
| Reward approved | `reward_approved` | USDC is reserved for the report.   | `circle-check` |
| Payment pending | `payment_pending` | The payout transaction is tracked. | `clock`        |
| Paid            | `paid`            | Settlement evidence is confirmed.  | `circle-check` |

Chỉ `Paid` dùng mint completed treatment. `Reward approved` không được dùng copy khiến user hiểu
là đã nhận tiền.

Wallet boundary note:

```text
Wallet is never required to browse programs or submit a report. It is requested only for receiving
an approved reward.
```

### Current guidance

Heading:

```text
For now, follow rewards in My reports
```

Body:

```text
Approved reward and paid timestamps remain visible on each report detail.
```

Primary action:

```text
Open my reports
```

Destination:

```text
/reports
```

## 10. Chi tiết RF-M-01 — Rewards future mobile

Mobile giữ nguyên information hierarchy và content meaning của desktop.

Khác biệt:

- Heading, copy và cards dùng một cột.
- Hero actions full-width và xếp dọc.
- Capability cards dùng icon ở trái, copy ở phải.
- Lifecycle chuyển thành bốn stacked rows.
- Wallet boundary là nested surface riêng trong lifecycle card.
- CTA cuối full-width.

Containment bắt buộc:

| Container             | Horizontal inset |                                          Bottom inset |
| --------------------- | ---------------: | ----------------------------------------------------: |
| Hero actions          |           `24px` |               tối thiểu `24px`; Figma hiện tại `35px` |
| Lifecycle wallet note |           `20px` |               tối thiểu `24px`; Figma hiện tại `32px` |
| Final guidance action |           `20px` | tối thiểu `24px`; sai số render `23px` được chấp nhận |

Không giảm frame xuống `820px` hoặc `844px` nếu việc đó làm mất phần content phía dưới. Frame
handoff phải biểu diễn trọn document flow.

## 11. BBE spacing và containment rules

Áp dụng token từ BBE Design System:

```text
4 / 8 / 12 / 16 / 24 / 32 / 48
```

Rules:

1. Page intro → hero: `32px`.
2. Section heading → cards: `32px` hoặc token tương đương đã định nghĩa trong pattern.
3. Sibling cards: tối thiểu `12px` trên mobile và `16px` trên desktop.
4. Card outer padding: `20–32px` tùy density, nhưng phải nhất quán trong cùng section.
5. Nested surface inset: `24px` left/right/bottom trên desktop.
6. Action → parent bottom border: target `32px`, không bao giờ dưới `24px`.
7. Action → annotation/copy tiếp theo: `24px`.
8. Không dùng negative margin để kéo button sát border.
9. Không absolute-position action row trong card.
10. Mọi card chứa card con phải tính cả bottom padding của card cha.
11. Content frame phải có bottom inset không âm và không đi vào footer.
12. Mobile document được phép dài hơn viewport; không dùng fixed height để clip nội dung.

Containment đã được QA trong Figma:

| Check                                     |                     Inset |
| ----------------------------------------- | ------------------------: |
| Desktop lifecycle → wallet boundary       | `24px` mọi phía liên quan |
| Desktop guidance → action bottom          |                  `23.5px` |
| Mobile hero → secondary action bottom     |                    `35px` |
| Mobile lifecycle → wallet boundary bottom |                    `32px` |
| Mobile guidance → action bottom           |                    `23px` |
| Desktop content → frame bottom            |                   `144px` |
| Mobile content → frame bottom             |                    `62px` |

## 12. Target reward list behavior

Khi feature được triển khai, list item chỉ dùng server-authorized researcher data.

Mỗi row/card tối thiểu gồm:

- Program name.
- Report title hoặc safe report identifier.
- Final severity nếu đã có.
- Status badge.
- Approved reward khi backend trả về.
- Submitted timestamp.
- Paid timestamp khi status là `paid`.
- Transaction status/evidence nếu backend trả về.

Không hiển thị:

- Report description hoặc reproduction steps.
- Attachment filename trong list.
- Reviewer-only notes.
- Reward estimate thay cho approved amount.
- Transaction hash tự suy ra từ client cache.
- `Paid` khi chỉ có `reward_approved`.

Default ordering:

1. `payment_pending`.
2. `reward_approved`.
3. `paid`, mới nhất trước.

Filters tương lai:

- `All`.
- `Reward approved`.
- `Payment pending`.
- `Paid`.

Filter là status filter, không được đổi domain state.

## 13. Data và API contract

### Dữ liệu hiện có

`ReportSummary` hiện cung cấp:

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

Researcher có thể dùng:

```text
GET /api/reports
GET /api/reports/:id
```

với authorization hiện tại: researcher chỉ nhận report của chính mình.

Transaction lookup hiện có:

```text
GET /api/transactions/:hash
```

Program transaction listing hiện có:

```text
GET /api/programs/:id/transactions
```

Endpoint program transaction không được dùng để lộ transaction của report mà researcher không có
quyền xem.

### Backend settlement actions

Các action này chỉ dành cho owner/reviewer:

```text
POST /api/reports/:id/approve-reward
POST /api/reports/:id/pay
POST /api/reports/:id/confirm-payment
```

Researcher Reward UI là read-only đối với ba transition trên.

### Gap trước khi làm Reward center thật

API report summary hiện chưa đảm bảo trả:

- Reward approval timestamp.
- Payment transaction hash.
- Token address và chain ID theo report.
- Transaction confirmation count/status.
- Confirmed block number/hash.

Trước khi biến preview thành dashboard thật, backend phải cung cấp read model researcher-safe cho
những field này. Có thể mở rộng report response hoặc tạo endpoint aggregation riêng; không query
Supabase trực tiếp trong React component.

Nếu tạo endpoint mới, contract khuyến nghị:

```text
GET /api/rewards?page=&limit=&status=
```

Response item:

```ts
type ResearcherRewardSummary = {
  reportId: string;
  programId: string;
  programName: string;
  reportTitle: string;
  finalSeverity: Severity;
  status: 'reward_approved' | 'payment_pending' | 'paid';
  approvedReward: string;
  rewardApprovedAt: string;
  payment?: {
    chainId: string;
    tokenAddress: string;
    transactionHash: string;
    status: 'pending' | 'confirmed' | 'failed';
    confirmations?: number;
    confirmedAt?: string;
  };
  paidAt?: string;
};
```

Rules:

- Server lấy researcher ID từ authenticated principal, không nhận researcher ID tùy ý từ client.
- Monetary values là decimal string, không dùng JavaScript floating point.
- `payment` chỉ có khi transaction thực sự tồn tại và user được phép xem report.
- `paidAt` bắt buộc khi status là `paid`.
- Không serialize private report content.

## 14. Wallet rules

Wallet không thuộc onboarding, browsing hoặc submit-bug flow.

Khi reward flow cần payout wallet:

1. Giải thích tại sao địa chỉ cần thiết.
2. Chỉ chấp nhận EVM address hợp lệ.
3. Hiển thị network/token cố định của MVP: Arc và USDC.
4. Mask address trong summary; vẫn cho copy đầy đủ bằng explicit action.
5. Yêu cầu confirmation trước khi thay wallet nếu đang có reward approved/pending.
6. Backend phải kiểm tra ownership/role và ghi audit trail.
7. Không lưu private key, seed phrase hoặc wallet signature không cần thiết.
8. Không dùng connected wallet address làm authorization identity.

`PATCH /api/me` hiện chỉ cho sửa `displayName`. Không được âm thầm mở rộng endpoint đó để update
wallet. Wallet write cần một contract/backend task riêng với validation, authorization và audit
được review.

## 15. Loading, empty và error states tương lai

### Loading

- Giữ researcher shell ổn định.
- Dùng skeleton có kích thước gần list thật.
- Không hiển thị `0 USDC` trong khi chưa có response.

Copy:

```text
Loading your reward activity…
```

### Empty

Heading:

```text
No reward activity yet
```

Body:

```text
Validated reports will appear here after an authorized reviewer approves a reward.
```

Actions:

- `View my reports`.
- `Browse programs`.

Empty state không yêu cầu user connect wallet.

### Error

Heading:

```text
We couldn’t load your rewards
```

Body:

```text
Your reports and settlement records have not changed. Try loading them again.
```

Action:

```text
Retry
```

Không dựng cached amount thành current truth nếu request refresh thất bại.

### Session expired

- Không flash reward data.
- Điều hướng tới login với safe internal `returnTo=/rewards`.
- Không nhận external URL làm return path.

### Wrong role

- Dùng safe forbidden screen.
- Không render researcher reward list trước khi profile/role được xác nhận.

## 16. Accessibility

- Mọi interactive target tối thiểu `44 × 44px`.
- Status luôn có text; không dùng màu đơn lẻ.
- Icon decorative dùng `aria-hidden="true"`.
- Transaction hash có accessible label đầy đủ.
- Copy action thông báo thành công bằng live region nhưng không tự move focus.
- Loading/error được announce hợp lý.
- Focus order đi theo document flow.
- Không remove global focus-visible outline.
- Link external transaction explorer phải nói rõ mở external destination.
- Motion phải tôn trọng `prefers-reduced-motion`.
- Contrast theo BBE dark theme; mint text không dùng trên surface có contrast không đạt.

## 17. Security và privacy

1. Researcher chỉ xem reward của report do mình sở hữu.
2. Frontend không lấy application data trực tiếp từ Supabase.
3. API dùng authenticated principal và authorization guard.
4. Không log report title nếu logging policy coi title là sensitive; tuyệt đối không log report
   content, PoC hoặc attachment URL.
5. Signed attachment URLs không xuất hiện trong Reward center.
6. Transaction evidence không chứng minh report content được public.
7. Không dùng wallet address để suy ra role.
8. Không cho AI output trigger settlement transition.
9. Không gọi owner/reviewer settlement endpoints từ researcher UI.
10. Không hiển thị private total paid của program nếu visibility policy không cho phép.

## 18. Figma component mapping

Ưu tiên reuse:

| UI                    | BBE asset                                        |
| --------------------- | ------------------------------------------------ |
| Desktop header        | `Header / Desktop · Researcher`                  |
| Desktop footer        | `Footer / Desktop · Short`                       |
| Primary action        | `Button / Large / Primary`                       |
| Secondary action      | `Button / Large / Secondary`                     |
| Status                | `Status Badge`                                   |
| Validated             | Lucide `shield-check`                            |
| Reward approved       | Lucide `circle-check`                            |
| Payment pending       | Lucide `clock`                                   |
| Paid                  | Lucide `circle-check` + mint completed treatment |
| Approval capability   | Lucide `file-text`                               |
| Settlement capability | Lucide `external-link`                           |
| Wallet capability     | Lucide `wallet`                                  |

Không dựng icon bằng rotated line primitives. Dùng Lucide component hoặc icon asset hiện có.

## 19. QA scenarios

### Current future preview

1. Desktop `1440 × 1368` hiển thị đủ header, content và footer.
2. Mobile `390 × 2200` hiển thị đủ hai hero buttons.
3. Mobile lifecycle hiển thị đủ wallet boundary note.
4. Final CTA không chạm hoặc vượt border card.
5. Desktop wallet boundary có bottom inset `24px`.
6. Không có frame desktop/mobile overlap trong section.
7. Chỉ dùng Inter.
8. Không có fake amount, fake date hoặc fake transaction.
9. `View/Open my reports` có destination code `/reports`.
10. `Browse programs` có destination code `/programs`.

### Target feature

1. Researcher không có reward → empty state, không yêu cầu wallet.
2. Report `validated` nhưng chưa approve → chưa xuất hiện như approved reward.
3. Report `reward_approved` → hiển thị approved amount, chưa hiển thị `Paid`.
4. Report `payment_pending` → hiển thị pending transaction và confirmation state.
5. Report `paid` → hiển thị paid timestamp và confirmed evidence.
6. Missing transaction evidence → không tự suy ra hash hoặc `Paid`.
7. API error → retry, không tạo amount giả.
8. Session expired → không flash data.
9. Owner/reviewer mở researcher-only route → safe forbidden hoặc role-appropriate redirect.
10. Researcher cố xem reward của report khác → API trả forbidden/not found theo security policy.
11. Invalid wallet → inline error có `aria-describedby`.
12. Wallet update trong lúc reward pending → explicit confirmation và audit.

## 20. Acceptance criteria

- [ ] Page được đặt đúng trong Figma page `Reward - future`.
- [ ] Desktop và mobile dùng researcher shell không có left sidebar.
- [ ] Feature được gắn nhãn `Future release` rõ ràng.
- [ ] Không render dữ liệu payout giả.
- [ ] Copy phân biệt human review, reward approval và blockchain settlement.
- [ ] Lifecycle dùng đúng `validated → reward_approved → payment_pending → paid`.
- [ ] `Paid` chỉ xuất hiện khi settlement đã được backend xác nhận.
- [ ] Wallet không xuất hiện như requirement của browsing hoặc submit flow.
- [ ] CTA hiện tại chỉ đưa user về Programs hoặc My reports.
- [ ] Card, nested surface và action tuân thủ BBE spacing/containment rules.
- [ ] Mobile frame dài đủ để không clip content.
- [ ] Font, color, icon và component reuse đúng BBE Design System.
- [ ] Future implementation có loading, empty, error, auth và wrong-role states.
- [ ] Researcher UI không gọi owner/reviewer settlement actions.
- [ ] API tương lai không lộ private report content hoặc reward của researcher khác.

## 21. Known limitations

- Reward page chưa reachable trong app hiện tại.
- Account menu vẫn hiển thị `Rewards · Future` disabled.
- Figma CTA không thể prototype navigate cross-page tới Programs/Reports.
- Report response hiện chưa đủ transaction evidence để dựng Reward center hoàn chỉnh.
- Wallet write flow chưa có API contract được review.
- Page hiện tại là visual/product handoff; chưa phải cam kết feature đã triển khai.
