# Bug Bounty Escrow — Project Context

> **Nguồn sự thật.** Requirement chi tiết nằm trong [`docs/flow/`](docs/flow/). Khi tài liệu này
> mâu thuẫn với flow doc, flow doc thắng. Shared Zod contracts, OpenAPI và database migrations là
> bằng chứng implementation hiện hành; không duy trì một bản contract Markdown song song.

## 1. Ý tưởng sản phẩm

Xây dựng một nền tảng bug bounty dành cho Web3, trong đó:

- Project owner tạo bug bounty program.
- A single `BountyEscrowAdmin` contract is deployed once by the platform admin. It collects the
  per-program platform/deployment fee, registers each program escrow, and provides the admin
  treasury withdrawal path for fees only. It must never withdraw a program's reward pool.
- Backend deploys one program-specific `BountyEscrow` contract per program through the
  `BountyEscrowAdmin` control plane using a server-controlled Circle Developer-Controlled
  deployment wallet (the operational gas signer). The program escrow stores the verified program
  owner/funder as its owner authority; the admin contract is an emergency operator, not the program
  funds' withdrawal recipient.
- Before deployment, the owner pays the server-quoted platform/deployment fee into
  `BountyEscrowAdmin`. Deployment is blocked until that payment is reconciled and marked paid (or
  an explicit admin waiver is recorded).
- Owner funding still goes directly from the connected owner wallet (Send, Bridge or Unified Balance)
  to the escrow address; the admin wallet is never an intermediary for reward-pool funds.

Operationally, `BountyEscrowAdmin.adminWallet` is the address returned by the configured
`CIRCLE_DEPLOYMENT_WALLET_ID`; there is no separate admin-wallet or treasury environment
variable. The backend uses that signer to register each Circle-deployed program escrow and
execute audited emergency support calls. The controller's fee withdrawal destination is this
same immutable on-chain address and must never be substituted for a program owner wallet.
- Security researcher gửi vulnerability report.
- Reviewer kiểm tra và xác nhận report.
- Khi report được chấp nhận, smart contract thanh toán USDC trực tiếp cho researcher.
- AI chỉ hỗ trợ triage, không tự quyết định report hợp lệ hay mức payout.

Điểm khác biệt chính của sản phẩm:

```text
Guaranteed Escrow
+
Transparent Reward Pool
+
Instant USDC Settlement
```

AI chỉ là tính năng hỗ trợ:

```text
AI-assisted triage
```

không phải core của sản phẩm.

---

## 2. Workflow chính

```text
Owner creates program
        ↓
Defines scope and reward tiers
        ↓
Pays deployment fee and requests backend deployment
        ↓
Funds escrow with USDC
        ↓
Researcher submits report
        ↓
Automatic AI-assisted review is queued (when enabled; non-blocking)
        ↓
Human reviewer validates report
        ↓
Owner approves reward
        ↓
Escrow releases USDC
        ↓
Researcher sees transaction and paid status
```

Report state machine:

```text
DRAFT
  ↓
SUBMITTED
  ↓
TRIAGED
  ├── NEEDS_INFORMATION
  ├── REJECTED
  ├── DUPLICATE
  └── VALIDATED
          ↓
     REWARD_APPROVED
          ↓
     PAYMENT_PENDING
          ↓
         PAID
```

---

## 3. Vai trò trong hệ thống

### Platform Admin

- Owns/administers `BountyEscrowAdmin` and its role configuration.
- Receives platform fees from program owners and may withdraw only the accumulated fee pool from
  `BountyEscrowAdmin` to the Circle deployment wallet returned for `CIRCLE_DEPLOYMENT_WALLET_ID`.
- Deploys/registers program-specific `BountyEscrow` instances through the backend/Circle deployment
  wallet.
- May perform emergency support actions that are normally owned by the program owner (pause,
  deactivate, close, timeline extension/edit and reward-approval execution) when policy and audit
  require it.
- **Must never withdraw remaining funds from a program's `BountyEscrow`.** Program reward-pool
  withdrawals are reserved for that program's owner authority.

### Project Owner

- Tạo bounty program.
- Định nghĩa scope.
- Định nghĩa reward tiers.
- Pay the quoted platform/deployment fee into `BountyEscrowAdmin` and request deployment; the
  backend/Circle deployment wallet performs deployment, while the program escrow records the owner
  authority separately.
- Fund USDC.
- The first verified owner funding wallet is stored/bound as the program escrow's owner authority
  and remaining-funds withdrawal recipient. It is not inferred from a client-supplied address.
- Normally execute program lifecycle controls: pause, close, edit/extend timeline and
  approve rewards for paid researchers. The platform admin may assist these actions only for
  emergency support.
- After the program is closed/unlocked and all approved rewards are settled, withdraw only the
  remaining funds from that program's escrow to the bound owner wallet. The platform admin cannot
  perform this withdrawal.
- Review report.
- Yêu cầu thêm thông tin.
- Validate hoặc reject.
- Approve reward.
- Thực hiện payout/approve researcher reward theo policy; payout transfer vẫn đi qua escrow rules.

### Researcher

- Xem danh sách bounty program.
- Xem scope và reward.
- Gửi vulnerability report.
- Upload PoC hoặc attachment.
- Trả lời yêu cầu bổ sung.
- Theo dõi trạng thái.
- Nhận USDC.

### Reviewer

Trong MVP, owner có thể đồng thời là reviewer.

Reviewer:

- Đọc report.
- Xem AI suggestion.
- Kiểm tra PoC.
- Chọn final severity.
- Validate, reject hoặc đánh dấu duplicate.

---

## 4. Phạm vi AI

Không dùng AI để:

- Quyết định bug có hợp lệ hay không.
- Tự động chọn payout.
- Tự động release USDC.
- Phân tích toàn bộ video.
- Thay thế human reviewer.

AI chỉ hỗ trợ:

- Tóm tắt report.
- Kiểm tra report có đầy đủ không.
- Gợi ý severity.
- Gợi ý in-scope hoặc out-of-scope.
- Liệt kê thông tin còn thiếu.
- Kiểm tra duplicate trong cùng program theo canonical submission order.

Structured output:

