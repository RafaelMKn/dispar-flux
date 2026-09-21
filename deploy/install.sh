#!/usr/bin/env bash
# ==============================================================================
# Dispar Flux - Production Host Installer Script (ADR 0021, ADR 0048, ADR 0049)
# Master Plan Section 13: Imagem, Instalação e Atualização
# ==============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m' # No Color

echo -e "${BOLD}${BLUE}======================================================${NC}"
echo -e "${BOLD}${BLUE}         Dispar Flux Web 1.0 - Host Installer        ${NC}"
echo -e "${BOLD}${BLUE}======================================================${NC}"
echo ""

# 1. Validate Linux Host and Architecture
echo -e "${BOLD}[1/7] Validating operating system and CPU architecture...${NC}"
OS_NAME="$(uname -s)"
if [ "$OS_NAME" != "Linux" ]; then
    echo -e "${RED}[ERROR] Dispar Flux production installer requires a Linux host (detected: $OS_NAME).${NC}"
    echo "For local development on Windows or macOS, run via Docker Desktop or npm directly."
    exit 1
fi

ARCH="$(uname -m)"
case "$ARCH" in
    x86_64|amd64)
        TARGET_ARCH="linux/amd64"
        echo -e "${GREEN}[OK] Supported architecture detected: $ARCH ($TARGET_ARCH)${NC}"
        ;;
    aarch64|arm64)
        TARGET_ARCH="linux/arm64"
        echo -e "${GREEN}[OK] Supported architecture detected: $ARCH ($TARGET_ARCH)${NC}"
        ;;
    *)
        echo -e "${RED}[ERROR] Unsupported CPU architecture: $ARCH. Dispar Flux supports amd64 and arm64.${NC}"
        exit 1
        ;;
esac

# 2. Validate or install Docker and Docker Compose
echo -e "\n${BOLD}[2/7] Checking Docker and Docker Compose prerequisites...${NC}"
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}Docker is not installed. Attempting to install Docker via get.docker.com...${NC}"
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker
fi

if ! docker compose version &> /dev/null; then
    echo -e "${RED}[ERROR] Docker Compose plugin ('docker compose') is required.${NC}"
    echo "Please install docker-compose-plugin (e.g. apt-get install docker-compose-plugin)."
    exit 1
fi
echo -e "${GREEN}[OK] Docker and Docker Compose plugin verified.${NC}"

# 3. Collect domain, operational timezone, and data directory
echo -e "\n${BOLD}[3/7] Operational configuration...${NC}"

# Domain collection
DEFAULT_DOMAIN="localhost"
if [ -t 0 ]; then
    read -rp "Enter public domain name for HTTPS (default: $DEFAULT_DOMAIN): " INPUT_DOMAIN
    DOMAIN="${INPUT_DOMAIN:-$DEFAULT_DOMAIN}"
else
    DOMAIN="${DOMAIN:-$DEFAULT_DOMAIN}"
fi
echo "Domain configured: $DOMAIN"

