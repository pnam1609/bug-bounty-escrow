// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { BountyEscrow } from "./BountyEscrow.sol";

/// @notice Platform controller for per-program BountyEscrow instances.
/// @dev This contract owns only platform fees and registry metadata. It never has a withdrawal
///      path into a program escrow; `BountyEscrow.withdrawRemaining` is restricted to its immutable
///      program owner. The controller can provide emergency support for non-withdrawal operations.
contract BountyEscrowAdmin {
    using SafeERC20 for IERC20;

    address public constant CANONICAL_ARC_USDC = 0x3600000000000000000000000000000000000000;

    error Unauthorized();
    error InvalidAddress();
    error InvalidToken();
    error InvalidProgramKey();
    error InvalidEscrow();
    error ProgramAlreadyRegistered();
    error ProgramNotRegistered();
    error FeeAlreadyPaid();
    error InvalidFeeAmount();
    error InsufficientFees();

    event AdminInitialized(address indexed adminWallet, address indexed token, uint256 feeAmount);
    event ProgramFeePaid(bytes32 indexed programKey, address indexed payer, uint256 amount);
    event ProgramEscrowRegistered(
        bytes32 indexed programKey, address indexed escrow, address indexed programOwner
    );
    event ProgramEscrowDeactivated(bytes32 indexed programKey, address indexed actor);
    event PlatformFeesWithdrawn(address indexed recipient, uint256 amount);
    event ProgramFeeAmountUpdated(uint256 previousAmount, uint256 newAmount);

    IERC20 public immutable token;
    address public immutable adminWallet;
    uint256 public programFeeAmount;

    mapping(bytes32 programKey => address escrow) public programEscrows;
    mapping(bytes32 programKey => bool paid) public programFeePaid;
    mapping(bytes32 programKey => bool deactivated) public programDeactivated;

    modifier onlyAdmin() {
        if (msg.sender != adminWallet) revert Unauthorized();
        _;
    }

    constructor(address adminWallet_, address token_, uint256 programFeeAmount_) {
        if (adminWallet_ == address(0)) revert InvalidAddress();
        if (token_ != CANONICAL_ARC_USDC) revert InvalidToken();
        if (programFeeAmount_ == 0) revert InvalidFeeAmount();
        adminWallet = adminWallet_;
        token = IERC20(token_);
        programFeeAmount = programFeeAmount_;
        emit AdminInitialized(adminWallet_, token_, programFeeAmount_);
    }

    /// @notice Collects the fixed platform fee for one program.
    /// @dev The owner signs an ERC-20 approval/transferFrom; no program funds enter this contract.
    function payProgramFee(bytes32 programKey) external {
        if (programKey == bytes32(0)) revert InvalidProgramKey();
        if (programFeePaid[programKey]) revert FeeAlreadyPaid();
        programFeePaid[programKey] = true;
        token.safeTransferFrom(msg.sender, address(this), programFeeAmount);
        emit ProgramFeePaid(programKey, msg.sender, programFeeAmount);
    }

    /// @notice Registers a Circle-created escrow whose adminController is this contract.
    function registerProgramEscrow(bytes32 programKey, address escrow) external onlyAdmin {
        if (programKey == bytes32(0)) revert InvalidProgramKey();
        if (escrow == address(0) || programEscrows[programKey] != address(0)) {
            revert ProgramAlreadyRegistered();
        }
        BountyEscrow instance = BountyEscrow(escrow);
        if (
            instance.programKey() != programKey || instance.adminController() != address(this)
                || address(instance.token()) != address(token)
                || instance.withdrawRecipient() != instance.programOwner()
        ) revert InvalidEscrow();
        programEscrows[programKey] = escrow;
        emit ProgramEscrowRegistered(programKey, escrow, instance.programOwner());
    }

    function escrowFor(bytes32 programKey) external view returns (address) {
        return programEscrows[programKey];
    }

    /// @notice Deactivates a program without granting access to its funds.
    function deactivateProgram(bytes32 programKey) external onlyAdmin {
        BountyEscrow escrow = _escrow(programKey);
        escrow.deactivate();
        programDeactivated[programKey] = true;
        emit ProgramEscrowDeactivated(programKey, msg.sender);
    }

    function pauseProgram(bytes32 programKey) external onlyAdmin {
        _escrow(programKey).pause();
    }

    function unpauseProgram(bytes32 programKey) external onlyAdmin {
        _escrow(programKey).unpause();
    }

    function closeProgram(bytes32 programKey) external onlyAdmin {
        _escrow(programKey).close();
    }

    function extendProgramTimeline(bytes32 programKey, uint256 newUnlockAt) external onlyAdmin {
        _escrow(programKey).extendRefundUnlockAt(newUnlockAt);
    }

    function approveProgramReward(
        bytes32 programKey,
        bytes32 reportKey,
        bytes32 approvedContentHash,
        address researcher,
        uint256 amount
    ) external onlyAdmin {
        _escrow(programKey).approveReward(reportKey, approvedContentHash, researcher, amount);
    }

    /// @notice Withdraws only fees accumulated by this admin contract.
    /// @dev Program escrow balances are held by separate contracts and cannot be swept here.
    function withdrawPlatformFees(uint256 amount) external onlyAdmin {
        if (amount == 0 || amount > token.balanceOf(address(this))) revert InsufficientFees();
        token.safeTransfer(adminWallet, amount);
        emit PlatformFeesWithdrawn(adminWallet, amount);
    }

    function setProgramFeeAmount(uint256 newAmount) external onlyAdmin {
        if (newAmount == 0) revert InvalidFeeAmount();
        uint256 previous = programFeeAmount;
        programFeeAmount = newAmount;
        emit ProgramFeeAmountUpdated(previous, newAmount);
    }

    function _escrow(bytes32 programKey) internal view returns (BountyEscrow escrow) {
        address escrowAddress = programEscrows[programKey];
        if (escrowAddress == address(0)) revert ProgramNotRegistered();
        return BountyEscrow(escrowAddress);
    }
}
