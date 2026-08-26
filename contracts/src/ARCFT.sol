// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ARCFT — Arcade Fuel Token
 * @notice In-game ERC-20 on Creditcoin. Backed 1:1 by testnet coin held in the
 *         CoinVault. Minted on deposit, burned on redeem/withdraw. Minting is
 *         restricted to the vault so the peg can never diverge.
 *
 *         The Attestcoin flow binds to this token: ScoreASC-verified game
 *         results drive the ArcadeBank payouts denominated in ARCFT.
 */
contract ARCFT is ERC20, Ownable {
    /// @notice Sole minter/burner — set to the CoinVault on deployment.
    address public vault;

    event VaultSet(address indexed vault);
    event PausedSet(bool paused);

    bool public paused;

    error NotVault();
    error TransferWhilePaused();

    modifier onlyVault() {
        if (msg.sender != vault) revert NotVault();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert TransferWhilePaused();
        _;
    }

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) Ownable(msg.sender) {}

    /** @notice Point ARCFT at the vault (can be set once). */
    function setVault(address vault_) external onlyOwner {
        vault = vault_;
        emit VaultSet(vault_);
    }

    /** @notice Emergency kill switch for transfers (rollout safety). */
    function setPaused(bool paused_) external onlyVault {
        paused = paused_;
        emit PausedSet(paused_);
    }

    /** @dev Only the vault mints — keeps the 1:1 coin backing honest. */
    function mint(address to, uint256 amount) external onlyVault {
        _mint(to, amount);
    }

    /** @dev Only the vault burns — happens on redeem back to testnet coin. */
    function burn(address from, uint256 amount) external onlyVault {
        _burn(from, amount);
    }

    /// @dev Pause guard — only affects transfers; mint/burn (vault) always allowed.
    function transfer(address to, uint256 amount) public override whenNotPaused returns (bool) {
        return super.transfer(to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) public override whenNotPaused returns (bool) {
        return super.transferFrom(from, to, amount);
    }
}