```ts
type ReportFingerprint = {
  affectedComponents: string[];
  functions: string[];
  attackVector: string;
  vulnerabilityClasses: string[];
  prerequisites: string[];
  securityImpacts: string[];
  normalizedSummary: string;
};

type TriageResult = {
  summary: string;
  completenessScore: number;
  suggestedSeverity: 'critical' | 'high' | 'medium' | 'low' | 'informational';
  scopeAssessment: 'in_scope' | 'out_of_scope' | 'uncertain';
  missingInformation: string[];
  confidence: number;
  duplicateAssessment: 'none' | 'possible' | 'likely';
  duplicateConfidence: number;
  fingerprint: ReportFingerprint;
  // Chỉ owner/reviewer đã re-authorize được nhận candidate IDs.
  duplicateCandidateReportIds: string[];
};
```

AI provider interface:

```ts
interface TriageProvider {
  analyzeReport(input: TriageInput): Promise<TriageResult>;
}
```

Providers:

```text
MockTriageProvider
GeminiTriageProvider
OpenAIProvider
ClaudeProvider
GroqProvider
OpenRouterProvider
```

Mỗi successful submit/resubmit tự động enqueue đúng một AI run cho immutable revision/content hash.
Queue được persist trong PostgreSQL và serialize FIFO theo từng program (`concurrency = 1/program`) để
hai report giống nhau submit đồng thời vẫn có thứ tự canonical; các program khác được xử lý song song.
AI result được validate rồi persist trước khi UI đọc và không tự đổi report status.
AI pass 1 tạo `ReportFingerprint`; BE dùng fingerprint + deterministic signals để shortlist các prior
sequence trong cùng program; AI pass 2 mới so sánh chi tiết với top candidates. Scope/impact researcher
chọn không được dùng làm hard filter.

Gemini provider pin exact stable model `gemini-3.5-flash`, không dùng `latest` alias. Free tier chỉ
được dùng cho synthetic/demo/non-confidential data: Gemini unpaid-service terms không phù hợp để gửi
private vulnerability report thật. Report thật yêu cầu billing-enabled Gemini project/provider có
privacy terms phù hợp; AI disabled/quota/error không được chặn submit hoặc human review.

---

## 5. Tech stack đề xuất

```text
Monorepo: Turborepo + pnpm
Frontend: Next.js 15
Backend: NestJS
API style: REST
UI: shadcn/ui + Tailwind v4 (Radix primitives, Lucide icons, Inter)
Design system: BBE Design System — Figma Zdx9FTCAedUZ5R3phehFAp
Forms: React Hook Form + Zod
Server state: TanStack Query
Database: Supabase PostgreSQL
Authentication: Supabase Auth
Storage: Supabase Storage
Realtime: Supabase Realtime
Smart contracts: Solidity
Contract development: Foundry
Blockchain client: viem + wagmi
Blockchain: Arc Testnet
Payment token: USDC
AI: Gemini API
Testing: Vitest + Supertest + Playwright + Foundry
CI: GitHub Actions
Deployment: Vercel (web) + container platform (API) + Supabase
```

NestJS là backend duy nhất chứa application services, business logic và database access.

Next.js chỉ phụ trách frontend. Không đặt business logic trong Route Handlers hoặc Server Actions.

Frontend gọi NestJS qua REST API. NestJS xác thực Supabase access token bằng guard, phân quyền theo role và truy cập Supabase bằng server-side credentials.

---

## 5b. Design system

Nguồn sự thật là Figma `Zdx9FTCAedUZ5R3phehFAp`:

| Page                        | Nội dung                                                              |
| --------------------------- | --------------------------------------------------------------------- |
| `BBE Design System` (`2:3`) | Foundations, tokens, components, variants, patterns, icons, app shell |
| `Layouts` (`55:2`)          | Landing, Sign In, Sign Up, section Onboarding, section Create program |
| `researcher` (`114:92`)     | Bounty table, Program detail, Submit bug                              |

Token được port vào `packages/ui/src/theme.css` dưới dạng Tailwind v4 `@theme`. **Component không
được viết hex thô hay px cứng** — chỉ dùng utility ánh xạ token. Quy ước đầy đủ trong
`packages/ui/CONVENTIONS.md`.

Sản phẩm chỉ có một thế giới thị giác dark; không có light theme. Violet là primary/current, mint
dành riêng cho escrow và trạng thái hoàn tất, đỏ chỉ dùng cho error/destructive.

Hai chỗ Figma và flow doc lệch nhau, đã theo flow doc:

- **Submit bug**: Figma còn 4 bước cũ `Scope/Details/Proof/Review` với textarea `Impact` free
  text. Đã build theo doc: `Assets & Impact / Severity / Main Report / Review`. Dựng đúng Figma sẽ
  ra UI không gọi được API.
- **Bounty table caption**: §11 ghi "Active bounty programs" nhưng §6 nói list gồm cả ended.

---

## 6. Kiến trúc tổng thể

```text
┌─────────────────────────────────────┐
│             Next.js App             │
│                                     │
│ Public programs                     │
│ Owner dashboard                     │
│ Researcher dashboard                │
│ Report review UI                    │
│ Wallet connection                   │
└──────────────────┬──────────────────┘
                   │ REST API
                   ▼
┌─────────────────────────────────────┐
│              NestJS API             │
│                                     │
│ Auth Guards + Role Guards           │
│ Program Module                      │
│ Report Module                       │
│ Review Module                       │
│ Payment Module                      │
│ AI Triage Module                    │
└───────────────┬─────────────────────┘
                │
       ┌────────┴────────┐
       ▼                 ▼
┌──────────────┐  ┌──────────────────┐
│   Supabase   │  │   Arc Testnet    │
│              │  │                  │
│ PostgreSQL   │  │ BountyEscrowAdmin│
│ Auth         │  │ BountyEscrow per │
│ Storage      │  │ program + USDC   │
│ Realtime     │  │ payout/refund    │
└──────────────┘  └──────────────────┘
```

Blockchain chỉ quản lý:

- `BountyEscrowAdmin` platform fee pool, program registry và emergency controls.
- Escrow.
- USDC.
- Payout.
- Refund.
- Report hash.
- Transaction events.

Blockchain không lưu:

- Vulnerability description.
- PoC.
- Video.
- Logs.
- Private attachments.

---

## 7. Monorepo structure