# DNS validation for production domains (ADR 0049 / Issue #7)
if [ "$DOMAIN" != "localhost" ] && [ "$DOMAIN" != "127.0.0.1" ]; then
    echo -e "\n${BOLD}Validating DNS resolution for '$DOMAIN'...${NC}"

    RESOLVED_IP=""
    if command -v getent &>/dev/null; then
        RESOLVED_IP="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk '{print $1; exit}' || true)"
        if [ -z "$RESOLVED_IP" ]; then
            RESOLVED_IP="$(getent hosts "$DOMAIN" 2>/dev/null | awk '{print $1; exit}' || true)"
        fi
    fi
    if [ -z "$RESOLVED_IP" ] && command -v dig &>/dev/null; then
        RESOLVED_IP="$(dig +short A "$DOMAIN" 2>/dev/null | grep -E '^[0-9.]+$' | head -n1 || true)"
    fi
    if [ -z "$RESOLVED_IP" ] && command -v host &>/dev/null; then
        RESOLVED_IP="$(host -t A "$DOMAIN" 2>/dev/null | awk '/has address/ {print $4; exit}' || true)"
    fi
    if [ -z "$RESOLVED_IP" ] && command -v nslookup &>/dev/null; then
        RESOLVED_IP="$(nslookup "$DOMAIN" 2>/dev/null | awk '/^Address: / {print $2; exit}' || true)"
    fi

    PUBLIC_IP=""
    if command -v curl &>/dev/null; then
        PUBLIC_IP="$(curl -fsS4 --max-time 5 https://icanhazip.com 2>/dev/null | tr -d '[:space:]' || true)"
        if [ -z "$PUBLIC_IP" ]; then
            PUBLIC_IP="$(curl -fsS4 --max-time 5 https://ifconfig.me 2>/dev/null | tr -d '[:space:]' || true)"
        fi
    fi

    DNS_MISMATCH=false
    if [ -z "$RESOLVED_IP" ]; then
        DNS_MISMATCH=true
    elif [ -n "$PUBLIC_IP" ] && [ "$RESOLVED_IP" != "$PUBLIC_IP" ]; then
        DNS_MISMATCH=true
    fi

    if [ "$DNS_MISMATCH" = true ]; then
        echo -e "\n${BOLD}${YELLOW}==================================================================${NC}"
        echo -e "${BOLD}${RED}             ⚠️  AVISO CRÍTICO DE DNS / PROPAGAÇÃO ⚠️             ${NC}"
        echo -e "${BOLD}${YELLOW}==================================================================${NC}"
        if [ -z "$RESOLVED_IP" ]; then
            echo -e "${RED}[FALHA] Não foi possível resolver o IP para o domínio: ${BOLD}${DOMAIN}${NC}"
        else
            echo -e "[ALERTA] O domínio ${BOLD}${DOMAIN}${NC} resolve para: ${RED}${RESOLVED_IP}${NC}"
        fi
        if [ -n "$PUBLIC_IP" ]; then
            echo -e "[INFO]  O IP público desta VPS é: ${GREEN}${PUBLIC_IP}${NC}"
        else
            echo -e "[AVISO] Não foi possível determinar automaticamente o IP público desta VPS."
        fi
        echo ""
        echo -e "${YELLOW}RISCO DE FALHA NO SSL ACME DO CADDY:${NC}"
        echo -e "${YELLOW}O Caddy tentará emitir automaticamente um certificado SSL (Let's Encrypt / ZeroSSL)${NC}"
        echo -e "${YELLOW}para '${DOMAIN}'. Se o apontamento DNS tipo 'A' não estiver configurado para o IP${NC}"
        echo -e "${YELLOW}desta VPS ou não tiver propagado, o desafio ACME falhará, impedindo a emissão${NC}"
        echo -e "${YELLOW}do certificado TLS e deixando a aplicação inacessível via HTTPS.${NC}"
        echo -e "${BOLD}${YELLOW}==================================================================${NC}"

        PROCEED="n"
        if [ -t 0 ]; then
            read -rp "Deseja prosseguir com a instalação mesmo assim? [y/N]: " INPUT_PROCEED
            PROCEED="${INPUT_PROCEED:-n}"
        else
            if [ "${FORCE_INSTALL:-false}" = "true" ]; then
                echo -e "${YELLOW}[WARN] Continuando devido a FORCE_INSTALL=true.${NC}"
                PROCEED="y"
            else
                echo -e "${RED}[ERRO] Instalação abortada preventivamente devido a inconsistência de DNS.${NC}"
                echo "Configure o apontamento DNS tipo 'A' ou execute com FORCE_INSTALL=true para ignorar."
                exit 1
            fi
        fi

        case "$PROCEED" in
            [yY]|[yY][eE][sS]|[sS])
                echo -e "${YELLOW}Prosseguindo com a instalação sob confirmação do usuário...${NC}"
                ;;
            *)
                echo -e "${RED}Instalação cancelada pelo usuário para correção do DNS.${NC}"
                exit 1
                ;;
        esac
    else
        echo -e "${GREEN}[OK] Resolução de DNS validada com sucesso: ${DOMAIN} -> ${RESOLVED_IP}${NC}"
    fi
fi

# Operational Timezone collection (ADR 0019)
DEFAULT_TZ="America/Sao_Paulo"
if [ -t 0 ]; then
    read -rp "Enter Organization Operational Timezone IANA (default: $DEFAULT_TZ): " INPUT_TZ
    OPERATIONAL_TIMEZONE="${INPUT_TZ:-$DEFAULT_TZ}"
else
    OPERATIONAL_TIMEZONE="${OPERATIONAL_TIMEZONE:-$DEFAULT_TZ}"
fi
echo "Operational Timezone configured: $OPERATIONAL_TIMEZONE"

# Data Directory
INSTALL_DIR="${INSTALL_DIR:-/opt/dispar-flux}"
DATA_DIR="$INSTALL_DIR/data"

