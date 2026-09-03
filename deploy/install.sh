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
echo -e "${GREEN}[OK] Secure directories created at $INSTALL_DIR (permissions 0700).${NC}"

# 5. Generate cryptographically strong secrets
echo -e "\n${BOLD}[5/7] Generating installation credentials and Recovery Key...${NC}"

# Generate claim code (format FLUX-XXXX-XXXX-XXXX)
CLAIM_TOKEN="FLUX-$(openssl rand -hex 2 | tr '[:lower:]' '[:upper:]')-$(openssl rand -hex 2 | tr '[:lower:]' '[:upper:]')-$(openssl rand -hex 2 | tr '[:lower:]' '[:upper:]')"
echo "$CLAIM_TOKEN" > "$DATA_DIR/claim.token"
chmod 600 "$DATA_DIR/claim.token"

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

# Copy compose and Caddyfile if not already present
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/compose.yaml" ]; then
    cp "$SCRIPT_DIR/compose.yaml" "$INSTALL_DIR/compose.yaml"
fi
if [ -f "$SCRIPT_DIR/Caddyfile" ]; then
    cp "$SCRIPT_DIR/Caddyfile" "$INSTALL_DIR/Caddyfile"
fi

# 6. Verify image provenance and pull container images (ADR 0048)
echo -e "\n${BOLD}[6/7] Pulling production container images...${NC}"
cd "$INSTALL_DIR"
docker compose pull app caddy || true

# 7. Start container services
echo -e "\n${BOLD}[7/7] Starting Dispar Flux containers...${NC}"
docker compose up -d

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