```text
bug-bounty-escrow/
├── apps/
│   ├── web/
│   │   ├── app/
│   │   │   ├── (public)/
│   │   │   │   ├── programs/
│   │   │   │   └── programs/[slug]/
│   │   │   ├── owner/
│   │   │   │   ├── programs/
│   │   │   │   ├── reports/
│   │   │   │   └── transactions/
│   │   │   └── researcher/
│   │   │       ├── submissions/
│   │   │       └── rewards/
│   │   ├── components/
│   │   ├── features/
│   │   ├── hooks/
│   │   └── lib/
│
│   └── api/
│       ├── src/
│       │   ├── common/
│       │   │   ├── decorators/
│       │   │   ├── filters/
│       │   │   ├── guards/
│       │   │   ├── interceptors/
│       │   │   └── pipes/
│       │   ├── config/
│       │   ├── modules/
│       │   │   ├── auth/
│       │   │   ├── programs/
│       │   │   ├── reports/
│       │   │   ├── reviews/
│       │   │   ├── payments/
│       │   │   └── triage/
│       │   ├── app.module.ts
│       │   └── main.ts
│       └── test/
│
├── packages/
│   ├── contracts/
│   │   ├── src/
│   │   ├── test/
│   │   ├── script/
│   │   └── abi/
│   │
│   ├── database/
│   │   ├── migrations/
│   │   ├── repositories/
│   │   ├── seed/
│   │   └── types/
│   │
│   ├── domain/
│   │   ├── program/
│   │   ├── report/
│   │   ├── payment/
│   │   └── user/
│   │
│   ├── blockchain/
│   │   ├── clients/
│   │   ├── contracts/
│   │   └── events/
│   │
│   ├── ai/
│   │   ├── providers/
│   │   ├── prompts/
│   │   ├── schemas/
│   │   └── services/
│   │
│   ├── shared/
│   │   ├── constants/
│   │   ├── schemas/
│   │   ├── types/
│   │   └── utils/
│   │
│   └── ui/                        # BBE component library (source-only, transpiled by Next)
│       ├── CONVENTIONS.md          # binding rules: tokens only, no raw hex, a11y floor
│       ├── src/theme.css           # Tailwind @theme — ported from Figma variables
│       ├── src/components/         # shadcn-shaped primitives + BBE domain components
│       └── test/
│
├── docs/
│   └── flow/                      # requirement chi tiết, ưu tiên cao nhất
│
├── .github/
│   └── workflows/
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

---

## 8. Domain models

Định nghĩa chuẩn nằm trong `packages/domain`; phần dưới chỉ tóm tắt.

### Program

```ts
type ProgramStatus =
  | 'draft'
  | 'awaiting_funding'
  | 'active'
  | 'paused'
  | 'deactivated'
  | 'expired'
  | 'closed';

// Lifecycle mà người xem ẩn danh nhìn thấy. draft/awaiting_funding/paused/deactivated
// không có biểu diễn public nào.
type PublicProgramStatus = 'active' | 'ended';

type BountyProgram = {
  id: string;
  ownerId: string;
  name: string;
  slug: string;
  shortSummary: string;
  description: string;
  websiteUrl?: string;
  logoUrl?: string;
  tags: string[];
  status: ProgramStatus;
  publicStatus: PublicProgramStatus | null;

  // Pool accounting: approve reward phải reserve, payout mới chuyển sang paid.
  totalPool: string; // đã fund vào escrow
  reservedPool: string; // đã approve nhưng chưa payout
  remainingPool: string; // = totalPool - reservedPool - paidPool
  totalPaid: string | null; // null khi owner để private
  totalPaidVisibility: 'public' | 'private';
  maxBounty: string;

  contractAddress?: string;
  // Server-maintained deployment gate; owner cannot mark this paid from the browser.
  deploymentFeeStatus:
    | 'not_required'
    | 'quoted'
    | 'awaiting_payment'
    | 'payment_submitted'
    | 'paid'
    | 'waived'
    | 'expired'
    | 'failed';
  deploymentFeeQuoteId?: string;
  deploymentFeeAmount?: string;
  deploymentFeeToken?: string;
  deploymentFeeChainId?: string;
  deploymentFeePaidAt?: string;
  deploymentFeePaymentTxHash?: string;
  deploymentStatus: 'not_started' | 'blocked_fee' | 'pending' | 'confirmed' | 'failed';
  deadline?: string;
  publishedAt?: string;
};
```

### Scope

MVP chỉ render `smart_contract` và `website`. `api` và `mobile` vẫn nằm trong `ASSET_TYPES`
để mở rộng sau, nhưng write endpoint **reject** hai type đó — nếu chấp nhận thì sẽ tạo ra asset
mà không màn hình nào quản lý được. Xem `PRODUCT_ENABLED_ASSET_TYPES` trong `packages/domain`.

```ts
type ProgramScope = {
  id: string;
  programId: string;
  assetType:
    | 'smart_contract'
    | 'website'
    | 'api' // enum-only, chưa enable
    | 'mobile'; // enum-only, chưa enable
  assetName: string;
  assetUrl?: string;
  contractAddress?: string;
  isInScope: boolean;
  description?: string;
  sortOrder: number;
  // Soft delete: report tham chiếu scope vĩnh viễn nên không được xoá cứng.
  archived: boolean;
};
```

### Impact catalog

Owner cấu hình danh sách impact theo asset type; researcher chọn từ danh sách này khi submit.

```ts
type ProgramImpact = {
  id: string;
  programId: string;
  assetType: AssetType;
  severity: Severity;
  title: string;
  description?: string;
  source: 'template' | 'custom';
  templateKey?: string;
  enabled: boolean;
  sortOrder: number;
};
```

Template impacts nằm trong `packages/domain` và được **copy** thành row program-owned lúc create,
để sửa template về sau không âm thầm đổi điều khoản của program đang chạy.

### Reward tier

Tier là duy nhất theo `(program, assetType, severity)` — không phải chỉ theo severity.

```ts
type Severity = 'critical' | 'high' | 'medium' | 'low' | 'informational';

