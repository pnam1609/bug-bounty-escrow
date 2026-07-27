# Database, Auth, RLS and Storage tasks

Mỗi table migration và mỗi nhóm security policy là một task độc lập. Migration đã được apply không được sửa trực tiếp; thay đổi phải tạo migration mới.

## Schema migrations

| ID | Outcome | Depends on | Acceptance criteria |
|---|---|---|---|
| DB-001 | Migration cho `profiles` | FND-004 | PK liên kết Supabase user; role và wallet fields có constraint; timestamps tồn tại |
| DB-002 | Migration cho `programs` | DB-001 | Owner FK, unique slug, status, pool amounts, deadline và contract address đúng domain model |
| DB-003 | Migration cho `program_scopes` | DB-002 | Program FK, asset type, address/URL và in-scope flag có constraint |
| DB-004 | Migration cho `program_reward_tiers` | DB-002 | Unique severity mỗi program; min/max reward hợp lệ và non-negative |
| DB-005 | Migration cho `reports` | DB-001, DB-002, DB-003 | Researcher/program/scope FK, status, severity, content hash và reward fields đúng domain model |
| DB-006 | Migration cho `report_attachments` | DB-005 | Report/uploader FK, private storage path, metadata và size fields; không lưu public URL |
| DB-007 | Migration cho `report_comments` | DB-005, DB-001 | Report/author FK, comment body và timestamps; soft-delete field nếu cần |
| DB-008 | Migration cho `report_reviews` | DB-005, DB-001 | Reviewer/report FK, action, state transition metadata và reason |
| DB-009 | Migration cho `ai_triage_results` | DB-005 | Provider, model, structured result, confidence và error metadata; không ghi API key |
| DB-010 | Migration cho `escrow_contracts` | DB-002 | Program FK, chain ID, address, deployment tx và deployment status |
| DB-011 | Migration cho `escrow_transactions` | DB-002, DB-005, DB-010 | Tx hash, type, amount, token, report link, block data và unique chain/hash constraint |
| DB-012 | Migration cho `notifications` | DB-001 | Recipient, type, read state, safe metadata và timestamps |
| DB-013 | Migration cho `audit_logs` | DB-001 | Actor, action, entity reference và redacted metadata; report content không được lưu |
| DB-014 | Bổ sung indexes và database constraints | DB-001 đến DB-013 | Common filters dùng index; invalid state/value bị database từ chối; migration rollback được kiểm tra |
| DB-015 | Tạo repository types/generated database types | DB-014 | API compile với typed rows/inserts/updates; generation command được document |

## Authentication

| ID | Outcome | Depends on | Acceptance criteria |
|---|---|---|---|
| AUTH-001 | Cấu hình Supabase email/password auth cho local và hosted env | FND-008 | Register/login/logout/refresh hoạt động; redirect URLs không dùng wildcard nguy hiểm |
| AUTH-002 | Tạo profile bootstrap khi user đăng ký | AUTH-001, DB-001 | Profile tạo idempotent; role mặc định an toàn; lỗi không làm lộ dữ liệu auth |
| AUTH-003 | Định nghĩa onboarding và role assignment rules | AUTH-002 | User chọn owner/researcher theo rule; reviewer không thể tự cấp; test privilege escalation |
| AUTH-004 | Định nghĩa access-token claims contract cho NestJS | AUTH-001, AUTH-003 | User ID/role extraction được document và có fixtures cho backend tests |

## Row Level Security

| ID | Outcome | Depends on | Acceptance criteria |
|---|---|---|---|
| RLS-001 | Policies cho `profiles` | DB-001, AUTH-003 | User chỉ update field được phép của profile mình; reviewer role không tự nâng cấp |
| RLS-002 | Policies cho program tables | DB-002, DB-003, DB-004, AUTH-003 | Public chỉ đọc active program; owner chỉ mutate program của mình |
| RLS-003 | Policies đọc/ghi `reports` | DB-005, AUTH-003 | Researcher chỉ thấy report của mình; owner/reviewer chỉ thấy report trong program được phép |
| RLS-004 | Policies cho comments, reviews và AI results | DB-007, DB-008, DB-009, RLS-003 | Quyền kế thừa từ report; researcher không ghi review/triage result |
| RLS-005 | Policies cho escrow, notification và audit tables | DB-010 đến DB-013, AUTH-003 | Transaction visibility đúng program/user; audit writes chỉ server-side |
| RLS-006 | Automated RLS security tests | RLS-001 đến RLS-005 | Test đủ anonymous, researcher, owner, reviewer và service role; có negative cases |

## Private storage

| ID | Outcome | Depends on | Acceptance criteria |
|---|---|---|---|
| STO-001 | Tạo private report-attachments bucket | AUTH-001 | Bucket không public; MIME/size limits được cấu hình |
| STO-002 | Storage policies theo report ownership | STO-001, DB-006, RLS-003 | Chỉ user có quyền với report được upload/download; path traversal bị từ chối |
| STO-003 | Cleanup policy cho orphaned uploads | STO-002 | Upload hết hạn hoặc không gắn report được xóa an toàn; có dry-run/test |

## Seed data

| ID | Outcome | Depends on | Acceptance criteria |
|---|---|---|---|
| SEED-001 | Seed demo users và profiles | DB-001, AUTH-003 | Có owner, researcher và reviewer accounts; credentials chỉ dành local/demo |
| SEED-002 | Seed programs, scopes và reward tiers | SEED-001, DB-002 đến DB-004 | Có 8–10 programs với status và severity tiers đa dạng |
| SEED-003 | Seed reports, comments và reviews | SEED-002, DB-005 đến DB-008 | Có 30–80 reports và đủ major states; nội dung đã rewrite từ public sources |
| SEED-004 | Seed escrow contracts và transactions | SEED-002, DB-010, DB-011 | Có funding, payout và refund history nhất quán với balances |
| SEED-005 | Tạo idempotent seed/reset command | SEED-001 đến SEED-004 | Chạy lặp không tạo duplicate; reset chỉ được phép ở local/demo environment |
