# Blockchain integration tasks

File này phụ trách viem/wagmi clients, transaction lifecycle và event synchronization. Solidity implementation nằm trong `smart-contracts.md`; HTTP endpoints nằm trong `backend.md`.

| ID | Outcome | Depends on | Acceptance criteria |
|---|---|---|---|
| BC-001 | Arc Testnet chain config và public client | FND-005, FND-008 | Chain ID/RPC/explorer/token addresses lấy từ validated config; wrong-chain test tồn tại |
| BC-002 | Wallet connection và network switching adapter | BC-001 | Connect/disconnect/account change hoạt động; unsupported network bị chặn; không lưu private key |
| BC-003 | USDC read/approve helpers | BC-001, SC-ART-002 | Decimals không hardcode sai; balance/allowance reads typed; approve errors được normalize |
| BC-004 | Escrow deployment service | BC-001, SC-ART-002 | Build/send/track deployment; verify deployed bytecode/address; retry không tạo duplicate record |
| BC-005 | Funding transaction verification service | BC-001, BC-003, SC-ART-002 | Verify chain, token, escrow, sender, amount, receipt success và confirmations |
| BC-006 | Reward payout transaction service | BC-001, SC-ART-002 | Recipient/report/amount được bind với approval; tx lifecycle persist; duplicate payout bị chặn |
| BC-007 | Close/refund transaction service | BC-001, SC-ART-002 | Verify close/refund events và amount; partial/failed tx không đánh dấu complete |
| BC-008 | Shared transaction receipt tracker | BC-001 | Pending/confirmed/reverted/timeout states; configurable confirmations; RPC retry có backoff |
| BC-009 | Typed contract event decoder | BC-001, SC-ART-002 | Funding/payout/refund/report events decode đúng; unknown/malformed logs được bỏ qua an toàn |
| BC-010 | Contract event synchronization worker | BC-008, BC-009, DB-010, DB-011 | Sync theo block cursor; writes idempotent; restart không mất/nhân đôi event |
| BC-011 | Reorg handling | BC-010 | Confirmation window và rollback/replay strategy được test bằng forked fixtures |
| BC-012 | On-chain/database reconciliation command | BC-005, BC-006, BC-007, BC-010 | Dry-run mặc định; phát hiện balance/status mismatch; không tự sửa nếu chưa có explicit flag |

## Guardrails

- Không nhận private key từ browser hoặc log raw signed transaction.
- Không tin transaction hash do client gửi nếu chưa verify receipt và decoded events.
- Mọi write theo event phải unique theo `chainId + transactionHash + logIndex`.
- UI state không phải source of truth cho transaction finality.
