FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df

ENV CI=true \
    COREPACK_HOME=/home/node/.cache/node/corepack \
    PNPM_HOME=/home/node/.local/share/pnpm \
    PATH=/home/node/.local/share/pnpm:$PATH

WORKDIR /workspace

# Enable the exact pnpm version selected by package.json while root, and make
# every runtime volume destination writable by the non-root node user.
RUN corepack enable \
    && install -d -o node -g node \
      /workspace/node_modules \
      /workspace/public/examples \
      /workspace/dist \
      /home/node/.cache/node/corepack \
      /home/node/.local/share/pnpm/store

COPY --chown=node:node package.json pnpm-lock.yaml ./
USER node
RUN pnpm install --frozen-lockfile

COPY --chown=node:node . .

CMD ["pnpm", "dev", "--host", "0.0.0.0"]