type RewardTier = {
  assetType: AssetType;
  severity: Severity;
  calculationType: 'range' | 'flat' | 'percentage';
  minReward?: string; // range
  maxReward?: string; // range
  flatAmount?: string; // flat
  percentageBps?: number; // percentage
  maxRewardCap?: string; // percentage
  calculationNote?: string;
};
```

Với tier `percentage`, reviewer **không** nhập số tiền. Reviewer cung cấp
`calculationBasisAmount` (số tiền thực sự bị ảnh hưởng, đã verify); server tính
`min(basis × percentageBps / 10000, maxRewardCap)` rồi snapshot basis, bps, cap và số tiền
kết quả vào `report_reviews.metadata`. Percentage không phải guidance text.

Tier là snapshot có lịch sử: khi owner bỏ một tier đã từng định giá một reward được approve,
tier đó bị `archived_at` chứ không bị xoá.

### Report

```ts
type ReportStatus =
  | 'draft'
  | 'submitted'
  | 'triaged'
  | 'needs_information'
  | 'rejected'
  | 'duplicate'
  | 'validated'
  | 'reward_approved'
  | 'payment_pending'
  | 'paid';

// Impact được snapshot lúc submit: owner sửa catalog sau này không đổi nội dung
// lịch sử của report đã gửi.
type ReportImpact = {
  id: string;
  source: 'program' | 'custom';
  programImpactId?: string;
  title: string;
  severity?: Severity; // null với custom impact
  assetType: AssetType;
};

type VulnerabilityReport = {
  id: string;
  programId: string;
  researcherId: string;
  affectedScopeId: string;
  title: string;
  description: string;
  impacts: ReportImpact[]; // thay cho free-text `impact`
  reproductionSteps?: string; // bắt buộc khi program.pocPolicy = "required"
  secretGistUrl?: string; // optional, HTTPS; không thay thế PoC
  proposedSeverity: Severity;
  // Audit signal: researcher thấy proposed severity khác severity cao nhất trong các impact
  // đã chọn và vẫn tiếp tục. Không biến proposal thành final severity.
  severityMismatchAcknowledged: boolean;
  finalSeverity?: Severity;
  status: ReportStatus;
  contentHash: string; // hash gồm cả impact selection
  approvedReward?: string;
  submittedAt?: string;
  paidAt?: string;
};
```

`draft` chỉ tồn tại trong `localStorage` của browser; server tạo thẳng `submitted`.

### Program metrics

Server-derived, owner không nhập:

```text
resolvedAt              = review đầu tiên chuyển report sang rejected | duplicate | validated
medianResolutionSeconds = median(resolvedAt - reports.submitted_at)
totalAssetsInScope      = số scope in-scope chưa archive
```

`submitted_at` là lần submit đầu tiên, nên thời gian ở `needs_information` và thời gian chờ
resubmit đều được tính. `reward_approved` / `payment_pending` / `paid` là settlement và không
ảnh hưởng metric — đây là tốc độ ra quyết định review, không phải tốc độ thanh toán. UI phải
nói rõ điều này cạnh con số.

### Disclosure

```ts
type ReportDisclosure = {
  id: string;
  reportId: string;
  programId: string;
  decision: 'keep_private' | 'publish_summary' | 'publish_full';
  publicTitle?: string;
  publicSummary?: string;
  publicContent?: string;
  publicSeverity?: Severity;
  publishedAt?: string;
};
```

Bảng tách riêng khỏi `reports` để public query không bao giờ chạm nội dung private. Không có
implicit public, bulk auto-public hay public-by-timeout.

---

## 9. Database tables

```text
profiles
programs
program_scopes
program_reward_tiers
program_tags
program_resources
program_impacts
program_prohibited_activities
program_reviewers
reports
report_impacts
report_disclosures
report_attachments
report_comments
report_reviews
ai_triage_runs
ai_triage_results
escrow_contracts
escrow_transactions
notifications
audit_logs
```

Deployment fee payment is a separate durable projection. `deployment_fee_intents` stores the
server quote/version, amount in base units, token and chain, immutable `BountyEscrowAdmin`
recipient,
expiry, payment transaction/log evidence, status (`quoted`, `awaiting_payment`,
`payment_submitted`, `paid`, `waived`, `expired`, `failed`), idempotency key and audit timestamps.
`bounty_escrow_admin` stores the single `BountyEscrowAdmin` address, fee token/configuration and
allowlisted admin treasury. `escrow_contracts` stores `circle_deployment_wallet_id` (operational
gas signer), `bounty_escrow_admin_address` (controller) and the server-bound
`program_owner_address`/withdraw recipient separately. They must not be inferred from a later
Bridge/Unified Balance `Transfer.from`, and they may resolve to the same underlying wallet only when
an explicit deployment policy says so.
`programs.deployment_fee_status` is a server-maintained denormalized gate only; neither status nor
payment evidence is writable from the owner browser. Deployment may start only after `paid` or an
explicit audited `waived` state.

Important security rules:

- Public xem được program `active` và ended (`expired`/`closed`); `draft`,
  `awaiting_funding`, `paused` và `deactivated` không bao giờ xuất hiện trong listing công khai.
  Cột generated `programs.public_status` là ranh giới đó.
- Researcher chỉ xem report của chính mình.
- Owner chỉ xem report thuộc program của mình; reviewer chỉ xem program được assign.
- Report content không bao giờ public mặc định. Chỉ `report_disclosures` đã published
  mới đọc được công khai, và nội dung đó do owner tự viết.
- `totalPaid` được server quyết định visibility trước khi serialize; không trả số thật
  rồi che ở UI.
- Supabase service role chỉ chạy server-side.
- File attachments nằm trong private bucket; chỉ row `upload_status = 'uploaded'` được
  liệt kê hoặc tải về.
- Download attachment bằng signed URL, không persist URL.
- Không log report content hoặc API key.
- Tiền chỉ di chuyển qua SECURITY DEFINER RPC; role `authenticated` không có quyền
  UPDATE trên các cột pool.

---

## 10. Smart contract design

MVP có một platform controller duy nhất và một custom escrow cho mỗi program:

```text
Platform admin deploys BountyEscrowAdmin once on Arc Testnet
        ↓
BountyEscrowAdmin collects per-program platform fees and registers escrows
        ↓
Circle Contracts deploys one BountyEscrow 1.1.0 per program
        ↓
