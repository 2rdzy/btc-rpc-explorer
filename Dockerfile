FROM node:22 as builder
WORKDIR /workspace
COPY . .
RUN npm ci && npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /workspace
COPY --from=builder /workspace .
RUN apk --update add git
CMD npm start
EXPOSE 3002
