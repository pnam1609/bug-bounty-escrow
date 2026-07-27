# AI triage tasks

AI là optional. Report submission, manual review, reward approval và payout phải hoạt động khi toàn bộ AI feature bị tắt.

| ID | Outcome | Depends on | Acceptance criteria |
|---|---|---|---|
| AI-001 | Định nghĩa provider-neutral `TriageProvider` contract | FND-004, FND-006 | Input/output không phụ thuộc Gemini; timeout/error types rõ; không có payout decision |
| AI-002 | Implement `MockTriageProvider` | AI-001 | Deterministic fixtures cho common severities/scope/missing-info; dùng được offline |
| AI-003 | Zod schema cho structured triage output | AI-001 | Invalid/missing/out-of-range fields bị reject; schema versioned; confidence bounded |
| AI-004 | Prompt template và prompt-safety rules | AI-003 | Report content được coi là untrusted; prompt injection không thay đổi system constraints; không yêu cầu secrets |
| AI-005 | Implement `GeminiTriageProvider` | AI-003, AI-004, FND-008 | Timeout/retry/rate-limit xử lý có giới hạn; API key không log; raw invalid output không được tin |
| AI-006 | Provider selection và feature flag | AI-002, AI-005 | `mock`, `gemini` và `disabled` modes; invalid config fail fast; disabled mode không chặn app |
| AI-007 | Triage orchestration service | AI-003, AI-006, DB-009 | Validate output trước persist; record provider/model/schema version; failure không đổi report state sai |
| AI-008 | Duplicate-candidate retrieval, optional | AI-007 | Chỉ search trong reports user được phép; kết quả là suggestion; không tự mark duplicate |
| AI-009 | AI evaluation fixtures | AI-002, AI-005 | Dataset không chứa private exploit; đo schema validity và coarse severity/scope consistency |
| AI-010 | Cost/quota/latency telemetry | AI-005 | Không gửi report content vào metrics; quota errors quan sát được; có per-request timeout metric |

## Guardrails

- AI không được gọi `approve-reward` hoặc `pay`.
- AI output không tự chuyển report sang `validated`, `rejected` hoặc `duplicate`.
- Không log prompt chứa vulnerability content.
- Provider failure phải trả về recoverable state để reviewer tiếp tục thủ công.
