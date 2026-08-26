// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { ARCFT } from "./ARCFT.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title CoinVault
 * @notice The reserve that keeps ARCFT stable. Holds testnet coin backing every
 *         minted ARCFT token. Deposit = lock coin + mint ARCFT. Redeem = burn
 *         ARCFT + release coin. Strictly 1:1 — this is what makes the arcade
 *         economy a real, spendable economy instead of a dead game token.
 *
 *         "Testnet coin" on Creditcoin is the native coin. The vault holds a
 *         spendable balance of it; we account for it via the ledger below so
 *         withdrawals stay fully collateralized at all times.
 */
contract CoinVault is Ownable {
    ARCFT public immutable arcft;

    /// @notice Total testnet-coin value locked backing minted ARCFT.
    uint256 public lockedCoin;

    /// @notice Emitted when testnet coin is deposited and ARCFT minted.
    event Deposited(address indexed depositor, uint256 coinAmount, uint256 arcftMinted);
    /// @notice Emitted when ARCFT is burned and testnet coin released.
    event Redeemed(address indexed redeemer, uint256 arcftBurned, uint256 coinReleased);

    error InsufficientLockedReserve(uint256 requested, uint256 available);
    error VaultNotFunded();

    constructor(address arcft_) Ownable(msg.sender) {
        arcft = ARCFT(arcft_);
    }

    /**
     * @notice Deposit testnet coin, mint ARCFT 1:1.
     * @dev Caller must have approved/sent coin. For a native-coin-funded build,
     *      the operator (or a forwarder) transfers coin into the vault first,
     *      then this mints against lockedCoin. To keep it atomic and safe we
     *      gate on the actual coin balance actually received.
     */
    function deposit() external payable {
        if (msg.value == 0) revert VaultNotFunded();
        lockedCoin += msg.value;
        arcft.mint(msg.sender, msg.value);
        emit Deposited(msg.sender, msg.value, msg.value);
    }

    /**
     * @notice Burn ARCFT and release testnet coin 1:1.
     * @dev Withdrawable economy: released coin can be sent anywhere, but a
     *      withdrawable-coin path (native coin payout) typically goes through
     *      the ArcadeBank to apply cuts. Here we release to the caller.
     */
    function redeem(uint256 arcftAmount) external {
        if (arcftAmount == 0) revert VaultNotFunded();
        if (lockedCoin < arcftAmount) {
            revert InsufficientLockedReserve(arcftAmount, lockedCoin);
        }
        // Burn first, then release coin — invariant: coin never leaves unless
        // the matching ARCFT is destroyed.
        arcft.burn(msg.sender, arcftAmount);
        lockedCoin -= arcftAmount;
        (bool ok, ) = msg.sender.call{ value: arcftAmount }("");
        require(ok, "CoinVault: coin transfer failed");
        emit Redeemed(msg.sender, arcftAmount, arcftAmount);
    }

    /** @dev Receive coin backing. */
    receive() external payable {}
}
