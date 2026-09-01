FROM node:20-alpine

# Dependencias del sistema: wget (healthcheck), python3/make/g++ (módulos nativos), openssl
RUN apk add --no-cache python3 make g++ wget openssl

# Usuario sin privilegios para seguridad
RUN addgroup -S itsm && adduser -S itsm -G itsm

WORKDIR /app

# Capa de dependencias (se cachea si package.json no cambia)
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Código fuente
COPY --chown=itsm:itsm . .

# Directorios de datos persistentes
RUN mkdir -p uploads logs ssl && chown -R itsm:itsm uploads logs ssl

RUN chmod +x scripts/docker-entrypoint.sh

USER itsm

EXPOSE 3443

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget -qO- --no-check-certificate https://localhost:3443/api/health 2>/dev/null || exit 1

ENTRYPOINT ["scripts/docker-entrypoint.sh"]
