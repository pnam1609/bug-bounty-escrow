# NestJS backend tasks

Mỗi endpoint bên dưới là một task riêng. Task endpoint bao gồm controller method, DTO/Zod schema, application service call, repository changes cần thiết, authorization và integration test cho chính endpoint đó.

Controllers chỉ xử lý HTTP concerns. Business logic nằm trong services/domain services; database access nằm trong injected repositories.

## Platform

| ID | Outcome | Depends on | Acceptance criteria |
|---|---|---|---|
| BE-PLT-001 | Bootstrap `apps/api` bằng NestJS | FND-001, FND-002 | API start/build/test được; global prefix là `/api`; graceful shutdown hoạt động |
| BE-PLT-002 | Global Zod validation pipe | BE-PLT-001, FND-006 | Invalid body/query/params trả `400` với stable error shape; unknown fields được xử lý theo contract |
| BE-PLT-003 | Config, CORS và environment validation | BE-PLT-001, FND-008 | Chỉ configured web origins được phép; startup fail fast khi thiếu env; secrets không log |
| BE-PLT-004 | Global exception filter và request correlation ID | BE-PLT-001 | Error response thống nhất; unexpected error không lộ stack/secrets; request có correlation ID |
| BE-PLT-005 | Logging redaction | BE-PLT-004 | Authorization, cookies, report content, signed URLs và API keys bị redact; có automated tests |
| BE-PLT-006 | Supabase server client provider | BE-PLT-003, DB-015 | Service-role client chỉ tồn tại trong API; provider mock được trong tests |
| BE-PLT-007 | Repository base và transaction pattern | BE-PLT-006 | Repositories typed, injectable và không phụ thuộc HTTP; transaction/error mapping được test |
| BE-PLT-008 | Supabase JWT authentication guard | BE-PLT-003, AUTH-004 | Valid token tạo request user; expired/invalid/missing token trả `401`; không trust role từ request body |
| BE-PLT-009 | Role và resource-ownership guards | BE-PLT-007, BE-PLT-008 | Owner/researcher/reviewer rules tái sử dụng được; unauthorized trả `403`; existence không bị leak |
| BE-PLT-010 | OpenAPI generation và API contract check | BE-PLT-002 | OpenAPI build được trong CI; documented status/error schemas khớp integration tests |
| BE-PLT-011 | `GET /api/health` | BE-PLT-001, BE-PLT-003 | Liveness không cần auth; readiness kiểm tra dependency an toàn; response không lộ config |

## Program APIs

| ID | Endpoint | Depends on | Acceptance criteria |
|---|---|---|---|
| BE-PRG-001 | `GET /api/programs` | BE-PLT-002, BE-PLT-007, DB-002 đến DB-004, RLS-002 | Public chỉ nhận active programs; pagination/filter/sort được validate; không trả private owner data |
| BE-PRG-002 | `POST /api/programs` | BE-PLT-009, DB-002 đến DB-004 | Owner tạo draft với scopes/reward tiers hợp lệ; slug unique; researcher/anonymous bị từ chối |
| BE-PRG-003 | `GET /api/programs/:slug` + `GET /api/owner/programs/:id` | BE-PRG-001 | Public detail lookup bằng canonical unique slug; owner read bằng UUID được bảo vệ; draft/paused không lộ cho anonymous; unknown/unauthorized resource trả đúng contract |
| BE-PRG-004 | `PATCH /api/programs/:id` | BE-PLT-009, BE-PRG-003 | Chỉ owner cập nhật field/state được phép; immutable funded fields không bị sửa; optimistic conflict được xử lý |
| BE-PRG-005 | `POST /api/programs/:id/deploy` | BE-PLT-009, BE-PRG-003, BC-004 | Chỉ owner deploy một lần; request idempotent; contract address và tx được persist |
| BE-PRG-006 | `POST /api/programs/:id/fund` | BE-PLT-009, BE-PRG-003, BC-005 | Tx receipt được verify đúng owner/token/contract/amount; duplicate tx không cộng balance hai lần |
| BE-PRG-007 | `POST /api/programs/:id/close` | BE-PLT-009, BE-PRG-003, BC-007 | Chỉ state hợp lệ được close; refund được theo dõi; retry idempotent |

## Current-user APIs

| ID | Endpoint | Depends on | Acceptance criteria |
|---|---|---|---|
| BE-AUTH-001 | `GET /api/me` | BE-PLT-008, AUTH-004 | Trả safe profile của principal hiện tại; không trả token/Auth internals; missing/invalid user trả stable `401` |
| BE-AUTH-002 | `PATCH /api/me/onboarding` | BE-PLT-008, AUTH-003, BE-AUTH-001 | Chỉ cho chọn `owner` hoặc `researcher`; không self-assign reviewer; retry idempotent hoặc stable conflict |

## Report APIs

