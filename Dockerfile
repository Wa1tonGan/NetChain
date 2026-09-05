# NetChain backend image — ONE image, two entrypoints (see docker-compose.yml):
#   agents  (default CMD): provider agents 8101-8103 + Rescue gateway 8082
#                          + Truth/claim agent 8105   (scripts/start-all.mjs)
#   trust             : Sui trust server 8200 (commit/settle/archive/audit)
#
# The zkLogin bridge (:8787) is intentionally NOT part of this image — the
# demo signs with the agent escrow pool or a Slush wallet, so no Google OAuth
# and no HTTPS are needed.
FROM node:22-alpine

WORKDIR /app

# Deps first for layer caching. concurrently is a devDep only used by the
# npm dev scripts — the runtime entrypoints spawn their own children.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Runtime code + data the services read (provider personas, demo keys).
COPY src ./src
COPY scripts ./scripts
COPY fixtures ./fixtures
COPY scenarios ./scenarios

# Not baked in, provided by bind mounts at runtime (docker-compose.yml):
#   ./events -> /app/events   append-only reliability ledger (survives restarts)
#   ./.sui   -> /app/.sui     config.testnet.json — package/escrow/treasury ids
#   .env     -> env_file      (compose injects env; never bake secrets)

EXPOSE 8082 8101 8102 8103 8105 8200

# Default: bring up the agent market. docker-compose overrides this for trust.
CMD ["node", "scripts/start-all.mjs"]