Direct canonical Arc USDC funding + multiple immutable reward payouts
```

`BountyEscrowAdmin` là controller/fee treasury, **không phải** pool của bất kỳ program nào.
Admin contract có thể register/deactivate/pause/close hoặc execute emergency support theo policy,
nhưng không có hàm và không có role để withdraw remaining funds từ một `BountyEscrow`.
Platform admin chỉ được withdraw platform fee đã thu trong chính `BountyEscrowAdmin` về đúng địa
chỉ Circle deployment wallet được resolve từ `CIRCLE_DEPLOYMENT_WALLET_ID`.

Mỗi `BountyEscrow` là contract riêng, giữ pool và reward state của đúng một program. Backend deploy
ABI/bytecode đã pin checksum qua Circle Contracts. Circle Developer-Controlled Wallet là
operational deployment wallet: nó deploy và trả gas. Program owner authority được bind bằng server
policy vào escrow owner field/withdraw recipient; không suy ra từ `Transfer.from` của một bridge hoặc
Unified Balance destination transfer. Owner wallet chỉ có quyền sau khi backend đã xác minh fee,
funding intent và wallet binding. Admin contract là emergency operator, không phải beneficiary của
program escrow.

Constructor canonical:

```solidity
constructor(
        bytes32 programKey,
        address programOwner,
        address escrowAdmin,
        address token,
        uint256 refundUnlockAt,
        address withdrawRecipient
);
```

- `token` phải là canonical Arc Testnet USDC
  `0x3600000000000000000000000000000000000000`, 6 decimals.
- `refundUnlockAt` do server derive chính xác từ `program.deadline`; thiếu deadline thì deploy fail
  closed.
- `escrowAdmin` là địa chỉ `BountyEscrowAdmin` được server cấu hình; client không được nhập hoặc
  override địa chỉ này. Circle deployment wallet ID là field/custody role riêng.
- `programOwner` là owner authority/remaining-funds recipient được bind từ verified owner account và
  funding intent. Với Bridge/Unified Balance, không dùng source transaction `from` làm quyền nếu
  chưa có server-side wallet binding; destination receipt chỉ chứng minh amount/net funding.
- `withdrawRecipient` bắt buộc bằng `programOwner`; admin controller không thể trở thành recipient
  của program remainder.
- `programOwner` không được thay đổi bằng client hoặc bằng một funding transfer khác. Nếu ownership
  transfer được hỗ trợ sau MVP, phải là explicit audited admin/owner action.
- Sau deployment confirmed, deadline không được sửa database-only. Nếu hỗ trợ extension, phải tăng
  lock on-chain trước, verify final receipt/state rồi mới cập nhật projection; không được shorten.

Interface target của artifact `1.1.0`:

```solidity
interface IBountyEscrow {
    function syncExternalFunding()
        external
        returns (uint256 newlyObserved);

    function approveReward(
        bytes32 reportKey,
        bytes32 approvedContentHash,
        address researcher,
        uint256 amount
    ) external;

    function payReward(bytes32 reportKey) external;

    function extendRefundUnlockAt(uint256 newUnlockAt) external;

    function pause() external;

    /// Only BountyEscrowAdmin may call this emergency soft-deactivation action.
    function deactivate() external;

    function close() external;

    function withdrawRemaining(uint256 expectedAmount)
        external
        returns (uint256 amount);

    function availableBalance()
        external
        view
        returns (uint256);

    function totalFunded()
        external
        view
        returns (uint256);

    function approvedOutstanding()
        external
        view
        returns (uint256);

    function isReportPaid(
        bytes32 reportKey
    ) external
        view
        returns (bool);
}
```

`BountyEscrowAdmin` tối thiểu phải expose:

```solidity
function registerProgram(bytes32 programKey, address escrow, address programOwner) external;
function deactivateProgram(bytes32 programKey) external;
function pauseProgram(bytes32 programKey) external;
function closeProgram(bytes32 programKey) external;
function extendProgramTimeline(bytes32 programKey, uint256 newUnlockAt) external;
function approveRewardEmergency(
    bytes32 programKey,
    bytes32 reportKey,
    bytes32 approvedContentHash,
    address researcher,
    uint256 amount
) external;
function withdrawPlatformFees(uint256 amount, address adminTreasury) external;
```

`withdrawPlatformFees` chỉ chuyển fee token của `BountyEscrowAdmin` tới an allowlisted admin
treasury. Không có `withdrawProgramFunds`, arbitrary `sweep(escrow, ...)`, callback hoặc delegatecall
path có thể chuyển token từ a program escrow. Program owner withdrawal phải đi qua
`BountyEscrow.withdrawRemaining` sau close/unlock/outstanding checks.

Primary funding không gọi `approve(escrow)`, `fund(amount)` hoặc native `msg.value`. Send, Bridge và
Unified Balance chuyển canonical Arc USDC trực tiếp từ owner source wallet tới escrow; admin wallet
và `BountyEscrowAdmin` không nhận, giữ hoặc forward pool funds. Backend verify exact destination
receipt/event, verify the locked owner/funding intent binding, rồi gọi permissionless
`syncExternalFunding()`.

Unified Balance source deposit còn có một Gateway subscription boundary bắt buộc:

- Môi trường test dùng stable permissionless subscription `TEST` với public HTTPS endpoint hỗ trợ
  `HEAD` để Circle validate endpoint và `POST` để nhận signed notification; subscription chỉ đăng ký
  exact event `gateway.deposit.finalized`.
- Trước source-deposit operation hoặc wallet signature, backend phải remote-verify connected owner
  wallet và toàn bộ selected source domains đã được đăng ký. Local cache/config hay một write response
  không đủ; mismatch, API uncertainty hoặc registration failure đều fail closed trước khi chuyển tiền.
- Membership update là durable serialized desired-state reconcile: merge remote state, persist
  revision/attempt và remote-verify sau write để concurrent intents không lost update.
- Capacity bị bound rõ ở tối đa 50 registered addresses/developer account. Hết capacity phải fail
  closed; không tự evict address khác. Không tự remove wallet/domain khi còn active, pending,
  uncertain hoặc recoverable deposit/delivery/`removeFund` operation.
- Circle-signed `gateway.deposit.finalized` vẫn là authority duy nhất cho Gateway finalization.
  Source RPC evidence là proof on-chain bổ sung; client balance/App Kit result, polling balance và
  registration state không được thay signed webhook.

Lifetime reconciliation:

```text
observedLifetimeInflow =
  token.balanceOf(escrow) + totalPaid + totalWithdrawn

