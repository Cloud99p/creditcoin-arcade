# creditcoin-foundry-template

A Foundry template for building and deploying Solidity contracts on Creditcoin, with a one-command local devnet via Docker.

- **Foundry project** pre-configured for Creditcoin 3 (CC3) and its Frontier EVM quirks.
- **Dockerized local devnet** based on the official [creditcoin3](https://github.com/gluwa/creditcoin3) image, with Foundry and this repo baked in.
- **Sample `Counter` contract**, deploy script, and test — a known-good end-to-end baseline you can replace with your own work.

## Quick start

### 1. Clone with submodules

```shell
git clone --recurse-submodules https://github.com/gluwa/creditcoin-foundry-template.git
cd creditcoin-foundry-template
```

### 2. Build and test

```shell
forge build
forge test
```

### 3. Run a local CC3 devnet

Run a plain node (RPC on `http://127.0.0.1:9944`):

```shell
docker build -f docker/Dockerfile -t creditcoin-foundry-template:dev .
docker run --rm -p 9944:9944 creditcoin-foundry-template:dev
```

Or, with Docker Compose:

```shell
cp .env.example .env     # optionally fill in PRIVATE_KEY
cd docker
docker compose up --build
```

### 4. Deploy the sample contract

Against the local devnet:

```shell
forge script script/Deploy.s.sol:Deploy \
  --rpc-url cc3-local \
  --private-key $PRIVATE_KEY \
  --broadcast \
  --slow \
  --gas-estimate-multiplier 500 \
  --evm-version shanghai
```

Or let the container do it — set `AUTO_DEPLOY=1`, `AUTO_FUND_FROM_NODE=1`, and a `PRIVATE_KEY` in `.env`, then `docker compose up`. The container will boot the node, fund your deployer from the CC3 dev account (Alith), and run `forge script` automatically.

Against devnet:

```shell
forge script script/Deploy.s.sol:Deploy \
  --rpc-url cc3-devnet \
  --private-key $PRIVATE_KEY \
  --broadcast \
  --slow \
  --gas-estimate-multiplier 500 \
  --evm-version shanghai
```

## CC3 compatibility notes

Creditcoin 3 uses Frontier (Substrate's EVM pallet), which is mostly but not exactly EVM-equivalent. This template pre-configures the things that matter; the list below exists so you understand *why* the configuration looks like it does, and what to watch for when writing your own contracts and scripts.

### RPC

- **Single port, both protocols.** CC3 serves HTTP **and** WebSocket RPC on `9944`. There is no separate `8545`. `foundry.toml` defines `cc3-local = http://127.0.0.1:9944`.
- **Two namespaces.** Frontier exposes both Substrate (`system_*`, `chain_*`) and Ethereum (`eth_*`) RPC methods. The container's entrypoint probes `eth_chainId` after boot; if it fails, the node was started without Ethereum RPC enabled and deployment cannot proceed.

### EVM version

- The entrypoint passes `--evm-version shanghai` to `forge script`. Using newer opcodes (Cancun/Prague blob/randomness primitives) against a node that does not support them will silently produce broken bytecode or `invalid opcode` reverts. Check the target CC3 release's supported EVM version before upgrading this.
- Devnet sometimes runs ahead of mainnet — verify with `cast rpc web3_clientVersion --rpc-url cc3-devnet` before switching EVM versions for on-chain deploys.

### PREVRANDAO

- `bypass_prevrandao = true` in `foundry.toml`. Frontier's implementation of `block.prevrandao` is not cryptographically random and does not match L1 semantics — do not use it for randomness in contracts targeting CC3.

### Gas and block timing

- `--slow` and `--gas-estimate-multiplier 500` are used on `forge script`. CC3 blocks are slower than L1 and gas estimation is less tight; without these flags, multi-transaction scripts can race ahead of block inclusion and transactions can under-estimate gas.

### Dev account (Alith)

- `0x5fb92d6e98884f76de468fa3f6278f8807c48bebc13595d45af5bdc4da702133` is Alith's private key, pre-funded when CC3 runs with `--dev`. The entrypoint uses it to fund the deployer when `AUTO_FUND_FROM_NODE=1`. This key is **public knowledge** — only valid against local dev chains; never rely on it for devnet/testnet/mainnet.

### Chain IDs

| Network | Chain ID | RPC |
|---|---|---|
| CC3 devnet | `102032` | `https://rpc.cc3-devnet.creditcoin.network` |
| CC3 local `--dev` | typically `102030` | `http://127.0.0.1:9944` |

### Contract verification

- The devnet uses Blockscout, not Etherscan. Pass `--verifier blockscout --verifier-url https://creditcoin-devnet.blockscout.com/api/ --chain 102032` to `forge verify-contract`.
- `forge script --verify` only auto-verifies contracts created via top-level `CREATE` from the script. Contracts created by factory calls (e.g. `Manager.createChild(...)`) must be verified manually with `forge verify-contract` and explicit constructor args.

## Container modes

The same image runs in three modes depending on env vars:

| Env | Behavior |
|---|---|
| *(none)* | Runs `creditcoin3-node --dev`. RPC on 9944. No deploy, no funding. |
| `AUTO_FUND_FROM_NODE=1` + `PRIVATE_KEY` | Boots node, funds your deployer from Alith, then serves RPC. |
| `AUTO_DEPLOY=1` + `PRIVATE_KEY` | Boots node, (optionally funds,) runs `forge script Deploy`, then serves RPC. |

`AUTO_DEPLOY` defaults to **off** so the image is useful to anyone who just wants a local RPC endpoint.

## Project layout

```
.
├── foundry.toml            CC3-tuned Foundry config
├── src/Counter.sol         Sample contract
├── script/Deploy.s.sol     Deployment script
├── test/Counter.t.sol      Forge test
├── docker/
│   ├── Dockerfile          gluwa/creditcoin3 + foundryup
│   ├── docker-compose.yml  Ports, env wiring
│   └── entrypoint.sh       Node + RPC probes + optional fund/deploy
├── .github/workflows/ci.yml  forge build + test on PRs
├── .env.example            PRIVATE_KEY, AUTO_DEPLOY, AUTO_FUND_FROM_NODE
└── lib/forge-std           Submodule
```

## Commands

```shell
forge build                 # Compile
forge test                  # Run tests
forge fmt                   # Format Solidity
forge snapshot              # Gas snapshot

cast chain-id --rpc-url cc3-local           # Verify local RPC is up
cast balance <addr> --rpc-url cc3-local     # Check a balance
```

## License

MIT.
