# QA-ARC-01 live Arc Testnet acceptance

This runbook verifies the deployed CP-10 through CP-14 flow with independent
read-only API, Circle and RPC checks. It never submits a transaction, signs a
message, changes a program, or calls a mutating Circle endpoint. Every browser
mutation and wallet prompt remains an explicit operator action.

Do not run this against mainnet. Do not paste an access token, API key, entity
secret, signature, private key, seed phrase or mnemonic into a CLI argument,
state file, ticket, chat or exported evidence.

## Prerequisites

Use a dedicated non-demo owner account and a dedicated draft:

- The owner ID and program ID must not use deterministic demo prefixes.
- The program slug starts with `qa-arc-acceptance-`.
- The server-returned deadline is between 2 minutes and 24 hours away when the
  run starts. Allow enough time for all cross-chain finalization; `close()` still
  cannot succeed before the immutable on-chain `refundUnlockAt`.
- A report belonging to the program has an eligible researcher payout wallet
  and reward tier.
- Owner and immutable withdrawal-recipient public addresses have been reviewed.
- The stable Circle TEST subscription is enabled for exactly
  `gateway.deposit.finalized`, uses
  `https://bountyescrow.xyz/api/webhooks/circle/gateway`, includes domains
  `0`, `3`, `6`, and `26`, and currently uses no more than 48 address slots.
- The Circle deployment wallet is a LIVE developer-controlled SCA on
  `ARC-TESTNET`.

Prepare enough canonical testnet USDC and gas:

| Network          | Required for                                    |
| ---------------- | ----------------------------------------------- |
| Arc Testnet      | Arc Send, reward approval, close and withdrawal |
| Ethereum Sepolia | Unified Balance source deposit                  |
| Base Sepolia     | CCTP Bridge and Unified Balance source deposit  |
| Arbitrum Sepolia | Unified Balance source deposit                  |

The cumulative verified escrow funding must cover the approved reward and leave
a positive unreserved remainder for the withdrawal check. Ethereum, Base and
Arbitrum wallets also need testnet ETH for source transactions. Never use funds
with real economic value.

## Local secret setup

From the repository root, copy the checked-in template to the ignored `.tmp`
directory:

```powershell
New-Item -ItemType Directory -Force .tmp | Out-Null
Copy-Item deploy/qa-arc.env.example .tmp/qa-arc.env
```

Open `.tmp/qa-arc.env` in an editor and replace every placeholder. The
`CIRCLE_GATEWAY_WEBHOOK_SUBSCRIPTION_IDS` value must be one UUID, not a
comma-separated list. `CIRCLE_ENTITY_SECRET` is deliberately not used by this
read-only runner.

Keep the populated file readable only by the operator account. Remove it after
the run. `.tmp/` is ignored by Git and excluded from Docker build context, but
that is not a substitute for local filesystem access control.

## Initialize once

Choose a new state path. Never overwrite or reuse another run:

```powershell
node --import tsx apps/api/scripts/arc-acceptance.ts init `
  --state .tmp/qa-arc-state.json `
  --api-origin https://bountyescrow.xyz `
  --web-origin https://bountyescrow.xyz `
  --program-id <dedicated-program-uuid> `
  --report-id <dedicated-report-uuid>
```

The state contains only bounded public IDs, addresses, hashes and diagnostic
codes. Writes use a lock file, revision compare-and-swap and atomic rename.

## Advance and complete checkpoints

Run one automatic check or reveal the next manual checkpoint:

```powershell
node --env-file=.tmp/qa-arc.env --import tsx `
  apps/api/scripts/arc-acceptance.ts advance `
  --state .tmp/qa-arc-state.json `
  --live-testnet