newlyObserved = observedLifetimeInflow - totalFunded
```

`syncExternalFunding()` chỉ increment khi `newlyObserved > 0`, nên retry idempotent. Funding-intent
attribution dùng exact canonical Arc USDC destination receipt/event amount và yêu cầu post-sync
`totalFunded >= pre-sync totalFunded + attributed amount`. Không dùng pre/post live balance delta
làm amount hoặc equality gate vì permissionless payout có thể chạy giữa destination transfer và
sync.

Events chính:

```solidity
event EscrowInitialized(
    bytes32 indexed programKey,
    address indexed escrowAdmin,
    address indexed programOwner,
    address indexed token,
    uint256 refundUnlockAt
);

event ProgramRegistered(
    bytes32 indexed programKey,
    address indexed escrow,
    address indexed programOwner
);

event PlatformFeesWithdrawn(
    address indexed adminTreasury,
    uint256 amount
);

event ExternalFundingSynced(
    address indexed actor,
    uint256 newlyObserved,
    uint256 totalFunded
);

event RewardApproved(
    bytes32 indexed reportKey,
    bytes32 indexed approvedContentHash,
    address indexed researcher,
    uint256 amount
);

event RewardPaid(
    bytes32 indexed reportKey,
    address indexed researcher,
    uint256 amount
);

event EscrowClosed(address indexed actor);

