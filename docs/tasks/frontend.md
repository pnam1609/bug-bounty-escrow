# Next.js frontend tasks

Mỗi page hoặc user action độc lập là một task riêng. Frontend không truy cập database bằng Supabase client; application data đi qua NestJS API. Supabase browser client chỉ dùng cho auth session, và wallet client chỉ dùng cho user-signed blockchain actions.

## Frontend platform

| ID | Outcome | Depends on | Acceptance criteria |
|---|---|---|---|
| FE-PLT-001 | Bootstrap `apps/web` bằng Next.js App Router | FND-001, FND-002 | App build/start được; route groups tồn tại; server/client boundaries rõ ràng |
| FE-PLT-002 | Theme, responsive shell và navigation | FE-PLT-001, FND-007 | Public/owner/researcher navigation đúng role; mobile layout dùng được; keyboard focus visible |
| FE-PLT-003 | Typed NestJS API client | FE-PLT-001, BE-PLT-010 | Base URL từ env; token/error parsing tập trung; request/response types không khai báo trùng |
| FE-PLT-004 | TanStack Query provider và query-key factory | FE-PLT-003 | Cache keys ổn định; retry không áp dụng mù quáng cho mutation; devtools chỉ bật ở dev |
| FE-PLT-005 | Supabase auth session provider | FE-PLT-001, AUTH-001 | Session restore/refresh/logout hoạt động; access token được gắn vào API client; không lưu service role |
| FE-PLT-006 | Role-aware route protection | FE-PLT-005, AUTH-003 | Anonymous bị redirect khỏi protected routes; wrong role thấy forbidden state; không flash protected content |
| FE-PLT-007 | Shared loading, empty, error và confirmation UI | FE-PLT-002 | Components accessible; destructive/on-chain actions cần confirm; errors không hiển thị secrets |

## Authentication and onboarding

| ID | Outcome | Depends on | Acceptance criteria |
|---|---|---|---|
| FE-AUTH-001 | Login page | FE-PLT-005, AUTH-001 | Form validation, invalid credentials, pending state và safe return URL hoạt động |
| FE-AUTH-002 | Registration page | FE-PLT-005, AUTH-001 | Email/password validation; confirmation state rõ ràng; duplicate account error được xử lý |
| FE-AUTH-003 | Onboarding page | FE-PLT-006, AUTH-002, AUTH-003 | User hoàn thiện profile/chọn role được phép; reviewer option không xuất hiện |
| FE-AUTH-004 | Logout action | FE-PLT-005 | Local/server session được clear; private query cache bị xóa; redirect về public page |

## Public and owner program UI

| ID | Outcome | Depends on | Acceptance criteria |
|---|---|---|---|
| FE-PRG-001 | Public program listing page | FE-PLT-004, BE-PRG-001 | Pagination/filter/sort sync với URL; loading/empty/error states đầy đủ |
| FE-PRG-002 | Public program detail page | FE-PLT-004, BE-PRG-003 | Scope, rewards, pool, deadline và status hiển thị đúng; private fields không được render |
| FE-PRG-003 | Owner program list page | FE-PLT-006, BE-PRG-001 | Chỉ owner truy cập; draft/active/closed states phân biệt rõ; có link tới actions |
| FE-PRG-004 | Owner create-program form | FE-PLT-006, BE-PRG-002 | Multi-section form validate scopes/tiers; submit một lần; success điều hướng đúng |
| FE-PRG-005 | Owner edit-program form | FE-PLT-006, BE-PRG-003, BE-PRG-004 | Initial data được hydrate; chỉ editable fields bật; conflict/API errors giữ form data |
| FE-PRG-006 | Deploy escrow action | FE-PLT-007, FE-PRG-005, BE-PRG-005 | Confirm trước deploy; pending/confirmed/failed states rõ; retry không deploy trùng |
| FE-PRG-007 | Fund escrow action | FE-PLT-007, FE-PRG-002, BE-PRG-006, BC-002, BC-003 | Wallet/network/balance/allowance được kiểm tra; tx progress hiển thị; API sync sau receipt |
| FE-PRG-008 | Close program action | FE-PLT-007, FE-PRG-005, BE-PRG-007 | Hiển thị refund impact; confirm bắt buộc; closed state refresh sau completion |

## Researcher report UI

