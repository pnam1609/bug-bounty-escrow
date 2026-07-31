// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { BountyEscrow } from "../src/BountyEscrow.sol";

interface Vm {
    function etch(address target, bytes calldata code) external;
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
    function expectRevert(bytes4 selector) external;
    function expectRevert(bytes calldata revertData) external;
}

contract MockUSDC is IERC20 {
    mapping(address => uint256) public balanceOf;

    function mint(address account, uint256 amount) external {
        balanceOf[account] += amount;
    }

    function transfer(address recipient, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[recipient] += amount;
        return true;
    }

    function totalSupply() external pure returns (uint256) {
        return 0;
    }

    function allowance(address, address) external pure returns (uint256) {
        return 0;
    }

    function approve(address, uint256) external pure returns (bool) {
        return true;
    }

    function transferFrom(address, address, uint256) external pure returns (bool) {
        return false;
    }
}

contract BountyEscrowTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant USDC = 0x3600000000000000000000000000000000000000;
    address private constant OWNER = address(0xA11CE);
    address private constant RESEARCHER = address(0xB0B);
    address private constant TREASURY = address(0xCAFE);
    bytes32 private constant PROGRAM = keccak256("program");
    bytes32 private constant REPORT = keccak256("report");
    bytes32 private constant CONTENT = keccak256("content");

    MockUSDC private usdc;
    BountyEscrow private escrow;

    function setUp() public {
        MockUSDC implementation = new MockUSDC();
        vm.etch(USDC, address(implementation).code);
        usdc = MockUSDC(USDC);
        escrow = new BountyEscrow(PROGRAM, OWNER, USDC, block.timestamp + 7 days, TREASURY);
    }

    function testExplicitOwnerNotDeployerHasAuthority() public {
        vm.expectRevert(BountyEscrow.Unauthorized.selector);
        escrow.close();
        vm.warp(escrow.refundUnlockAt());
        vm.prank(OWNER);
        escrow.close();
    }

    function testCannotCloseBeforeProgramEnd() public {
        vm.prank(OWNER);
        vm.expectRevert(BountyEscrow.EscrowLocked.selector);
        escrow.close();
    }

    function testSyncIsIdempotentAndPayoutIsPermissionless() public {
        usdc.mint(address(escrow), 100_000000);
        assert(escrow.syncExternalFunding() == 100_000000);
        assert(escrow.syncExternalFunding() == 0);

        vm.prank(OWNER);
        escrow.approveReward(REPORT, CONTENT, RESEARCHER, 25_000000);
        escrow.payReward(REPORT);

        assert(usdc.balanceOf(RESEARCHER) == 25_000000);
        assert(escrow.totalApprovedOutstanding() == 0);
        assert(escrow.totalPaid() == 25_000000);
        assert(escrow.syncExternalFunding() == 0);
    }

    function testCannotApproveOrPayTwice() public {
        usdc.mint(address(escrow), 10_000000);
        escrow.syncExternalFunding();
        vm.prank(OWNER);
        escrow.approveReward(REPORT, CONTENT, RESEARCHER, 5_000000);
        vm.prank(OWNER);
        vm.expectRevert(BountyEscrow.RewardAlreadyExists.selector);
        escrow.approveReward(REPORT, CONTENT, RESEARCHER, 5_000000);
        escrow.payReward(REPORT);
        vm.expectRevert(BountyEscrow.RewardNotApproved.selector);
        escrow.payReward(REPORT);
    }

    function testOwnerOnlyAuthorizationAndInsufficientReservation() public {
        usdc.mint(address(escrow), 10_000000);
        escrow.syncExternalFunding();

        address delegatedApprover = address(0xABCD);
        vm.expectRevert(BountyEscrow.Unauthorized.selector);
        vm.prank(delegatedApprover);
        escrow.approveReward(REPORT, CONTENT, RESEARCHER, 1_000000);

        vm.prank(OWNER);
        vm.expectRevert(BountyEscrow.InsufficientAvailableBalance.selector);
        escrow.approveReward(REPORT, CONTENT, RESEARCHER, 11_000000);

        vm.prank(OWNER);
        escrow.approveReward(REPORT, CONTENT, RESEARCHER, 10_000000);
        assert(escrow.availableBalance() == 0);
    }

    function testCloseBlocksNewApprovalsButKeepsApprovedPayoutExecutable() public {
        usdc.mint(address(escrow), 10_000000);
        escrow.syncExternalFunding();
        vm.prank(OWNER);
        escrow.approveReward(REPORT, CONTENT, RESEARCHER, 4_000000);

        vm.warp(escrow.refundUnlockAt());
        vm.prank(OWNER);
        escrow.close();

        vm.prank(OWNER);
        vm.expectRevert(BountyEscrow.EscrowAlreadyClosed.selector);
        escrow.approveReward(keccak256("later"), CONTENT, RESEARCHER, 1_000000);
        escrow.payReward(REPORT);
        assert(usdc.balanceOf(RESEARCHER) == 4_000000);
    }

    function testCannotWithdrawWhileApprovedRewardIsOutstanding() public {
        usdc.mint(address(escrow), 10_000000);
        escrow.syncExternalFunding();
        vm.prank(OWNER);
        escrow.approveReward(REPORT, CONTENT, RESEARCHER, 4_000000);
        vm.warp(escrow.refundUnlockAt());
        vm.prank(OWNER);
        escrow.close();
        vm.prank(OWNER);
        vm.expectRevert(BountyEscrow.OutstandingRewards.selector);
        escrow.withdrawRemaining(10_000000);
    }

    function testCannotWithdrawBeforeCloseEvenAfterUnlock() public {
        usdc.mint(address(escrow), 10_000000);
        vm.warp(escrow.refundUnlockAt());
        vm.prank(OWNER);
        vm.expectRevert(BountyEscrow.EscrowNotClosed.selector);
        escrow.withdrawRemaining(10_000000);
    }

    function testUnauthorizedCallerCannotWithdrawAfterClose() public {
        usdc.mint(address(escrow), 10_000000);
        vm.warp(escrow.refundUnlockAt());
        vm.prank(OWNER);
        escrow.close();

        vm.expectRevert(BountyEscrow.Unauthorized.selector);
        escrow.withdrawRemaining(10_000000);
    }

    function testRefundUnlockCanOnlyBeExtended() public {
        uint256 previous = escrow.refundUnlockAt();
        vm.prank(OWNER);
        vm.expectRevert(BountyEscrow.InvalidUnlockTime.selector);
        escrow.extendRefundUnlockAt(previous);
        vm.prank(OWNER);
        escrow.extendRefundUnlockAt(previous + 1 days);
        assert(escrow.refundUnlockAt() == previous + 1 days);
    }

    function testWithdrawRequiresCloseUnlockAndNoOutstanding() public {
        usdc.mint(address(escrow), 10_000000);
        escrow.syncExternalFunding();
        vm.prank(OWNER);
        vm.expectRevert(BountyEscrow.EscrowLocked.selector);
        escrow.close();

        vm.warp(escrow.refundUnlockAt());
        vm.prank(OWNER);
        escrow.close();
        vm.prank(OWNER);
        assert(escrow.withdrawRemaining(10_000000) == 10_000000);
        assert(usdc.balanceOf(TREASURY) == 10_000000);
        vm.prank(OWNER);
        vm.expectRevert(BountyEscrow.NoRemainingFunds.selector);
        escrow.withdrawRemaining(0);
    }

    function testNewDirectFundsAfterPayoutAndWithdrawalAreReconciledExactlyOnce() public {
        usdc.mint(address(escrow), 20_000000);
        assert(escrow.syncExternalFunding() == 20_000000);
        vm.prank(OWNER);
        escrow.approveReward(REPORT, CONTENT, RESEARCHER, 5_000000);
        escrow.payReward(REPORT);

        usdc.mint(address(escrow), 3_000000);
        assert(escrow.syncExternalFunding() == 3_000000);
        assert(escrow.syncExternalFunding() == 0);

        vm.warp(escrow.refundUnlockAt());
        vm.prank(OWNER);
        escrow.close();
        vm.prank(OWNER);
        escrow.withdrawRemaining(18_000000);

        usdc.mint(address(escrow), 2_000000);
        assert(escrow.syncExternalFunding() == 2_000000);
        assert(escrow.syncExternalFunding() == 0);
        vm.prank(OWNER);
        assert(escrow.withdrawRemaining(2_000000) == 2_000000);
    }

    function testWithdrawalSnapshotLeavesLateFundsForANewIntent() public {
        usdc.mint(address(escrow), 10_000000);
        escrow.syncExternalFunding();
        vm.warp(escrow.refundUnlockAt());
        vm.prank(OWNER);
        escrow.close();

        usdc.mint(address(escrow), 1);
        vm.prank(OWNER);
        assert(escrow.withdrawRemaining(10_000000) == 10_000000);

        assert(usdc.balanceOf(address(escrow)) == 1);
        assert(escrow.totalWithdrawn() == 10_000000);
        vm.prank(OWNER);
        assert(escrow.withdrawRemaining(1) == 1);
    }

    function testWithdrawalSnapshotRevertsIfBalanceFallsBelowExpected() public {
        usdc.mint(address(escrow), 10_000000);
        vm.warp(escrow.refundUnlockAt());
        vm.prank(OWNER);
        escrow.close();
        vm.prank(OWNER);
        vm.expectRevert(
            abi.encodeWithSelector(
                BountyEscrow.WithdrawalBalanceBelowExpected.selector, 10_000001, 10_000000
            )
        );
        escrow.withdrawRemaining(10_000001);
    }

    function testFuzzSyncNeverDoubleCounts(uint96 amount) public {
        if (amount == 0) amount = 1;
        usdc.mint(address(escrow), amount);
        assert(escrow.syncExternalFunding() == amount);
        assert(escrow.syncExternalFunding() == 0);
        assert(escrow.totalFunded() == amount);
    }

    function testConstructorRejectsInvalidAuthorityTokenAndUnlock() public {
        vm.expectRevert(BountyEscrow.InvalidProgramKey.selector);
        new BountyEscrow(bytes32(0), OWNER, USDC, block.timestamp + 1, TREASURY);
        vm.expectRevert(BountyEscrow.InvalidAddress.selector);
        new BountyEscrow(PROGRAM, address(0), USDC, block.timestamp + 1, TREASURY);
        vm.expectRevert(BountyEscrow.InvalidToken.selector);
        new BountyEscrow(PROGRAM, OWNER, address(0x1234), block.timestamp + 1, TREASURY);
        vm.expectRevert(BountyEscrow.InvalidUnlockTime.selector);
        new BountyEscrow(PROGRAM, OWNER, USDC, block.timestamp, TREASURY);
    }
}