# 4. Create secure directory structure with restricted permissions (chmod 700)
echo -e "\n${BOLD}[4/7] Creating secure directories with restricted permissions (0700)...${NC}"
mkdir -p "$INSTALL_DIR"
mkdir -p "$DATA_DIR"
mkdir -p "$DATA_DIR/media"
mkdir -p "$DATA_DIR/backups"

chmod 700 "$INSTALL_DIR"
chmod 700 "$DATA_DIR"
chmod 700 "$DATA_DIR/media"
chmod 700 "$DATA_DIR/backups"
chown -R 1000:1000 "$DATA_DIR" 2>/dev/null || true
echo -e "${GREEN}[OK] Secure directories created at $INSTALL_DIR (permissions 0700).${NC}"

# 5. Generate cryptographically strong secrets
echo -e "\n${BOLD}[5/7] Generating installation credentials and Recovery Key...${NC}"

# Generate claim code (format FLUX-XXXX-XXXX-XXXX)
CLAIM_TOKEN="FLUX-$(openssl rand -hex 2 | tr '[:lower:]' '[:upper:]')-$(openssl rand -hex 2 | tr '[:lower:]' '[:upper:]')-$(openssl rand -hex 2 | tr '[:lower:]' '[:upper:]')"
echo "$CLAIM_TOKEN" > "$DATA_DIR/claim.token"
chmod 600 "$DATA_DIR/claim.token"
chown -R 1000:1000 "$DATA_DIR" 2>/dev/null || true

# Generate 256-bit Recovery Key (ADR 0020, ADR 0046)
RECOVERY_KEY="flux_rec_$(openssl rand -hex 32)"

# Generate Session Secret
SESSION_SECRET="$(openssl rand -hex 32)"

# Write .env file with chmod 600
ENV_FILE="$INSTALL_DIR/.env"
cat <<EOF > "$ENV_FILE"
# Dispar Flux Environment Configuration
DOMAIN=${DOMAIN}
OPERATIONAL_TIMEZONE=${OPERATIONAL_TIMEZONE}
DATA_DIR=${DATA_DIR}
RECOVERY_KEY=${RECOVERY_KEY}
SESSION_SECRET=${SESSION_SECRET}
NODE_ENV=production
EOF
chmod 600 "$ENV_FILE"
echo -e "${GREEN}[OK] Secrets generated and saved in $ENV_FILE (permissions 0600).${NC}"

# Copy compose and Caddyfile if not already present, or fetch from GitHub repository
RAW_REPO_BASE="https://raw.githubusercontent.com/RafaelMKn/dispar-flux/main/deploy"
SCRIPT_DIR=""
if [ "${#BASH_SOURCE[@]}" -gt 0 ] && [ -n "${BASH_SOURCE[0]}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/compose.yaml" ]; then
    cp "$SCRIPT_DIR/compose.yaml" "$INSTALL_DIR/compose.yaml"
else
    echo "Downloading compose.yaml from repository..."
    curl -fsSL "$RAW_REPO_BASE/compose.yaml" -o "$INSTALL_DIR/compose.yaml"
fi

if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/Caddyfile" ]; then
    cp "$SCRIPT_DIR/Caddyfile" "$INSTALL_DIR/Caddyfile"
else
    echo "Downloading Caddyfile from repository..."
    curl -fsSL "$RAW_REPO_BASE/Caddyfile" -o "$INSTALL_DIR/Caddyfile"
fi

# 6. Verify image provenance and pull container images (ADR 0048)
echo -e "\n${BOLD}[6/7] Pulling production container images...${NC}"
cd "$INSTALL_DIR"
docker compose pull dispar-flux caddy || true