event RemainingFundsWithdrawn(
    address indexed recipient,
    uint256 amount
);
```

Security requirements:

- `BountyEscrowAdmin` is the only platform controller. It may register/deactivate/pause/close a
  program escrow or execute an emergency support action, but it has no code path to withdraw from
  that escrow.
- Program owner authority is established by an explicit server-side owner/funding binding and stored
  as the escrow's immutable (or explicitly audited) `programOwner`/withdraw recipient. It is not
  inferred from `Transfer.from` for Bridge or Unified Balance, and a later arbitrary funder cannot
  silently replace it.
- Only the bound program owner may execute the program's owner operations and
  `withdrawRemaining`; the admin may support pause/deactivate/close/timeline/reward approval under
  an audited emergency path, but **never** program-fund withdrawal.
- Chỉ authorized owner or emergency-admin on-chain approver được tạo immutable reward snapshot;
  reviewer role trong database không tự động có contract role. The normal execution path is the
  owner; admin execution is an explicitly logged exception.
- Sau approval, `payReward(reportKey)` permissionless nhưng chỉ chuyển đúng recipient/amount đã
  snapshot; không payout cùng report hai lần và không payout vượt live available balance.
- `close()` is normally callable by the bound program owner; `BountyEscrowAdmin` may call it only via
  the emergency-support path and policy/audit. It is a one-way transition after `refundUnlockAt`
  and blocks new approvals while allowing already-approved payouts.
- `withdrawRemaining(expectedAmount)` is callable only by the bound program owner, after
  close/unlock and when `totalApprovedOutstanding == 0`. Neither `BountyEscrowAdmin` nor the admin
  treasury can call it or receive the program remainder.
- `expectedAmount` là exact 6-decimal base-unit snapshot từ server-verified withdrawal intent.
  Contract require live balance **ít nhất** snapshot rồi chỉ chuyển đúng snapshot tới owner-bound
  recipient; không require equality để tránh dust grief.
- Late/dust USDC vượt snapshot ở lại escrow. Backend scan/reconcile và tạo withdrawal intent +
  idempotency key mới; không reuse intent hoặc transaction hash đã complete.
- Transaction hash đã biết chỉ poll/reconcile, không ký lại. Unknown-after-sign đi vào recovery;
  deterministic revert kết thúc attempt cũ và retry bằng linked replacement intent.
- Dùng `SafeERC20`.
- Dùng `ReentrancyGuard`.
- Dùng checks-effects-interactions; không `SELFDESTRUCT`, native sweep hoặc wrapped-USDC path.
- Contract/integration tests bắt buộc cho unauthorized, duplicate sync/payout/withdraw, early
  close/withdraw, outstanding guard, exact-snapshot withdrawal, late-funds intent mới và concurrent
  payout giữa funding destination receipt với reconciliation.

---

## 11. API boundaries

Các endpoint dưới đây được triển khai bằng NestJS controllers. Controller chỉ xử lý HTTP concerns; business logic nằm trong services/domain services và database access nằm trong repositories.

Mọi protected endpoint phải đi qua Supabase JWT auth guard và role/ownership guard phù hợp. DTO đầu vào được validate bằng shared Zod schema qua NestJS validation pipe.

### Current user

```text
GET    /api/me
PATCH  /api/me
PATCH  /api/me/onboarding
```

`PATCH /api/me` chỉ sửa được `displayName`. Role cố định sau onboarding — cho sửa ở Account
settings sẽ thành đường vòng để đổi quyền. Email thuộc auth provider, payout wallet thuộc reward
flow riêng.

`GET /api/me` trả profile an toàn của user đã xác thực. Onboarding chỉ cho phép user tự chọn role `owner` hoặc `researcher`; role `reviewer` chỉ được cấp qua trusted admin workflow.

### Notifications

```text
GET    /api/me/notifications
POST   /api/me/notifications/read
```

### Programs — public

```text
GET    /api/programs
GET    /api/programs/:slug
GET    /api/programs/:id/disclosures
```

`GET /api/programs` chỉ trả program có `public_status` khác null. Query hỗ trợ `page`, `limit`,
`search`, `sort` (`newest|deadline|name|maxBounty|totalPaid`), `sortDirection`,
`status` (`active|ended`), `assetType`, `severity`, `minMaxReward`, `closing` (`7d|30d|ongoing`)
và `funded`. Active luôn được xếp trước ended.

`GET /api/programs/:id/disclosures` là Known Issues: chỉ đọc `report_disclosures` đã published.
`GET /api/programs/:slug` là canonical public detail lookup. Slug unique và immutable sau create;
UUID vẫn dùng cho owner mutations, report submission, foreign key và authorization nội bộ.

### Programs — owner

```text
GET    /api/owner/programs
GET    /api/owner/programs/:id
POST   /api/programs
PATCH  /api/programs/:id
POST   /api/programs/:id/logo/upload-url
POST   /api/programs/:id/escrow-deployment-fees/quote
POST   /api/programs/:id/escrow-deployment-fees/payment
GET    /api/programs/:id/escrow-deployment-fees/current
POST   /api/programs/:id/escrow-deployments
POST   /api/programs/:id/fund
POST   /api/programs/:id/publish
POST   /api/programs/:id/status
GET    /api/programs/:id/reviewers
POST   /api/programs/:id/reviewers
DELETE /api/programs/:id/reviewers/:reviewerId
```

Program lifecycle authorization is split explicitly: the owner is the normal authority for
`pause`, `close`, verified timeline extension and reward approval. Platform admin
support endpoints may execute those same actions only as audited emergency operations. There is no
admin endpoint that withdraws from a program escrow; only the verified program-owner wallet may
submit the escrow's remaining-funds withdrawal after close/unlock/outstanding checks. Admin treasury
withdrawal is limited to `BountyEscrowAdmin`'s accumulated platform-fee balance.

`deployment-fee` là một durable owner-payment flow. Server tạo quote với amount/token/network,
immutable `BountyEscrowAdmin` recipient và expiry; owner submits a direct payment from the connected
wallet; API chỉ đánh dấu `paid` sau khi verify exact token transfer/receipt tới admin contract.
Client-supplied
"paid" flags, balances hoặc transaction hashes không đủ bằng chứng. `POST /deploy` fail-closed nếu
fee status chưa `paid` hoặc `waived`, và khi accepted trả `pending` trong lúc Circle deployment
worker chạy bằng configured Circle deployment wallet; controller registration binds the verified
`BountyEscrowAdmin` address and the program owner authority/withdraw recipient.

Owner listing tách khỏi public listing để route công khai chỉ phục vụ dữ liệu công khai.
`POST /:id/status` xử lý `awaiting_funding`, `paused`, `deactivated`, `expired`, `closed`; publish có endpoint
riêng vì nó kiểm tra readiness (coverage, reward policy, escrow, funded pool).

### Reports

```text
GET    /api/reports
POST   /api/programs/:id/reports
GET    /api/reports/:id
PATCH  /api/reports/:id
POST   /api/reports/:id/triage
POST   /api/reports/:id/request-information
POST   /api/reports/:id/validate
POST   /api/reports/:id/reject
POST   /api/reports/:id/mark-duplicate
POST   /api/reports/:id/approve-reward
POST   /api/reports/:id/pay
POST   /api/reports/:id/confirm-payment
POST   /api/reports/:id/disclosure
```

`GET /api/reports` trả dữ liệu theo quyền của user hiện tại và hỗ trợ filter `programId`, `status`,
`severity` và `researcherId`. Researcher chỉ thấy report của mình; owner/reviewer chỉ thấy report
thuộc program được phép review.

`approve-reward` reserve số tiền vào `programs.reserved_pool`; `pay` ghi nhận transaction và
chuyển sang `payment_pending`; `confirm-payment` chuyển reserved → paid và đóng report.

Body của `approve-reward` phụ thuộc calculation type của tier:

```text
range | flat   → { "amount": "1500" }
percentage     → { "calculationBasisAmount": "50000" }   // amount bị bỏ qua
```

`/triage` là AI triage, thuộc milestone 3 và chưa được triển khai.

### Report collaboration

```text
POST   /api/reports/:id/attachments/upload-url
POST   /api/reports/:id/attachments/:attachmentId/complete
GET    /api/reports/:id/attachments/:attachmentId/download-url
GET    /api/reports/:id/comments
POST   /api/reports/:id/comments
```

Attachment endpoints chỉ cấp signed URL sau khi đã kiểm tra quyền truy cập report. Không proxy nội
dung private file qua application logs. Row attachment ở trạng thái `pending` cho tới khi
`/complete` xác nhận file đã lên, nên upload lỗi không tạo ra file ma trên report; gửi lại cùng
`attachmentId` là cách retry mà không tạo bản ghi trùng.

### Transactions

```text
GET /api/programs/:id/transactions
GET /api/transactions/:hash
```

### Error contract

Mọi business rule được enforce trong PostgreSQL atomic RPC và raise kèm mã máy đọc được. API map
mã đó thẳng vào `error.code` để client phân biệt được trạng thái (ví dụ
`program_not_accepting_reports` → màn hình "program closed") thay vì đoán từ text. Danh sách mã
nằm trong `API_ERROR_CODES` của `packages/shared`.

| SQLSTATE          | HTTP | Ý nghĩa                                        |
| ----------------- | ---- | ---------------------------------------------- |
| `22023`           | 409  | Business rule bị vi phạm ở trạng thái hiện tại |
| `42501`           | 403  | Actor không được phép thao tác trên bản ghi    |
| `P0002`           | 404  | Bản ghi không tồn tại                          |
| `28000`           | 401  | Thiếu authentication                           |
| `23505` / `40001` | 409  | Unique violation / optimistic concurrency      |

Frontend không query Supabase trực tiếp trong React component.

Frontend chỉ gọi NestJS API, ngoại trừ luồng Supabase Auth cần thiết để đăng nhập và nhận access token.

Database access phải đi qua repository được inject vào NestJS service.

---

## 12. Public data để seed database

Có thể tham khảo public disclosure từ:

- HackerOne Hacktivity.
- Immunefi disclosures.
- Code4rena reports.
- Sherlock audit findings.
- Cyfrin CodeHawks.
- Cantina.
- GitHub Security Advisories.
- CVE database.

Không phải tất cả bug đã fix đều được public.

Có ba trường hợp:

1. Public đầy đủ sau khi fix.
2. Chỉ public summary, severity và timeline.
3. Không public vì lý do bảo mật hoặc pháp lý.

Web3 audit contest thường public nhiều hơn bug bounty truyền thống.

Dữ liệu seed nên:

- Chỉ dùng report đã public.
- Rewrite lại nội dung.
- Đổi tên project và researcher.
- Không copy nguyên văn.
- Không dùng private exploit.
- Ghi chú đây là demo dataset dựa trên public disclosures.

Ví dụ seed:

```text
8–10 programs
30–80 reports
Multiple severity levels
Multiple statuses
Paid transaction history
Duplicate reports
Rejected reports
Needs-information reports
```

---

## 13. Task breakdown cho AI agents

Task status, dependencies và acceptance criteria nằm trong
[BountyEscrow Delivery Backlog](https://app.notion.com/p/BountyEscrow-Delivery-Backlog-3a9800c6e76e8117a06bfb49143fee52)
và [Tasks database](https://app.notion.com/p/06a0ee55892f4852bffd3b871ef4df8d). Luôn đọc task live
theo exact ID trước khi implement; không suy ra status từ code hoặc tài liệu lịch sử.

Mỗi task phải có một outcome nhỏ, dependency rõ ràng và acceptance criteria có thể kiểm tra độc lập.
Không gom nhiều API endpoint, nhiều màn hình hoặc nhiều smart contract action vào cùng một task.

---

## 14. Recommended implementation order

```text
1. Foundation
2. Database, Auth, RLS và Storage
3. NestJS platform tasks
4. Program CRUD APIs và public/owner program UI
5. Report APIs và researcher submission UI
6. Manual review APIs và owner/reviewer UI, chưa gồm AI và payout
7. Smart contracts và contract tests
8. Blockchain services, deploy/fund/pay/close APIs và transaction UI
9. End-to-end, security và demo tasks
10. Mock AI và triage endpoint/UI
11. Gemini provider nếu còn thời gian
```

Chỉ bắt đầu một task khi toàn bộ dependency ID của task đó đã hoàn thành. Thứ tự chi tiết và dependency nằm trong từng file task.

AI should be implemented last.

A working escrow and payout flow is more important than advanced AI.

---

## 15. AI development rules

Các rule sau áp dụng cùng `AGENTS.md`:

```text
1. Only modify files listed in the task.
2. Do not change public APIs unless explicitly requested.
3. Do not add dependencies without explaining why.
4. Do not place business logic inside React components.
5. Validate all API input with shared Zod schemas through a NestJS pipe.
6. Never expose Supabase service role to the browser.
7. Never store vulnerability content on-chain.
8. Never log report content, secrets or API keys.
9. Every report state transition must use a domain service.
10. Add or update tests for every task.
11. Run lint, typecheck and tests before completion.
12. Return a summary of changed files and assumptions.
13. Do not modify contract ABI manually.
14. Do not allow AI output to trigger payout automatically.
15. Do not let multiple agents edit the same shared file concurrently.
16. Keep NestJS controllers thin; business logic belongs in services/domain services.
17. Keep database access in repositories injected through NestJS dependency injection.
18. Do not implement backend business logic in Next.js Route Handlers or Server Actions.
```

---

## 16. Task template for AI

```md
# TASK-ID: Task title

