# ---- build the Fiori / UI5 React frontend ----
FROM node:22-alpine AS ui
WORKDIR /build/ui
COPY ui/package*.json ./
RUN npm ci
COPY ui/ ./
RUN npm run build            # -> /build/app/ui

# ---- CAP backend ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=development CDS_ENV=development
COPY package*.json ./
RUN npm ci --omit=dev
COPY db ./db
COPY srv ./srv
COPY samples ./samples
COPY --from=ui /build/app/ui ./app/ui
EXPOSE 4004
HEALTHCHECK CMD wget -qO- http://localhost:4004/health || exit 1
CMD ["npx", "cds-serve"]
