# Solidity smart contract tasks

Mỗi contract action và nhóm security test là một task riêng. ABI chỉ được tạo từ compiled artifacts.

## Design and implementation

| ID | Outcome | Depends on | Acceptance criteria |
|---|---|---|---|
| SC-001 | Chốt escrow invariants, roles và state machine | FND-004 | Funding/payout/refund invariants được document; invalid transitions liệt kê; threat assumptions rõ |
| SC-002 | Implement escrow storage, constructor và roles | SC-001 | Immutable token/owner/program identifiers; zero address bị từ chối; role tests pass |
| SC-003 | Implement USDC funding | SC-002 | Dùng `SafeERC20`; balance/accounting cập nhật đúng; emit funding event; zero amount bị từ chối |
| SC-004 | Implement report hash registration | SC-002 | Hash unique theo rule; không lưu report content; event/indexing fields đúng |
| SC-005 | Implement reward approval state | SC-002, SC-004 | Chỉ authorized role; amount hợp lệ; approval không chuyển token |
| SC-006 | Implement reward payout | SC-003, SC-005 | Không double payout/overdraw; checks-effects-interactions; emit payout event |
| SC-007 | Implement close and remaining-funds refund | SC-003 | Chỉ close/expired state hợp lệ; refund một lần; emit close/refund events |
| SC-008 | Implement pause/emergency control nếu được chấp thuận | SC-002 | Quyền pause giới hạn; unpause auditable; không tạo đường rút tiền tùy ý |
| SC-009 | Implement escrow factory | SC-002 | Deployment deterministic/traceable; registry mapping đúng; duplicate program bị chặn |

## Contract tests

| ID | Outcome | Depends on | Acceptance criteria |
|---|---|---|---|
| SC-TST-001 | Constructor và access-control tests | SC-002 | Happy/negative tests cho owner/reviewer/unauthorized/zero address |
| SC-TST-002 | Funding tests | SC-003 | Multiple deposits, zero amount, allowance failure và accounting assertions |
| SC-TST-003 | Report hash và approval tests | SC-004, SC-005 | Duplicate hash, unauthorized approval và invalid amount/state được cover |
| SC-TST-004 | Payout tests | SC-006 | Success, double payout, insufficient balance, wrong recipient/state và event assertions |
| SC-TST-005 | Refund/close tests | SC-007 | Early/unauthorized/double refund bị từ chối; remaining balance chính xác |
| SC-TST-006 | Reentrancy và malicious-token tests | SC-006, SC-007 | Reentrant path bị chặn; state không corrupt; assumptions về USDC được document |
| SC-TST-007 | Fuzz tests cho accounting invariants | SC-003, SC-006, SC-007 | Tổng payout + refund không vượt funding; remaining balance không âm qua action sequences |
| SC-TST-008 | Factory tests | SC-009 | Registry, ownership, event và duplicate deployment cases được cover |

## Deployment artifacts

| ID | Outcome | Depends on | Acceptance criteria |
|---|---|---|---|
| SC-ART-001 | Arc Testnet deployment script | SC-009, SC-TST-001 đến SC-TST-008 | Env validation; deployment output machine-readable; address/tx được lưu theo chain |
| SC-ART-002 | Generate ABI và typed bindings | SC-ART-001 | ABI sinh từ artifacts; viem types compile; CI phát hiện ABI stale |
| SC-ART-003 | Contract verification runbook | SC-ART-001 | Compiler/settings/constructor args được ghi lại; verify command reproducible |
