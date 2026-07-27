# Quality, security and demo tasks

E2E task được tách theo user journey. Mỗi journey tự quản lý fixtures và không phụ thuộc thứ tự chạy của test khác.

## Test infrastructure

| ID | Outcome | Depends on | Acceptance criteria |
|---|---|---|---|
| QA-001 | Unit/integration test conventions và fixtures | FND-009 | Test commands tách unit/integration/e2e; fixtures typed; tests chạy deterministic |
| QA-002 | Playwright setup với role fixtures | FE-PLT-001, AUTH-003, SEED-001 | Anonymous/owner/researcher/reviewer sessions độc lập; traces chỉ giữ khi failure |
| QA-003 | Local Supabase test lifecycle | DB-014, SEED-005 | Start/migrate/seed/reset reproducible; cleanup chạy khi test fail |
| QA-004 | Arc/local-chain test lifecycle | SC-TST-007, BC-001 | Deterministic accounts/contracts; chain reset giữa suites; không dùng production key |

## End-to-end journeys

| ID | Outcome | Depends on | Acceptance criteria |
|---|---|---|---|
| QA-E2E-001 | Public browse programs journey | QA-002, FE-PRG-001, FE-PRG-002 | List/filter/detail hoạt động; draft/private data không xuất hiện |
| QA-E2E-002 | Register, login, onboarding và logout journey | QA-002, FE-AUTH-001 đến FE-AUTH-004 | Session/redirect/role/cache behavior đúng qua full flow |
| QA-E2E-003 | Owner create và edit program journey | QA-002, FE-PRG-003 đến FE-PRG-005 | Create/update/validation/conflict paths được kiểm tra |
| QA-E2E-004 | Researcher submit report journey | QA-002, FE-RPT-001, FE-RPT-002 | Report và attachment submit thành công; unauthorized user không đọc được |
| QA-E2E-005 | Researcher manage report journey | QA-002, FE-RPT-003 đến FE-RPT-008 | List/detail/edit/download/comment paths và state restrictions đúng |
| QA-E2E-006 | Reviewer request-information journey | QA-002, FE-REV-001, FE-REV-002, FE-REV-004 | Status/comment/timeline/notification nhất quán |
| QA-E2E-007 | Reviewer validate/reject/duplicate journeys | QA-002, FE-REV-005 đến FE-REV-007 | Mỗi transition có happy path và invalid-state path riêng |
| QA-E2E-008 | Reward approval journey | QA-002, FE-REV-008 | Amount/tier/pool validation đúng; không có payout ngoài ý muốn |
| QA-E2E-009 | Escrow deploy and fund journey | QA-002, QA-004, FE-PRG-006, FE-PRG-007 | Contract/DB/UI state nhất quán sau confirmations |
| QA-E2E-010 | Reward payout journey | QA-002, QA-004, FE-REV-009, FE-TX-001, FE-TX-002 | USDC balance thay đổi đúng; retry không double pay; explorer data đúng |
| QA-E2E-011 | Close and refund journey | QA-002, QA-004, FE-PRG-008 | Remaining funds refund đúng; program/contract/DB state nhất quán |
| QA-E2E-012 | AI unavailable fallback journey | QA-002, FE-REV-003, AI-006 | Reviewer vẫn hoàn thành manual workflow khi AI disabled/error/quota exceeded |

## Security and resilience

| ID | Outcome | Depends on | Acceptance criteria |
|---|---|---|---|
| SEC-001 | API authorization matrix tests | BE-PRG-001 đến BE-TX-002 | Mỗi protected endpoint test anonymous và wrong-role/resource owner |
| SEC-002 | Report confidentiality tests | RLS-006, BE-RPT-001, BE-RPT-003 | Cross-user/program access bị từ chối ở API và database layers |
| SEC-003 | Attachment security tests | STO-002, BE-ATT-001, BE-ATT-002 | Expiry, path traversal, MIME/size, cross-report access và URL redaction được cover |
| SEC-004 | Log and telemetry leakage tests | BE-PLT-005, AI-010 | Secrets/report content/signed URLs không xuất hiện trong captured logs/metrics |
| SEC-005 | Idempotency and duplicate-payment tests | BE-RPT-011, BC-006 | Concurrent/retried requests chỉ tạo một payout |
| SEC-006 | Dependency and secret scan | FND-009 | CI fail trên committed secrets và configured critical vulnerabilities; allowlist có lý do |
| SEC-007 | Rate-limit sensitive endpoints | BE-PLT-008, BE-RPT-002, BE-RPT-005, BE-ATT-001 | Limits theo user/IP phù hợp; `429` có retry hint; internal health không bị phá |

## Demo

| ID | Outcome | Depends on | Acceptance criteria |
|---|---|---|---|
| DEMO-001 | Demo reset command | SEED-005, QA-003 | Reset deterministic; có environment guard và explicit confirmation ngoài local |
| DEMO-002 | Demo mode indicator và safe config | FE-PLT-002, FND-008 | UI chỉ báo demo; không trỏ production services; test accounts không xuất hiện ở production |
| DEMO-003 | Demo script cho core flow | QA-E2E-010 | Script có steps, expected state, fallback và timing; chạy lại sau reset được |
| DEMO-004 | Demo data provenance note | SEED-003 | Ghi rõ dữ liệu dựa trên public disclosures và đã rewrite; không chứa private exploits |
