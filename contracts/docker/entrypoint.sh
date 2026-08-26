#!/usr/bin/env bash
set -euo pipefail

NODE_BIN="${CC3_NODE_BIN:-/bin/creditcoin3-node}"
# CC3 serves both HTTP and WS RPC on port 9944 by default.
ETH_RPC_URL="${ETH_RPC_URL:-http://127.0.0.1:9944}"
WORKSPACE="${WORKSPACE:-/workspace}"
WAIT_SECS="${RPC_WAIT_SECS:-180}"
EVM_VERSION="${EVM_VERSION:-shanghai}"

AUTO_DEPLOY="${AUTO_DEPLOY:-0}"
AUTO_FUND_FROM_NODE="${AUTO_FUND_FROM_NODE:-0}"
FUND_AMOUNT="${AUTO_FUND_AMOUNT:-10ether}"

# Alith is the Frontier dev account, pre-funded when running `--dev`.
# Only valid against the local --dev node; useless on devnet/testnet.
ALITH_KEY="${ALITH_PRIVATE_KEY:-0x5fb92d6e98884f76de468fa3f6278f8807c48bebc13595d45af5bdc4da702133}"

if [[ $# -eq 0 ]]; then
  set -- \
    --dev \
    --rpc-external \
    --unsafe-rpc-external \
    --base-path "${CC3_BASE_PATH:-/creditcoin-node/data}"
fi

echo "[cc3-template] starting creditcoin-node: ${NODE_BIN} $*"
"${NODE_BIN}" "$@" &
NODE_PID=$!

cleanup() {
  if kill -0 "${NODE_PID}" 2>/dev/null; then
    kill "${NODE_PID}" 2>/dev/null || true
    wait "${NODE_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

wait_for_rpc() {
  echo "[cc3-template] waiting for EVM RPC at ${ETH_RPC_URL} (max ${WAIT_SECS}s)"
  for ((i = 1; i <= WAIT_SECS; i++)); do
    if cast chain-id --rpc-url "${ETH_RPC_URL}" >/dev/null 2>&1; then
      echo "[cc3-template] RPC ready (chain id $(cast chain-id --rpc-url "${ETH_RPC_URL}"))"
      return 0
    fi
    if ! kill -0 "${NODE_PID}" 2>/dev/null; then
      echo "[cc3-template] creditcoin-node exited before RPC became ready" >&2
      wait "${NODE_PID}" || true
      exit 1
    fi
    sleep 1
  done
  echo "[cc3-template] timed out waiting for RPC at ${ETH_RPC_URL}" >&2
  exit 1
}

# Frontier exposes both Substrate and Ethereum RPC namespaces. If a node is
# misconfigured and exposes only Substrate, `cast chain-id` still works but
# `eth_*` methods will fail — bail out early with a clear error.
require_eth_rpc() {
  if ! cast rpc --rpc-url "${ETH_RPC_URL}" eth_chainId >/dev/null 2>&1; then
    echo "[cc3-template] eth_* RPC methods are not exposed at ${ETH_RPC_URL}." >&2
    echo "[cc3-template] Use an image/config that enables Ethereum RPC on the CC3 node." >&2
    exit 1
  fi
}

fund_from_alith() {
  if [[ "${AUTO_FUND_FROM_NODE}" != "1" && "${AUTO_FUND_FROM_NODE}" != "true" ]]; then
    return 0
  fi
  if [[ -z "${PRIVATE_KEY:-}" ]]; then
    echo "[cc3-template] AUTO_FUND_FROM_NODE is on but PRIVATE_KEY is empty; skipping" >&2
    return 0
  fi

  local deployer_addr
  deployer_addr="$(cast wallet address --private-key "${PRIVATE_KEY}")"
  echo "[cc3-template] funding ${deployer_addr} from Alith with ${FUND_AMOUNT}"
  cast send \
    --rpc-url "${ETH_RPC_URL}" \
    --private-key "${ALITH_KEY}" \
    "${deployer_addr}" \
    --value "${FUND_AMOUNT}" >/dev/null
  echo "[cc3-template] balance: $(cast balance --rpc-url "${ETH_RPC_URL}" "${deployer_addr}")"
}

should_deploy=0
if [[ "${AUTO_DEPLOY}" == "1" || "${AUTO_DEPLOY}" == "true" ]]; then
  if [[ -n "${PRIVATE_KEY:-}" ]]; then
    should_deploy=1
  else
    echo "[cc3-template] AUTO_DEPLOY is on but PRIVATE_KEY is empty; skipping deploy" >&2
  fi
fi

if [[ "${should_deploy}" == "1" ]]; then
  wait_for_rpc
  require_eth_rpc
  fund_from_alith
  cd "${WORKSPACE}"
  echo "[cc3-template] running Deploy script via forge"
  forge script script/Deploy.s.sol:Deploy \
    --rpc-url "${ETH_RPC_URL}" \
    --evm-version "${EVM_VERSION}" \
    --broadcast \
    --slow \
    --gas-estimate-multiplier 500 \
    --color never \
    -vvv
elif [[ "${AUTO_FUND_FROM_NODE}" == "1" || "${AUTO_FUND_FROM_NODE}" == "true" ]]; then
  wait_for_rpc
  require_eth_rpc
  fund_from_alith
fi

echo "[cc3-template] creditcoin-node running as pid ${NODE_PID}; following logs"
wait "${NODE_PID}"
