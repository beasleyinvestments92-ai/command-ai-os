FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json ./
COPY scripts/materialize-source.cjs ./scripts/materialize-source.cjs
COPY .source ./.source
RUN node scripts/materialize-source.cjs && npm install --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd --system command && useradd --system --gid command --home-dir /app command
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN node scripts/materialize-source.cjs && chown -R command:command /app
USER command
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4173)+'/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["npm","start"]
