# Operations tasks

File này phụ trách CI/CD, deployment, runtime configuration và observability. Production deployment là action riêng và cần explicit authorization.

| ID | Outcome | Depends on | Acceptance criteria |
|---|---|---|---|
| OPS-001 | CI quality workflow | FND-009, QA-001 | Install cache đúng lockfile; lint/typecheck/unit tests/build chạy trên pull request |
| OPS-002 | Database migration check workflow | DB-014, OPS-001 | Fresh database migrate/rollback test pass; migration order và generated types được kiểm tra |
| OPS-003 | Smart contract CI workflow | SC-TST-001 đến SC-TST-008, OPS-001 | Forge format/build/test/fuzz chạy; ABI stale check hoạt động |
| OPS-004 | E2E CI workflow | QA-002, QA-003, OPS-001 | Services start/stop tự động; artifacts khi fail; secrets được mask |
| OPS-005 | Containerize NestJS API | BE-PLT-011 | Multi-stage non-root image; health check; production deps only; image build reproducible |
| OPS-006 | Configure Vercel web deployment | FE-PLT-001, FND-008 | Preview/prod env tách biệt; API URL đúng; server-only vars không public |
| OPS-007 | Configure API hosting deployment | OPS-005 | HTTPS, health probes, graceful rollout/rollback và CORS origin đúng |
| OPS-008 | Configure Supabase hosted environments | DB-014, AUTH-001, STO-001 | Dev/staging/prod projects tách biệt; migrations có quy trình promote; backups configured |
| OPS-009 | Secret management and rotation runbook | FND-008, OPS-006, OPS-007, OPS-008 | Owner, location, rotation/revocation steps rõ; không có secret trong repo/logs |
| OPS-010 | Structured logs and error tracking | BE-PLT-004, BE-PLT-005, FE-PLT-007 | Correlation ID nối web/API; PII/report content redacted; environment/release tagged |
| OPS-011 | Metrics and alerting | OPS-007, OPS-010, AI-010 | API latency/error, RPC failure, sync lag và AI quota alerts có threshold/runbook |
| OPS-012 | Database backup and restore drill | OPS-008 | Restore vào isolated environment được kiểm chứng; RPO/RTO và kết quả drill được ghi lại |
| OPS-013 | Release and rollback runbook | OPS-002 đến OPS-012 | Thứ tự migration/API/web/contracts rõ; rollback limits được nêu; owner cho từng step |

## Environment promotion order

```text
CI
→ local integration
→ preview/development
→ staging
→ production approval
→ production deploy
→ smoke test
→ monitor
```

Không auto-deploy smart contract hoặc chạy irreversible migration chỉ vì application build pass.
