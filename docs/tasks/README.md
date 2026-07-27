# Detailed task breakdown

Thư mục này là backlog triển khai chính thức của dự án. Task được tách theo mảng để frontend, backend, database, smart contract và các phần khác có thể được giao độc lập.

## Task files

| Mảng | File | ID prefix |
|---|---|---|
| Foundation và shared packages | [foundation.md](foundation.md) | `FND` |
| Database, Auth, RLS và Storage | [database-auth.md](database-auth.md) | `DB`, `AUTH`, `RLS`, `STO`, `SEED` |
| NestJS backend | [backend.md](backend.md) | `BE` |
| Next.js frontend | [frontend.md](frontend.md) | `FE` |
| Solidity smart contracts | [smart-contracts.md](smart-contracts.md) | `SC` |
| Blockchain integration | [blockchain-integration.md](blockchain-integration.md) | `BC` |
| AI triage | [ai.md](ai.md) | `AI` |
| Test, security và demo | [quality-demo.md](quality-demo.md) | `QA`, `SEC`, `DEMO` |
| CI/CD và deployment | [operations.md](operations.md) | `OPS` |

## Current parallel assignments

### Wave 1

Sau `FND-001`, hai assignment sau có thể chạy đồng thời vì không có file ownership giao nhau:

| Thread | Assignment | Exclusive write scope |
|---|---|---|
| Thread 2 | [FND-002 Base TypeScript configuration](assignments/thread-2-fnd-002.md) | Chỉ ba file `tsconfig*.json` ở root |
| Thread 3 | [FND-003 Lint and formatting configuration](assignments/thread-3-fnd-003.md) | Tooling configs, package manifests và `pnpm-lock.yaml` |

### Wave 2

Chỉ bắt đầu wave này sau khi cả `FND-002` và `FND-003` hoàn thành:

| Thread | Assignment | Exclusive write scope |
|---|---|---|
| Thread 2 | [FND-004 Domain types and state enums](assignments/thread-2-fnd-004.md) | `packages/domain/**` |
| Thread 3 | [FND-005 Shared constants and utilities](assignments/thread-3-fnd-005.md) | `packages/shared/**` |

### Wave 3

Chỉ bắt đầu wave này sau khi cả `FND-004` và `FND-005` hoàn thành:

| Thread | Assignment | Exclusive write scope |
|---|---|---|
| Thread 2 | [FND-006 Shared Zod schema foundation](assignments/thread-2-fnd-006.md) | Shared schema files, shared package manifest và `pnpm-lock.yaml` |
| Thread 3 | [FND-009 Root scripts and Turbo task graph](assignments/thread-3-fnd-009.md) | Chỉ root `package.json` và `turbo.json` |

### Wave 4

Chỉ bắt đầu wave này sau khi cả `FND-006` và `FND-009` hoàn thành:

| Thread | Assignment | Exclusive write scope |
|---|---|---|
| Thread 2 | [FND-008 Environment schemas and examples](assignments/thread-2-fnd-008.md) | Shared env modules, shared entrypoint và các file `.env.example` |
| Thread 3 | [FND-007 UI package and base theme](assignments/thread-3-fnd-007.md) | `packages/ui/**` và `pnpm-lock.yaml` |

### Wave 5

Chỉ bắt đầu wave này sau khi cả `FND-007` và `FND-008` hoàn thành:

| Thread | Assignment | Exclusive write scope |
|---|---|---|
| Thread 2 | [FND-010 Contributor setup guide](assignments/thread-2-fnd-010.md) | Root `README.md` và `docs/development-setup.md` |
| Thread 3 | [FND-011 Foundation integration validation](assignments/thread-3-fnd-011.md) | Chỉ `docs/foundation-validation.md`; toàn bộ code/config là read-only |

## Database and backend platform assignments

### Wave 6

Chỉ bắt đầu wave này sau khi Foundation Wave 5 hoàn thành:

| Thread | Assignment | Exclusive write scope |
|---|---|---|
| Thread 2 | [DB-001 to DB-004 Core database schema](assignments/thread-2-db-001-db-004.md) | Database migrations, core-schema verification và database README |
| Thread 3 | [BE-PLT-001 to BE-PLT-007 NestJS platform](assignments/thread-3-be-plt-001-be-plt-007.md) | `apps/api/**` và `pnpm-lock.yaml` |