| ID | Endpoint | Depends on | Acceptance criteria |
|---|---|---|---|
| BE-RPT-001 | `GET /api/reports` | BE-PLT-009, DB-005, RLS-003 | Query filters được validate; researcher chỉ thấy report mình; owner/reviewer chỉ thấy program được phép; response paginated |
| BE-RPT-002 | `POST /api/programs/:id/reports` | BE-PLT-009, DB-005, BE-PRG-003 | Researcher submit vào active/in-scope program; content hash được kiểm tra/tạo nhất quán; owner không submit thay user |
| BE-RPT-003 | `GET /api/reports/:id` | BE-PLT-009, BE-RPT-001 | Chỉ participant/reviewer hợp lệ đọc nội dung; response không chứa storage internals |
| BE-RPT-004 | `PATCH /api/reports/:id` | BE-PLT-009, BE-RPT-003 | Researcher chỉ sửa report của mình ở state cho phép; immutable audit fields không bị sửa |
| BE-RPT-005 | `POST /api/reports/:id/triage` | BE-PLT-009, BE-RPT-003, AI-007 | Chỉ owner/reviewer trigger; structured result được persist; provider failure không làm hỏng report |
| BE-RPT-006 | `POST /api/reports/:id/request-information` | BE-PLT-009, BE-RPT-003, DB-007, DB-008 | Transition hợp lệ sang `needs_information`; reason/comment được lưu; researcher được notify |
| BE-RPT-007 | `POST /api/reports/:id/validate` | BE-PLT-009, BE-RPT-003, DB-008 | Severity cuối cùng bắt buộc và hợp lệ; transition/audit record atomic; unauthorized bị từ chối |
| BE-RPT-008 | `POST /api/reports/:id/reject` | BE-PLT-009, BE-RPT-003, DB-008 | Rejection reason bắt buộc; transition atomic; report đã paid không thể reject |
| BE-RPT-009 | `POST /api/reports/:id/mark-duplicate` | BE-PLT-009, BE-RPT-003, DB-008 | Original report ID hợp lệ, cùng program và có quyền; không self-reference/cycle |
| BE-RPT-010 | `POST /api/reports/:id/approve-reward` | BE-PLT-009, BE-RPT-003, DB-008 | **Legacy `410 Gone`** (`reward_settlement_flow_required`); không còn owner/reviewer mutation |
| BE-RPT-011 | `POST /api/reports/:id/pay` | BE-PLT-009, BE-RPT-003, BE-RPT-010, BC-006 | **Legacy `410 Gone`**; không còn chuyển report state hoặc nhận client transaction evidence |

## Attachment APIs

| ID | Endpoint | Depends on | Acceptance criteria |
|---|---|---|---|
| BE-ATT-001 | `POST /api/reports/:id/attachments/upload-url` | BE-PLT-009, BE-RPT-003, STO-002 | MIME/size/name được validate; signed URL ngắn hạn; path không do client tùy ý quyết định |
| BE-ATT-002 | `GET /api/reports/:id/attachments/:attachmentId/download-url` | BE-PLT-009, BE-RPT-003, BE-ATT-001 | Report và attachment relation được verify; signed URL ngắn hạn; access bị audit nhưng URL không log |

## Comment APIs

| ID | Endpoint | Depends on | Acceptance criteria |
|---|---|---|---|
| BE-CMT-001 | `GET /api/reports/:id/comments` | BE-PLT-009, BE-RPT-003, DB-007 | Chỉ user có quyền với report đọc được; pagination ổn định; deleted content được xử lý đúng contract |
| BE-CMT-002 | `POST /api/reports/:id/comments` | BE-PLT-009, BE-RPT-003, DB-007 | Body được validate; author lấy từ token; comment được persist và notification không làm request ghi trùng |

### Reward settlement (durable owner-only flow)

`POST /api/reports/:id/approve-reward`, `/pay` và `/confirm-payment` chỉ là legacy contract
surfaces và luôn trả `410 Gone` (`reward_settlement_flow_required`). Chúng không còn là
owner/reviewer mutations. Settlement phải dùng `POST /api/reports/:id/reward-settlement-intents`
và các subroutes `current`, `approval-observations`, `reconcile`, `cancel`; controller gate
toàn bộ write bằng `@Roles('owner')`. Owner browser wallet ký `approveReward` một lần trên
intent bất biến; `payReward` execution có thể permissionless, nhưng AI, reviewer và relayer
không được tạo intent, reserve pool hoặc ký approval.

## Transaction APIs

| ID | Endpoint | Depends on | Acceptance criteria |
|---|---|---|---|
| BE-TX-001 | `GET /api/programs/:id/transactions` | BE-PLT-009, BE-PRG-003, DB-011 | Visibility theo program role; pagination/type filters hợp lệ; tx được sort ổn định |
| BE-TX-002 | `GET /api/transactions/:hash` | BE-PLT-009, DB-011 | Hash/chain được validate; chỉ user có quyền xem entity liên quan; receipt status được normalize |

## Backend task guardrails

- Endpoint task không được âm thầm thêm endpoint thứ hai.
- Mỗi endpoint phải có ít nhất happy-path, validation, unauthenticated và unauthorized integration tests khi phù hợp.
- State-changing endpoint phải test invalid transition và idempotent retry.
- Task blockchain không được coi transaction là final trước số confirmation đã cấu hình.
- AI output không bao giờ được gọi trực tiếp legacy payout route hoặc durable settlement-intent endpoint.