| ID | Outcome | Depends on | Acceptance criteria |
|---|---|---|---|
| FE-RPT-001 | Vulnerability report form | FE-PLT-006, FE-PRG-002, BE-RPT-002 | Validate scope/title/impact/reproduction/severity; autosave local draft an toàn; submit success rõ ràng |
| FE-RPT-002 | Private attachment upload action | FE-RPT-001, BE-ATT-001 | MIME/size pre-check; upload progress/cancel/retry; signed URL không persist vào logs/state dài hạn |
| FE-RPT-003 | Researcher submissions list | FE-PLT-004, FE-PLT-006, BE-RPT-001 | Chỉ data của current user; status filters và pagination hoạt động; empty state có CTA |
| FE-RPT-004 | Researcher report detail | FE-PLT-006, BE-RPT-003 | Nội dung/status/timeline/reward hiển thị đúng; owner-only actions không render |
| FE-RPT-005 | Edit eligible report action | FE-RPT-004, BE-RPT-004 | Chỉ state được phép hiện edit; validation giống create; immutable fields không có control |
| FE-RPT-006 | Download private attachment action | FE-RPT-004, BE-ATT-002 | Link chỉ lấy khi click; expired URL được refresh; download error không lộ storage path |
| FE-RPT-007 | Report comment thread | FE-RPT-004, BE-CMT-001 | Pagination/order đúng; empty/error state đầy đủ; author/time accessible |
| FE-RPT-008 | Add report comment action | FE-RPT-007, BE-CMT-002 | Empty/oversized body bị chặn; optimistic state rollback khi lỗi; không submit trùng |

## Owner and reviewer workflow UI

| ID | Outcome | Depends on | Acceptance criteria |
|---|---|---|---|
| FE-REV-001 | Owner/reviewer report inbox | FE-PLT-004, FE-PLT-006, BE-RPT-001 | Filters program/status/severity hoạt động; role scope đúng; unread/needs-action dễ nhận biết |
| FE-REV-002 | Review detail page | FE-REV-001, BE-RPT-003, FE-RPT-006, FE-RPT-007 | Report, attachments, comments và audit timeline hiển thị; sensitive content không prefetch ngoài quyền |
| FE-REV-003 | Trigger AI triage action/panel | FE-REV-002, BE-RPT-005 | Action không tự chạy khi mở page; loading/failure/invalid-output states rõ; result chỉ mang tính đề xuất |
| FE-REV-004 | Request-information action | FE-REV-002, BE-RPT-006 | Reason bắt buộc; confirm state transition; result refresh timeline/status |
| FE-REV-005 | Validate-report action | FE-REV-002, BE-RPT-007 | Final severity bắt buộc; transition impact hiển thị; duplicate submit bị chặn |
| FE-REV-006 | Reject-report action | FE-REV-002, BE-RPT-008 | Reason bắt buộc; destructive confirmation; paid report không hiện action |
| FE-REV-007 | Mark-duplicate action | FE-REV-002, BE-RPT-009 | Original report search/select hợp lệ; không chọn chính report; linked report hiển thị sau success |
| FE-REV-008 | Approve-reward action | FE-REV-002, BE-RPT-010 | Tier/range/remaining pool hiển thị; amount validation; nhấn approve không tự payout |
| FE-REV-009 | Pay-reward action | FE-REV-002, FE-REV-008, BE-RPT-011 | Recipient/token/amount/network confirm rõ; idempotency được giữ qua retry; tx link hiển thị |

## Transaction UI

| ID | Outcome | Depends on | Acceptance criteria |
|---|---|---|---|
| FE-TX-001 | Program transaction list | FE-PLT-004, BE-TX-001 | Type/status filters, pagination và explorer links đúng chain |
| FE-TX-002 | Transaction detail page | FE-PLT-004, BE-TX-002 | Hash, status, confirmations, amount, token và related entity hiển thị; pending refresh có giới hạn |

## Frontend task guardrails

- Mỗi page task phải có loading, empty, error và unauthorized state nếu phù hợp.
- Mỗi mutation task phải chặn double-submit và xác định cache cần invalidate.
- Không coi disabled button là authorization; backend vẫn là source of truth.
- Không render report content vào analytics, error tracking hoặc client logs.
- Không thêm API call trực tiếp ngoài typed API client.