## Goal

Describe one concrete outcome.

## Allowed files

- path/to/file/**
- path/to/another-file.ts

## Do not modify

- packages/contracts/**
- database migrations
- authentication logic

## Requirements

1. Requirement one.
2. Requirement two.
3. Requirement three.

## Technical constraints

- Use existing domain types.
- Validate API input with shared Zod schemas through a NestJS pipe.
- Keep controllers thin and business logic in services/domain services.
- Keep database access in repositories injected through NestJS dependency injection.
- Do not query Supabase directly inside React components; call the NestJS API.
- Do not introduce a new dependency unless necessary.

## Acceptance criteria

- Expected behavior works.
- Unauthorized users are rejected.
- Loading, empty and error states exist.
- Tests cover critical behavior.
- Typecheck, lint and tests pass.

## Deliverables

- Implementation.
- Tests.
- Changed-file summary.
- Assumptions.
- Known limitations.
```

---

## 17. Git workflow

Mỗi task dùng một branch riêng:

```text
main
├── feat/task-201-program-list
├── feat/task-301-report-form
├── feat/task-501-escrow-contract
└── feat/task-701-ai-triage
```

Workflow:

```text
Create task
    ↓
Create branch
    ↓
AI implements only allowed scope
    ↓
AI runs tests
    ↓
Human reviews diff
    ↓
Merge into main
```

Không cho hai AI cùng lúc sửa:

- Database schema.
- Shared types.
- Main layout.
- Contract interface.
- Generated ABI.
- Global configuration.

---

## 18. Milestones

### Milestone 1 — Off-chain MVP

```text
Programs
→ Submit report
→ Review report
→ Fake payout status
```

### Milestone 2 — Real Arc escrow

```text
Deploy escrow
→ Fund USDC
→ Approve reward
→ Real payout
```

### Milestone 3 — AI assistance

```text
Summary
→ Completeness
→ Severity suggestion
```

### Milestone 4 — Demo polish

```text
Seed data
→ Realtime updates
→ Error handling
→ Demo reset
→ End-to-end test
```

---

## 19. MVP priority

Must have:

- Public bounty programs.
- Owner program management.
- Private report submission.
- Review workflow.
- Escrow deployment.
- USDC funding tới canonical Arc escrow: Arc-only Send, đúng một non-Arc Bridge hoặc multi-source
  Unified Balance từ exact four testnets `Arc_Testnet`, `Ethereum_Sepolia`, `Arbitrum_Sepolia`,
  `Base_Sepolia`.
- USDC reward payout.
- Transaction tracking.
- Realistic seed data.
- Basic tests.

Optional:

- Gemini triage.
- Duplicate detection.
- Realtime notifications.
- Disputes.
- Public disclosure workflow.

Do not include in the first MVP:

- AI auto-approval.
- AI auto-payout.
- Token swap hoặc arbitrary multi-chain settlement ngoài fixed Arc escrow destination.
- Video analysis.
- Complex dispute court.
- Multi-chain settlement.
- Swap integration.
- Fully decentralized report storage.

---

## 20. Core design principle

The application should be built around four core bounded contexts:

```text
Program
Report
Escrow
Settlement
```

AI must remain optional.

The application must still work when:

- Gemini API is unavailable.
- AI output is invalid.
- AI quota is exceeded.
- AI feature is disabled.

The most important demo flow is:

```text
Owner creates bounty
→ Owner funds escrow
→ Researcher submits report
→ Owner validates report
→ Smart contract pays USDC
→ Researcher verifies payment
```
