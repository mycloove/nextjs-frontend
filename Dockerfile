FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS development
ENV NODE_ENV=development
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0"]

FROM dependencies AS builder
ENV NODE_ENV=production
# NEXT_PUBLIC_* values are inlined into the browser bundle at BUILD time, so they
# must be present in this stage - passing them only as runtime environment leaves
# the shipped bundle with `undefined` Supabase config and sign-in fails with no
# server-side error. Compose supplies these as build args (see compose.yaml).
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_PDF_MICROSERVICE_URL
ARG NEXT_PUBLIC_PDF_EDITOR_SERVER_TEXT_EDIT=true
ARG NEXT_PUBLIC_PDF_EDITOR_TEXT_SHAPING_GUARD=true
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
    NEXT_PUBLIC_PDF_MICROSERVICE_URL=$NEXT_PUBLIC_PDF_MICROSERVICE_URL \
    NEXT_PUBLIC_PDF_EDITOR_SERVER_TEXT_EDIT=$NEXT_PUBLIC_PDF_EDITOR_SERVER_TEXT_EDIT \
    NEXT_PUBLIC_PDF_EDITOR_TEXT_SHAPING_GUARD=$NEXT_PUBLIC_PDF_EDITOR_TEXT_SHAPING_GUARD
COPY . .
RUN npm run build

FROM base AS production
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]