```

`--live-testnet` must be a bare boolean flag. Values such as
`--live-testnet false` are rejected. Automatic checks perform only authenticated
GET requests, Circle GET requests and read-only JSON-RPC methods.

At a signature checkpoint:

1. Open the returned owner-page URL.
2. Complete every expected browser wallet prompt.
3. Record only the durable public operation evidence. Examples:

   ```powershell
   node --import tsx apps/api/scripts/arc-acceptance.ts record-signature `
     --state .tmp/qa-arc-state.json `
     --label ethereum_gateway_deposit `
     --intent-id <funding-intent-uuid> `
     --deposit-id <source-deposit-uuid> `
     --tx-hash <public-transaction-hash>
   ```

   For the wallet-control challenge, record its public challenge ID and public
   address. For other boundaries, record the server intent/operation ID and any
   returned public transaction hash. If one boundary has multiple wallet
   prompts, record each distinct durable operation before completing it.

4. Only after every prompt in that boundary is finished:

   ```powershell
   node --import tsx apps/api/scripts/arc-acceptance.ts complete-signature `
     --state .tmp/qa-arc-state.json
   ```

The Unified Balance section deliberately proves all three supported external
sources in order: Ethereum Sepolia, Base Sepolia and Arbitrum Sepolia, followed
by the Unified Balance spend to Arc.

The Arc destination receipt must contain exactly one canonical Gateway
`AttestationUsed` event for each project source domain: Ethereum `0`, Arbitrum
`3`, and Base `6`. Their transfer-spec hashes are distinct, their depositors and
signers bind to the intended owner wallet, and their values sum to the single
aggregate canonical USDC mint into the verified escrow. An optional App Kit
`transferId` is only a Forwarder group/status identifier; this project disables
Forwarder, so the ID may be absent or non-hash and is never treated as a
transfer-spec hash or on-chain authority.

The Base Bridge check decodes Circle's official CCTP V2 event layouts, including
the indexed `uint64 nonce` on `DepositForBurn` and the three-field
`MintAndWithdraw(address,uint256,address)` event on Arc. CCTP V2 does not expose
`hookData` on that burn event or `feeCollected` on that mint event; the runner
derives the actual aggregate fee from the durably verified gross and net USDC
amounts instead.

At a reload checkpoint, reload the owner page and confirm the durable UI
projection is hydrated before running:

```powershell
node --env-file=.tmp/qa-arc.env --import tsx `
  apps/api/scripts/arc-acceptance.ts ack-reload `
  --state .tmp/qa-arc-state.json `
  --live-testnet
```

At `end_program`, end the dedicated program in the owner UI and record the
public operation reference:

```powershell
node --import tsx apps/api/scripts/arc-acceptance.ts ack-operator `
  --state .tmp/qa-arc-state.json `
  --operation-id end_program:action:1
```

Ending the product does not change the immutable contract unlock timestamp. If
the close check is reached early, wait for `refundUnlockAt`; do not redeploy,
blind-retry or alter the chain clock.

If an automatic assertion is marked retryable, first inspect and resolve its
stable diagnostic code, then retry the known step:

```powershell
node --env-file=.tmp/qa-arc.env --import tsx `
  apps/api/scripts/arc-acceptance.ts retry `
  --state .tmp/qa-arc-state.json `
  --live-testnet
```

Never create a replacement transaction merely because an RPC response or
browser response was lost. Resume from the durable intent, operation and known
hash shown by the application.

## Export evidence

Inspect status at any time:

```powershell
node --import tsx apps/api/scripts/arc-acceptance.ts status `
  --state .tmp/qa-arc-state.json
```

After every step passes, create a new redacted export:

```powershell
node --import tsx apps/api/scripts/arc-acceptance.ts export `
  --state .tmp/qa-arc-state.json `
  --out .tmp/qa-arc-evidence.json
```

Do not use `--overwrite` for the first export. Verify `completed: true`, review
the allowlisted public evidence, and attach only the redacted export to the
ticket. Delete `.tmp/qa-arc.env` when finished; retain the state/evidence under
the project evidence-retention policy.
