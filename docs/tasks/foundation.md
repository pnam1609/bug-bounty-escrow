# Foundation tasks

Các task trong file này chỉ phụ trách workspace và shared packages. NestJS-specific setup nằm trong `backend.md`; Next.js feature setup nằm trong `frontend.md`.

| ID | Outcome | Depends on | Acceptance criteria |
|---|---|---|---|
| FND-001 | Khởi tạo pnpm workspace và Turborepo | — | `apps/*` và `packages/*` được nhận diện; lệnh build, lint, typecheck và test chạy từ root |
| FND-002 | Tạo base TypeScript config dùng chung | FND-001 | Các app/package extend config chung; strict mode bật; path resolution hoạt động |
| FND-003 | Tạo shared lint và formatting config | FND-001 | Web, API và packages dùng cùng rules; root commands phát hiện lỗi |
| FND-004 | Tạo `packages/domain` với domain types và state enums | FND-002 | Program, Report, Severity và state transitions được export; không phụ thuộc framework |
| FND-005 | Tạo `packages/shared` với constants và utility types | FND-002 | Constants dùng chung được export qua public entrypoint; không chứa secrets |
| FND-006 | Tạo nền `packages/shared/schemas` với reusable Zod primitives | FND-004, FND-005 | Web và API import được schema primitives; type được infer từ schema; endpoint tasks compose thành DTO cụ thể |
| FND-007 | Tạo `packages/ui` và theme cơ bản | FND-001, FND-002 | Component/theme export qua public entrypoint; web import không dùng deep path |
| FND-008 | Tạo environment schema theo từng app | FND-006 | Web chỉ nhận public variables; API fail fast khi thiếu server variables; test env có defaults an toàn |
| FND-009 | Chuẩn hóa root scripts và task cache | FND-001, FND-002, FND-003 | `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` chạy đúng dependency order |
| FND-010 | Viết contributor setup guide | FND-008, FND-009 | Có prerequisites, install, env setup, local commands và troubleshooting tối thiểu |
| FND-011 | Audit tích hợp và ghi foundation validation report | FND-004 đến FND-009 | Frozen install, package boundaries, public exports và root validation commands có evidence; task audit không tự sửa lỗi |

## File ownership

- `FND-001` đến `FND-003`, `FND-009`: root workspace/config files.
- `FND-004`: `packages/domain/**`.
- `FND-005`, `FND-006`, `FND-008`: `packages/shared/**` và env examples liên quan.
- `FND-007`: `packages/ui/**`.
- `FND-010`: setup documentation.
- `FND-011`: `docs/foundation-validation.md`; các file khác chỉ được đọc.

Task sửa shared config phải chạy validation cho cả web, API và packages hiện có.
