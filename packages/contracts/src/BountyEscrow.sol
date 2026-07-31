// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice One canonical Arc USDC escrow per BountyEscrow program.
/// @dev Program/report content never enters this contract. Circle's deployment wallet receives no
///      authority: every privileged role is assigned from the explicit `owner_` constructor arg.
contract BountyEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public constant CANONICAL_ARC_USDC = 0x3600000000000000000000000000000000000000;

    enum RewardStatus {
        None,
        Approved,
        Paid
    }

    struct Reward {
        bytes32 approvedContentHash;
        address researcher;
        uint128 amount;
        RewardStatus status;
    }

    error Unauthorized();
    error InvalidProgramKey();
    error InvalidAddress();
    error InvalidToken();
    error InvalidUnlockTime();
    error EscrowAlreadyClosed();
    error EscrowNotClosed();
    error EscrowLocked();
    error OutstandingRewards();
    error InvalidReward();
    error RewardAlreadyExists();
    error RewardNotApproved();
    error InsufficientAvailableBalance();
    error NoRemainingFunds();
    error WithdrawalBalanceBelowExpected(uint256 expectedAmount, uint256 currentAmount);

    event EscrowInitialized(
        bytes32 indexed programKey,
        address indexed owner,
        address indexed token,
        uint256 refundUnlockAt,
        address withdrawRecipient
    );
    event ExternalFundingSynced(address indexed actor, uint256 newlyObserved, uint256 totalFunded);
    event RewardApproved(
        bytes32 indexed reportKey,
        bytes32 indexed approvedContentHash,
        address indexed researcher,
        uint256 amount
    );
    event RewardPaid(bytes32 indexed reportKey, address indexed researcher, uint256 amount);
    event RefundUnlockExtended(uint256 previousUnlockAt, uint256 newUnlockAt);
    event EscrowClosed(address indexed actor);
    event RemainingFundsWithdrawn(address indexed recipient, uint256 amount);

    bytes32 public immutable programKey;
    IERC20 public immutable token;
    address public immutable owner;
    address public immutable withdrawRecipient;
    uint256 public refundUnlockAt;
    bool public closed;

    uint256 public totalFunded;
    uint256 public totalPaid;
    uint256 public totalWithdrawn;
    uint256 public totalApprovedOutstanding;

    mapping(bytes32 reportKey => Reward reward) public rewards;

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor(
        bytes32 programKey_,
        address owner_,
        address token_,
        uint256 refundUnlockAt_,
        address withdrawRecipient_
    ) {
        if (programKey_ == bytes32(0)) revert InvalidProgramKey();
        if (owner_ == address(0) || withdrawRecipient_ == address(0)) revert InvalidAddress();
        if (token_ != CANONICAL_ARC_USDC) revert InvalidToken();
        if (refundUnlockAt_ <= block.timestamp) revert InvalidUnlockTime();

        programKey = programKey_;
        owner = owner_;
        token = IERC20(token_);
        refundUnlockAt = refundUnlockAt_;
        withdrawRecipient = withdrawRecipient_;
        emit EscrowInitialized(programKey_, owner_, token_, refundUnlockAt_, withdrawRecipient_);
    }

    function approvedOutstanding() external view returns (uint256) {
        return totalApprovedOutstanding;
    }

    function availableBalance() public view returns (uint256) {
        uint256 balance = token.balanceOf(address(this));
        return balance > totalApprovedOutstanding ? balance - totalApprovedOutstanding : 0;
    }

    function isReportPaid(bytes32 reportKey) external view returns (bool) {
        return rewards[reportKey].status == RewardStatus.Paid;
    }

    /// @notice Reconciles USDC sent directly by Send, Bridge, Gateway, or a third party.
    /// @dev Repeated calls are idempotent because lifetime outflow is added back to live balance.
    function syncExternalFunding() external returns (uint256 newlyObserved) {
        uint256 observedLifetimeInflow = token.balanceOf(address(this)) + totalPaid + totalWithdrawn;
        if (observedLifetimeInflow > totalFunded) {
            newlyObserved = observedLifetimeInflow - totalFunded;
            totalFunded = observedLifetimeInflow;
            emit ExternalFundingSynced(msg.sender, newlyObserved, observedLifetimeInflow);
        }
    }

    function approveReward(
        bytes32 reportKey,
        bytes32 approvedContentHash,
        address researcher,
        uint256 amount
    ) external onlyOwner {
        if (closed) revert EscrowAlreadyClosed();
        if (
            reportKey == bytes32(0) || approvedContentHash == bytes32(0) || researcher == address(0)
                || amount == 0 || amount > type(uint128).max
        ) revert InvalidReward();
        if (rewards[reportKey].status != RewardStatus.None) revert RewardAlreadyExists();
        if (amount > availableBalance()) revert InsufficientAvailableBalance();

        rewards[reportKey] = Reward({
            approvedContentHash: approvedContentHash,
            researcher: researcher,
            amount: uint128(amount),
            status: RewardStatus.Approved
        });
        totalApprovedOutstanding += amount;
        emit RewardApproved(reportKey, approvedContentHash, researcher, amount);
    }

    /// @notice Anyone may execute an immutable approved payout; recipient/amount cannot be changed.
    function payReward(bytes32 reportKey) external nonReentrant {
        Reward storage reward = rewards[reportKey];
        if (reward.status != RewardStatus.Approved) revert RewardNotApproved();

        uint256 amount = reward.amount;
        address researcher = reward.researcher;
        reward.status = RewardStatus.Paid;
        totalApprovedOutstanding -= amount;
        totalPaid += amount;
        token.safeTransfer(researcher, amount);
        emit RewardPaid(reportKey, researcher, amount);
    }

    function extendRefundUnlockAt(uint256 newUnlockAt) external onlyOwner {
        uint256 previous = refundUnlockAt;
        if (newUnlockAt <= previous) revert InvalidUnlockTime();
        refundUnlockAt = newUnlockAt;
        emit RefundUnlockExtended(previous, newUnlockAt);
    }

    function close() external onlyOwner {
        if (closed) revert EscrowAlreadyClosed();
        if (block.timestamp < refundUnlockAt) revert EscrowLocked();
        closed = true;
        emit EscrowClosed(msg.sender);
    }

    /// @notice Withdraws the exact balance locked by the server-created withdrawal intent.
    /// @dev Transfers only the snapshot amount. Later direct funding stays in escrow for a new
    ///      late-funding scan and withdrawal intent, while an unexpectedly lower balance fails.
    function withdrawRemaining(uint256 expectedAmount)
        external
        onlyOwner
        nonReentrant
        returns (uint256 amount)
    {
        if (!closed) revert EscrowNotClosed();
        if (block.timestamp < refundUnlockAt) revert EscrowLocked();
        if (totalApprovedOutstanding != 0) revert OutstandingRewards();

        if (expectedAmount == 0) revert NoRemainingFunds();
        uint256 currentAmount = token.balanceOf(address(this));
        if (currentAmount < expectedAmount) {
            revert WithdrawalBalanceBelowExpected(expectedAmount, currentAmount);
        }
        amount = expectedAmount;
        totalWithdrawn += amount;
        token.safeTransfer(withdrawRecipient, amount);
        emit RemainingFundsWithdrawn(withdrawRecipient, amount);
    }
}
