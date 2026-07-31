# AI triage tasks

AI là optional. Report submission, manual review, reward approval và payout phải hoạt động khi toàn bộ AI feature bị tắt.

| ID     | Outcome                                               | Depends on                     | Acceptance criteria                                                                                                                              |
| ------ | ----------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| AI-001 | Định nghĩa provider-neutral `TriageProvider` contract | FND-004, FND-006               | Input/output không phụ thuộc provider; timeout/error types rõ; không có payout decision                                                          |
| AI-002 | Implement `MockTriageProvider`                        | AI-001                         | Deterministic fingerprint/comparison fixtures; dùng được offline                                                                                 |
| AI-003 | Versioned Zod schemas                                 | AI-001                         | Fingerprint/result malformed, oversized hoặc confidence ngoài range bị reject                                                                    |
| AI-004 | Prompt template và redaction rules                    | AI-003                         | Report content là untrusted; prompt injection không đổi system constraints; secrets/identity/attachments không gửi provider                      |
| AI-005 | Implement hosted AI providers                         | AI-003, AI-004, FND-008        | Gemini stable model và optional DeepSeek adapter; structured JSON + Zod; timeout/retry/rate-limit bounded; API key không log                     |
| AI-006 | Provider selection, feature flag và privacy mode      | AI-002, AI-005                 | `mock`, `gemini`, `deepseek`, `disabled`; demo hosted data fail-closed; disabled mode không chặn app                                             |
| AI-007 | Immutable revisions và AI run/result persistence      | DB-009, AI-003                 | Snapshot/hash/fingerprint/provenance persisted; immutable/service-only; legacy seed rows vẫn hợp lệ                                              |
| AI-008 | Atomic submit/resubmit enqueue                        | AI-007                         | One run per revision/hash; monotonic program sequence; idempotent transaction cùng report snapshot                                               |
| AI-009 | Durable FIFO worker và pass-1 fingerprint             | AI-005, AI-007, AI-008         | Lease/SKIP LOCKED; FIFO `1/program`, cross-program parallel; pass 1 persisted; retry/terminal states                                             |
| AI-010 | Cross-signal candidate retrieval và pass-2 comparison | AI-007, AI-009                 | Union exact/hash/identifier/full-text/component/class/attack-vector trên prior sequence; scope/impact không hard-filter; không tự mark duplicate |
| AI-011 | Authorized AI read models và API contracts            | AI-009, AI-010                 | Revision-safe Processing/Ready/Unavailable; researcher aggregate-only; owner/reviewer candidate refs được re-authorize                           |
| AI-012 | Evaluation, privacy, quota và observability tests     | AI-002, AI-005, AI-006, AI-010 | Không private exploit trong fixtures; test schema/FIFO/idempotency/RLS/retry; metrics không chứa content/secrets; human review vẫn hoạt động     |

## Guardrails

- AI không được gọi `approve-reward` hoặc `pay`.
- AI output không tự chuyển report sang `validated`, `rejected` hoặc `duplicate`.
- Không log prompt chứa vulnerability content.
- Provider failure phải trả về recoverable state để reviewer tiếp tục thủ công.
- Không gửi private vulnerability report thật tới Gemini unpaid/free tier. Free tier chỉ dành cho
  synthetic/demo/non-confidential fixtures theo Gemini API Terms.
- Hai reports cùng program submit đồng thời phải được serialize bằng durable database queue, không
  dùng in-memory mutex hoặc chỉ dựa vào thời điểm worker nhận message.
- Researcher không được thấy duplicate candidate ID/title/body của report khác; owner/reviewer phải
  re-authorize candidate khi đọc.
