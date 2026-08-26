# Creditcoin 3 (CC3) dev node + Foundry in one image.
# Base image: https://hub.docker.com/r/gluwa/creditcoin3
#
# Build from the repository root:
#   docker build -f docker/Dockerfile -t creditcoin-foundry-template:dev .
#
# Run a plain local CC3 node (RPC on 9944):
#   docker run --rm -p 9944:9944 creditcoin-foundry-template:dev
#
# Run node + auto-deploy the sample Counter contract:
#   docker run --rm -p 9944:9944 \
#     -e PRIVATE_KEY=0x... \
#     -e AUTO_DEPLOY=1 \
#     -e AUTO_FUND_FROM_NODE=1 \
#     creditcoin-foundry-template:dev
#
ARG CC3_IMAGE=gluwa/creditcoin3:latest
FROM ${CC3_IMAGE}

USER root
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git jq \
    && rm -rf /var/lib/apt/lists/*

SHELL ["/bin/bash", "-o", "pipefail", "-c"]
ENV FOUNDRY_DIR=/opt/foundry
ENV PATH="${FOUNDRY_DIR}/bin:${PATH}"
RUN curl -L https://foundry.paradigm.xyz | bash -s -- \
    && "${FOUNDRY_DIR}/bin/foundryup"

WORKDIR /workspace
COPY . /workspace/
RUN chown -R creditcoin:creditcoin /workspace /opt/foundry
USER creditcoin
RUN forge build

USER root
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

USER creditcoin
WORKDIR /creditcoin-node
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