# Fallback to local build if image cannot be pulled from registry
if ! docker image inspect ghcr.io/rafaelmkn/dispar-flux:1.0.0 &>/dev/null; then
    echo -e "${YELLOW}[WARN] Image ghcr.io/rafaelmkn/dispar-flux:1.0.0 is not available in registry or local cache.${NC}"

    # Check for repository source code (../Dockerfile or ./Dockerfile)
    REPO_ROOT=""
    if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/../Dockerfile" ]; then
        REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
    elif [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/Dockerfile" ]; then
        REPO_ROOT="$SCRIPT_DIR"
    elif [ -f "./Dockerfile" ]; then
        REPO_ROOT="$(pwd)"
    elif [ -f "../Dockerfile" ]; then
        REPO_ROOT="$(cd ".." && pwd)"
    fi

    if [ -n "$REPO_ROOT" ] && [ -f "$REPO_ROOT/Dockerfile" ]; then
        echo -e "${BLUE}Detected repository source at $REPO_ROOT.${NC}"
        echo -e "${BLUE}Building 'dispar-flux' locally ('docker compose build dispar-flux')...${NC}"
        if [ -f "$REPO_ROOT/deploy/compose.yaml" ]; then
            (cd "$REPO_ROOT/deploy" && docker compose build dispar-flux)
        elif [ -f "$REPO_ROOT/compose.yaml" ]; then
            (cd "$REPO_ROOT" && docker compose build dispar-flux)
        else
            docker build -t ghcr.io/rafaelmkn/dispar-flux:1.0.0 -f "$REPO_ROOT/Dockerfile" "$REPO_ROOT"
        fi
        echo -e "${GREEN}[OK] Local build for dispar-flux completed successfully.${NC}"
    else
        echo -e "${RED}[ERROR] Image ghcr.io/rafaelmkn/dispar-flux:1.0.0 could not be retrieved and no source code found for local build.${NC}"
        exit 1
    fi
fi

# 7. Start container services
echo -e "\n${BOLD}[7/7] Starting Dispar Flux containers...${NC}"
cd "$INSTALL_DIR"
docker compose up -d

# Note: Bind mount ./data:/data directly shares $DATA_DIR with /data in container (Issue #6)

# Wait for dispar-flux service to pass healthcheck (/health)
echo -e "\n${BOLD}Waiting for dispar-flux service to pass healthcheck (/health)...${NC}"
MAX_RETRIES=30
RETRY_COUNT=0
HEALTHY=false

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    CONTAINER_ID="$(docker compose ps -q dispar-flux 2>/dev/null || true)"
    if [ -n "$CONTAINER_ID" ]; then
        STATUS="$(docker inspect --format='{{json .State.Health.Status}}' "$CONTAINER_ID" 2>/dev/null | tr -d '"' || true)"
        if [ "$STATUS" = "healthy" ]; then
            HEALTHY=true
            break
        fi
    fi

    # Alternative direct curl / node check inside container
    if docker compose exec -T dispar-flux node -e "fetch('http://127.0.0.1:3000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" 2>/dev/null; then
        HEALTHY=true
        break
    fi

    RETRY_COUNT=$((RETRY_COUNT + 1))
    echo -n "."
    sleep 2
done
echo ""

if [ "$HEALTHY" = true ]; then
    echo -e "${GREEN}[OK] dispar-flux service is healthy and ready.${NC}"
else
    echo -e "${YELLOW}[WARN] Health check did not report healthy within 60s.${NC}"
    echo "Check container logs with: docker compose logs dispar-flux"
fi

# Verify confirmed token inside container
CONFIRMED_TOKEN="$(docker compose exec -T dispar-flux cat /data/claim.token 2>/dev/null | tr -d '\r\n' || true)"
if [ -n "$CONFIRMED_TOKEN" ]; then
    CLAIM_TOKEN="$CONFIRMED_TOKEN"
    echo "$CLAIM_TOKEN" > "$DATA_DIR/claim.token"
    chmod 600 "$DATA_DIR/claim.token"
    chown 1000:1000 "$DATA_DIR/claim.token" 2>/dev/null || true
fi

echo ""
echo -e "${BOLD}${GREEN}==================================================================${NC}"
echo -e "${BOLD}${GREEN}          Dispar Flux Web 1.0 Installed Successfully!            ${NC}"
echo -e "${BOLD}${GREEN}==================================================================${NC}"
echo ""
echo -e "${BOLD}One-Time Installation Claim Code:${NC}"
echo -e "  ${YELLOW}${BOLD}${CLAIM_TOKEN}${NC}"
echo ""
echo -e "${BOLD}Disaster Recovery Key (SAVE THIS SECURELY):${NC}"
echo -e "  ${RED}${BOLD}${RECOVERY_KEY}${NC}"
echo ""
echo -e "${BOLD}Next Steps:${NC}"
echo "1. Open https://${DOMAIN} in your authorized browser."
echo "2. Paste the Claim Code to create your Organization and initial Owner account."
echo "3. Save your Disaster Recovery Key in a safe external password manager."
echo "   (The recovery key is required to restore encrypted backups in an emergency)."
echo ""