Thread 2 không được cài dependency hoặc sửa lockfile. Thread 3 không được sửa database migrations. Sau khi cả hai hoàn thành, coordinator chạy root validation và kiểm tra migrations trên database sạch trước khi bắt đầu Auth/guard tasks.

Execution gate: Thread 3 chỉ bắt đầu khi `pnpm install --frozen-lockfile` pass. Foundation validation hiện ghi nhận `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`; cần xử lý dependency-policy blocker này trước, không được bypass policy ngay trong task NestJS.

## Single-thread overnight assignment

Khi chỉ chạy một thread và muốn agent tiếp tục tuần tự trong thời gian dài, dùng:

[Backend platform and complete database foundation](assignments/single-thread-overnight-backend-foundation.md)

Assignment này sở hữu `apps/api/**`, `packages/database/**`, `pnpm-lock.yaml` và một file báo cáo riêng. Không được chạy đồng thời với Wave 6 hoặc bất kỳ task nào sửa các path trên.

Sau khi backend/database foundation hoàn thành, assignment dài hạn kế tiếp là:

[Auth, RLS and Program vertical slice](assignments/single-thread-auth-program-vertical-slice.md)

Assignment này chạy tuần tự bằng một thread: hoàn tất OpenAPI còn block, triển khai Auth/RLS, NestJS guards, Program CRUD APIs và hai trang public Program của Next.js. Không được chạy đồng thời với task khác sửa API, web, shared, database, workspace settings hoặc lockfile.

Nếu cần một batch lớn hơn nhiều, chạy xuyên suốt toàn bộ off-chain MVP:

[Off-chain MVP marathon](assignments/single-thread-offchain-mvp-marathon.md)

Assignment marathon gọi Auth/Program vertical slice trước, sau đó tiếp tục Current User APIs, Report/RLS/Storage, manual review, toàn bộ frontend off-chain, seed/demo, E2E và security tests. Task này phải chạy một mình và sở hữu toàn bộ API, web, shared, UI, database, workspace settings cùng lockfile trong suốt quá trình.

Hai thread không được chạy formatter dạng `--write` trên toàn repository. Sau mỗi wave, coordinator chạy lại các root validation commands trước khi bắt đầu task phụ thuộc tiếp theo.

## Quy tắc chia task

1. Một task chỉ tạo ra một outcome có thể review và test độc lập.
2. Một API endpoint là một task backend riêng. Không gom CRUD của cả module vào một task.
3. Một page hoặc một user action độc lập là một task frontend riêng.
4. Migration của mỗi table là một task riêng; RLS policy được tách khỏi migration schema.
5. Mỗi smart contract action và nhóm test tương ứng là task riêng.
6. Task chỉ được bắt đầu khi tất cả `Depends on` đã hoàn thành.
7. Nếu thay đổi public API, cập nhật `docs/api-contracts.md` trong chính task đó.
8. Không để hai agent sửa cùng một shared file trong cùng thời điểm.

## Definition of Ready

Một task sẵn sàng triển khai khi:

- Outcome và acceptance criteria không còn mơ hồ.
- Dependency IDs đã hoàn thành.
- API contract hoặc domain type liên quan đã tồn tại.
- Allowed files và files không được sửa đã được liệt kê theo template trong `PROJECT_CONTEXT.md`.
- Không có task khác đang sở hữu cùng shared file.

## Definition of Done

Một task chỉ được đánh dấu hoàn thành khi:

- Outcome và toàn bộ acceptance criteria đã đạt.
- Input, authorization, empty state và error path liên quan đã được xử lý.
- Unit/integration test ở mức phù hợp đã được thêm hoặc cập nhật.
- Lint, typecheck và các test liên quan đều pass.
- API contract, schema hoặc tài liệu bị ảnh hưởng đã được cập nhật.
- Agent trả về changed-file summary, assumptions và known limitations.

## Luồng dependency cấp cao

```text
FND
  → DB/AUTH/RLS/STO
  → BE platform
  → BE endpoint
  → FE page/action
  → QA end-to-end

SC
  → BC integration
  → BE blockchain endpoint
  → FE wallet/transaction action
  → QA on-chain flow
```

AI là optional và được triển khai sau khi report/review flow không dùng AI đã hoạt động.
