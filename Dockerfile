FROM node:22 AS builder
WORKDIR /workspace
COPY . .
RUN npm ci && npm run build && npm prune --omit=dev

FROM node:22-alpine
# git: the explorer reads the commit it was built from at start (it is used to refresh the browsers' cached files)
# tini: runs as the first process, so that `docker stop` reaches the explorer and ends it at once (node as the first
# process ignores the stop signal)
RUN apk --update add git tini
WORKDIR /workspace
# (git refuses to read a repository that belongs to another user than the one running it)
RUN chown node:node /workspace

# only what runs: the build, the production dependencies, and the files the app reads from its root
COPY --from=builder --chown=node:node /workspace/dist ./dist
COPY --from=builder --chown=node:node /workspace/node_modules ./node_modules
COPY --from=builder --chown=node:node /workspace/views ./views
COPY --from=builder --chown=node:node /workspace/public ./public
COPY --from=builder --chown=node:node /workspace/package.json /workspace/CHANGELOG.md /workspace/CHANGELOG-API.md ./
COPY --from=builder --chown=node:node /workspace/.git ./.git

# the explorer's own cache (UTXO set, difficulty history, ...): mount a volume here to keep it
RUN mkdir cache && chown node:node cache
VOLUME /workspace/cache

# inside the container the port has to listen on all addresses; what is reachable from outside is up to `docker run -p`
ENV BTCEXP_HOST=0.0.0.0
USER node
EXPOSE 3002
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--enable-source-maps", "dist/bin/www.js"]
