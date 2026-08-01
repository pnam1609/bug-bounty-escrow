/** Typed ABI fragments shared by the server verifier and browser transaction adapter. */

export const ERC20_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'event',
    name: 'Transfer',
    anonymous: false,
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
    ],
  },
] as const;

export const ERC20_READ_ABI = [
  ERC20_ABI[0],
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: 'decimals', type: 'uint8' }],
  },
] as const;

export const GATEWAY_ABI = [
  {
    type: 'event',
    name: 'Deposited',
    anonymous: false,
    inputs: [
      { name: 'token', type: 'address', indexed: true },
      { name: 'depositor', type: 'address', indexed: true },
      { name: 'sender', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
    ],
  },
] as const;

export const ESCROW_ABI = [
  {
    type: 'function',
    name: 'programKey',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'programOwner',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'adminController',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'platformAdmin',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'token',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'refundUnlockAt',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'withdrawRecipient',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'totalFunded',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'totalWithdrawn',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'totalPaid',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'rewards',
    stateMutability: 'view',
    inputs: [{ name: 'reportKey', type: 'bytes32' }],
    outputs: [
      { name: 'approvedContentHash', type: 'bytes32' },
      { name: 'researcher', type: 'address' },
      { name: 'amount', type: 'uint128' },
      { name: 'status', type: 'uint8' },
    ],
  },
  {
    type: 'function',
    name: 'totalApprovedOutstanding',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'closed',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'paused',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'deactivated',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'event',
    name: 'EscrowInitialized',
    anonymous: false,
    inputs: [
      { name: 'programKey', type: 'bytes32', indexed: true },
      { name: 'programOwner', type: 'address', indexed: true },
      { name: 'adminController', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: false },
      { name: 'refundUnlockAt', type: 'uint256', indexed: false },
      { name: 'withdrawRecipient', type: 'address', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'ExternalFundingSynced',
    anonymous: false,
    inputs: [
      { name: 'actor', type: 'address', indexed: true },
      { name: 'newlyObserved', type: 'uint256', indexed: false },
      { name: 'totalFunded', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'RewardApproved',
    anonymous: false,
    inputs: [
      { name: 'reportKey', type: 'bytes32', indexed: true },
      { name: 'approvedContentHash', type: 'bytes32', indexed: true },
      { name: 'researcher', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'RewardPaid',
    anonymous: false,
    inputs: [
      { name: 'reportKey', type: 'bytes32', indexed: true },
      { name: 'researcher', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'EscrowClosed',
    anonymous: false,
    inputs: [{ name: 'actor', type: 'address', indexed: true }],
  },
  {
    type: 'event',
    name: 'RemainingFundsWithdrawn',
    anonymous: false,
    inputs: [
      { name: 'recipient', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
] as const;

export const ESCROW_OWNER_ABI = [
  {
    type: 'function',
    name: 'approveReward',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'reportKey', type: 'bytes32' },
      { name: 'approvedContentHash', type: 'bytes32' },
      { name: 'researcher', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'close',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'withdrawRemaining',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'expectedAmount', type: 'uint256' }],
    outputs: [{ name: 'amount', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'pause',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'unpause',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'deactivate',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'extendRefundUnlockAt',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'newUnlockAt', type: 'uint256' }],
    outputs: [],
  },
] as const;

export const BOUNTY_ESCROW_ADMIN_ABI = [
  {
    type: 'function',
    name: 'adminWallet',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'token',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'programFeeAmount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'payProgramFee',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'programKey', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'registerProgramEscrow',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'programKey', type: 'bytes32' },
      { name: 'escrow', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'withdrawPlatformFees',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'pauseProgram',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'programKey', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'unpauseProgram',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'programKey', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'deactivateProgram',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'programKey', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'closeProgram',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'programKey', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'extendProgramTimeline',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'programKey', type: 'bytes32' },
      { name: 'newUnlockAt', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'approveProgramReward',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'programKey', type: 'bytes32' },
      { name: 'reportKey', type: 'bytes32' },
      { name: 'approvedContentHash', type: 'bytes32' },
      { name: 'researcher', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setProgramFeeAmount',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'newAmount', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'event',
    name: 'ProgramFeePaid',
    anonymous: false,
    inputs: [
      { name: 'programKey', type: 'bytes32', indexed: true },
      { name: 'payer', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
] as const;
