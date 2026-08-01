// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { BountyEscrow } from "../src/BountyEscrow.sol";
import { BountyEscrowAdmin } from "../src/BountyEscrowAdmin.sol";

interface Vm {
    function etch(address target, bytes calldata code) external;
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
    function expectRevert(bytes4 selector) external;
    function expectRevert(bytes calldata revertData) external;
}

contract MockUSDC is IERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowances;

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

    function allowance(address account, address spender) external view returns (uint256) {
        return allowances[account][spender];
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowances[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount && allowances[from][msg.sender] >= amount, "balance");
        allowances[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract BountyEscrowTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant USDC = 0x3600000000000000000000000000000000000000;
    address private constant OWNER = address(0xA11CE);
    address private constant ADMIN = address(0xAD01);
    address private constant RESEARCHER = address(0xB0B);
    bytes32 private constant PROGRAM = keccak256("program");
    bytes32 private constant REPORT = keccak256("report");
    bytes32 private constant CONTENT = keccak256("content");

    MockUSDC private usdc;
    BountyEscrow private escrow;

    function setUp() public {
        MockUSDC implementation = new MockUSDC();
        vm.etch(USDC, address(implementation).code);
        usdc = MockUSDC(USDC);
        escrow = new BountyEscrow(PROGRAM, OWNER, ADMIN, USDC, block.timestamp + 7 days, OWNER);
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
        assert(usdc.balanceOf(OWNER) == 10_000000);
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
        new BountyEscrow(bytes32(0), OWNER, ADMIN, USDC, block.timestamp + 1, OWNER);
        vm.expectRevert(BountyEscrow.InvalidAddress.selector);
        new BountyEscrow(PROGRAM, address(0), ADMIN, USDC, block.timestamp + 1, OWNER);
        vm.expectRevert(BountyEscrow.InvalidToken.selector);
        new BountyEscrow(PROGRAM, OWNER, ADMIN, address(0x1234), block.timestamp + 1, OWNER);
        vm.expectRevert(BountyEscrow.InvalidUnlockTime.selector);
        new BountyEscrow(PROGRAM, OWNER, ADMIN, USDC, block.timestamp, OWNER);
    }
}

contract BountyEscrowAdminTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant USDC = 0x3600000000000000000000000000000000000000;
    address private constant ADMIN = address(0xAD01);
    address private constant OWNER = address(0xA11CE);
    bytes32 private constant PROGRAM = keccak256("admin-program");

    MockUSDC private usdc;
    BountyEscrowAdmin private controller;
    BountyEscrow private escrow;

    function setUp() public {
        MockUSDC implementation = new MockUSDC();
        vm.etch(USDC, address(implementation).code);
        usdc = MockUSDC(USDC);
        controller = new BountyEscrowAdmin(ADMIN, USDC, 10_000000);
        escrow = new BountyEscrow(
            PROGRAM, OWNER, address(controller), USDC, block.timestamp + 7 days, OWNER
        );
        vm.prank(ADMIN);
        controller.registerProgramEscrow(PROGRAM, address(escrow));
    }

    function testCollectsAndWithdrawsOnlyPlatformFees() public {
        usdc.mint(OWNER, 10_000000);
        vm.prank(OWNER);
        usdc.approve(address(controller), 10_000000);
        vm.prank(OWNER);
        controller.payProgramFee(PROGRAM);
        assert(usdc.balanceOf(address(controller)) == 10_000000);

        vm.prank(ADMIN);
        controller.withdrawPlatformFees(10_000000);
        assert(usdc.balanceOf(ADMIN) == 10_000000);
    }

    function testRejectsDuplicateFeeAndNonAdminWithdrawal() public {
        usdc.mint(OWNER, 20_000000);
        vm.prank(OWNER);
        usdc.approve(address(controller), 20_000000);
        vm.prank(OWNER);
        controller.payProgramFee(PROGRAM);
        vm.prank(OWNER);
        vm.expectRevert(BountyEscrowAdmin.FeeAlreadyPaid.selector);
        controller.payProgramFee(PROGRAM);
        vm.prank(OWNER);
        vm.expectRevert(BountyEscrowAdmin.Unauthorized.selector);
        controller.withdrawPlatformFees(1);
    }

    function testAdminCanSupportProgramOperationsButNeverWithdraw() public {
        usdc.mint(address(escrow), 10_000000);
        escrow.syncExternalFunding();
        vm.prank(ADMIN);
        controller.pauseProgram(PROGRAM);
        vm.prank(ADMIN);
        controller.unpauseProgram(PROGRAM);
        vm.warp(escrow.refundUnlockAt());
        vm.prank(ADMIN);
        controller.closeProgram(PROGRAM);
        vm.prank(ADMIN);
        vm.expectRevert(BountyEscrow.Unauthorized.selector);
        escrow.withdrawRemaining(10_000000);
        vm.prank(OWNER);
        escrow.withdrawRemaining(10_000000);
        assert(usdc.balanceOf(OWNER) == 10_000000);
    }

    function testOnlyAdminCanDeactivateProgram() public {
        vm.prank(OWNER);
        vm.expectRevert(BountyEscrow.Unauthorized.selector);
        escrow.deactivate();

        vm.prank(ADMIN);
        controller.deactivateProgram(PROGRAM);
        assert(escrow.deactivated());
    }

    function testCannotRegisterEscrowWithDifferentController() public {
        bytes32 otherProgram = keccak256("other");
        BountyEscrow other =
            new BountyEscrow(otherProgram, OWNER, ADMIN, USDC, block.timestamp + 7 days, OWNER);
        vm.prank(ADMIN);
        vm.expectRevert(BountyEscrowAdmin.InvalidEscrow.selector);
        controller.registerProgramEscrow(otherProgram, address(other));
    }
}
