#!/bin/bash
# ══════════════════════════════════════════════════════════════
# WHATSAPP AUDIT SYSTEM — SERVER SETUP
# ══════════════════════════════════════════════════════════════
# Ejecutar como root en un Droplet Ubuntu 24.04 limpio:
# chmod +x setup.sh && ./setup.sh
# ══════════════════════════════════════════════════════════════

set -euo pipefail

# ─── COLORES ─────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
log_ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ─── VERIFICACIONES ──────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
    log_error "Este script debe ejecutarse como root"
    exit 1
fi

if ! grep -q "Ubuntu" /etc/os-release 2>/dev/null; then
    log_error "Este script está diseñado para Ubuntu"
    exit 1
fi

echo ""
echo "══════════════════════════════════════════════════════════"
echo "  WHATSAPP AUDIT SYSTEM — SETUP DEL SERVIDOR"
echo "══════════════════════════════════════════════════════════"
echo ""

# ─── 1. ACTUALIZAR SISTEMA ───────────────────────────────────
log_info "Actualizando sistema operativo..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq
log_ok "Sistema actualizado"

# ─── 2. INSTALAR DEPENDENCIAS BASE ──────────────────────────
log_info "Instalando dependencias base..."
# Nota: el extractor usa Baileys (WebSocket directo), NO Puppeteer/
# Chromium. Los paquetes libnss3/libgbm/etc. que antes se instalaban
# aquí eran restos del stack anterior con whatsapp-web.js.
apt-get install -y -qq \
    curl \
    wget \
    git \
    unzip \
    htop \
    tree \
    jq \
    nano \
    vim \
    tmux \
    fail2ban \
    ufw \
    apt-transport-https \
    ca-certificates \
    gnupg \
    lsb-release \
    software-properties-common \
    cron
log_ok "Dependencias instaladas"

# ─── 3. CREAR USUARIO DEPLOY ────────────────────────────────
DEPLOY_USER="deploy"
log_info "Creando usuario $DEPLOY_USER..."
if ! id "$DEPLOY_USER" &>/dev/null; then
    useradd -m -s /bin/bash -G sudo "$DEPLOY_USER"
    # Copiar SSH keys de root al nuevo usuario
    mkdir -p /home/$DEPLOY_USER/.ssh
    if [ -f /root/.ssh/authorized_keys ]; then
        cp /root/.ssh/authorized_keys /home/$DEPLOY_USER/.ssh/
    fi
    chown -R $DEPLOY_USER:$DEPLOY_USER /home/$DEPLOY_USER/.ssh
    chmod 700 /home/$DEPLOY_USER/.ssh
    chmod 600 /home/$DEPLOY_USER/.ssh/authorized_keys 2>/dev/null || true
    # Permitir sudo sin password para deploy
    echo "$DEPLOY_USER ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/$DEPLOY_USER
    chmod 440 /etc/sudoers.d/$DEPLOY_USER
    log_ok "Usuario $DEPLOY_USER creado"
else
    log_warn "Usuario $DEPLOY_USER ya existe"
fi

# ─── 4. CONFIGURAR FIREWALL ─────────────────────────────────
# Idempotente: solo reset la primera vez. Re-ejecuciones conservan
# reglas manuales que el operador haya agregado.
UFW_MARKER=/var/lib/ortiz-setup-ufw-done
log_info "Configurando firewall UFW..."
if [ ! -f "$UFW_MARKER" ]; then
    ufw --force reset
    ufw default deny incoming
    ufw default allow outgoing
    ufw allow 22/tcp comment "SSH"
    ufw allow 80/tcp comment "HTTP"
    ufw allow 443/tcp comment "HTTPS"
    ufw --force enable
    touch "$UFW_MARKER"
    log_ok "Firewall configurado: solo puertos 22, 80, 443"
else
    log_warn "Firewall ya configurado antes (marker $UFW_MARKER). Saltando reset."
fi

# ─── 5. CONFIGURAR SSH SEGURO ───────────────────────────────
log_info "Endureciendo configuración SSH..."
# Backup de la config original
cp /etc/ssh/sshd_config /etc/ssh/sshd_config.backup

# Aplicar configuración segura
cat > /etc/ssh/sshd_config.d/hardening.conf << 'SSHEOF'
PermitRootLogin prohibit-password
PasswordAuthentication no
PubkeyAuthentication yes
MaxAuthTries 3
ClientAliveInterval 300
ClientAliveCountMax 2
X11Forwarding no
AllowAgentForwarding no
SSHEOF

systemctl restart sshd
log_ok "SSH endurecido: solo acceso por llave"

# ─── 6. CONFIGURAR FAIL2BAN ─────────────────────────────────
log_info "Configurando Fail2ban..."
cat > /etc/fail2ban/jail.local << 'F2BEOF'
[DEFAULT]
bantime  = 3600
findtime = 600
maxretry = 3
backend = systemd

[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 7200
F2BEOF

systemctl enable fail2ban
systemctl restart fail2ban
log_ok "Fail2ban configurado"

# ─── 7. INSTALAR DOCKER ─────────────────────────────────────
log_info "Instalando Docker..."
if ! command -v docker &>/dev/null; then
    curl -fsSL https://get.docker.com | sh
    usermod -aG docker $DEPLOY_USER
    systemctl enable docker
    systemctl start docker
    log_ok "Docker instalado"
else
    log_warn "Docker ya está instalado"
fi

# ─── 8. INSTALAR DOCKER COMPOSE ─────────────────────────────
log_info "Verificando Docker Compose..."
if docker compose version &>/dev/null; then
    log_ok "Docker Compose v2 disponible (plugin)"
else
    log_info "Instalando Docker Compose plugin..."
    apt-get install -y -qq docker-compose-plugin
    log_ok "Docker Compose instalado"
fi

# ─── 9. INSTALAR NODE.JS 20 LTS ─────────────────────────────
log_info "Instalando Node.js 20 LTS..."
if ! command -v node &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y -qq nodejs
    log_ok "Node.js $(node --version) instalado"
else
    log_warn "Node.js ya instalado: $(node --version)"
fi

# ─── 10. INSTALAR PYTHON 3.11+ ──────────────────────────────
log_info "Verificando Python..."
PYTHON_VERSION=$(python3 --version 2>/dev/null | cut -d' ' -f2 || echo "0")
log_ok "Python $PYTHON_VERSION disponible"

# Instalar pip y venv
apt-get install -y -qq python3-pip python3-venv python3-dev

# ─── 11. CREAR ESTRUCTURA DEL PROYECTO ──────────────────────
PROJECT_DIR="/home/$DEPLOY_USER/whatsapp-audit"
log_info "Creando estructura del proyecto en $PROJECT_DIR..."

mkdir -p $PROJECT_DIR/{data/{raw,audios,transcripts,analysis,exports},logs,backups}
chown -R $DEPLOY_USER:$DEPLOY_USER $PROJECT_DIR

log_ok "Estructura de carpetas creada"

# ─── 12. CONFIGURAR SWAP (importante para 4GB RAM) ──────────
log_info "Configurando swap..."
SWAP_SIZE="4G"
if [ ! -f /swapfile ]; then
    fallocate -l $SWAP_SIZE /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    grep -q '^vm.swappiness'        /etc/sysctl.conf || echo 'vm.swappiness=10'        >> /etc/sysctl.conf
    grep -q '^vm.vfs_cache_pressure' /etc/sysctl.conf || echo 'vm.vfs_cache_pressure=50' >> /etc/sysctl.conf
    sysctl -p
    log_ok "Swap de $SWAP_SIZE configurado"
else
    log_warn "Swap ya existe"
fi

# ─── 13. CONFIGURAR LOGROTATE ───────────────────────────────
log_info "Configurando logrotate para el proyecto..."
cat > /etc/logrotate.d/whatsapp-audit << LOGEOF
$PROJECT_DIR/logs/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 $DEPLOY_USER $DEPLOY_USER
    sharedscripts
}
LOGEOF
log_ok "Logrotate configurado"

# ─── 14. CONFIGURAR TIMEZONE ────────────────────────────────
log_info "Configurando timezone a Colombia..."
timedatectl set-timezone America/Bogota
log_ok "Timezone: $(timedatectl show --property=Timezone --value)"

# ─── 15. CONFIGURAR LÍMITES DEL SISTEMA (idempotente) ───────
log_info "Ajustando límites del sistema..."
if ! grep -q '^# ortiz-setup-limits$' /etc/security/limits.conf 2>/dev/null; then
    cat >> /etc/security/limits.conf << 'LIMEOF'
# ortiz-setup-limits
* soft nofile 65536
* hard nofile 65536
* soft nproc 32768
* hard nproc 32768
LIMEOF
    log_ok "limits.conf actualizado"
else
    log_warn "limits.conf ya ajustado"
fi

if ! grep -q '^# ortiz-setup-sysctl$' /etc/sysctl.conf 2>/dev/null; then
    cat >> /etc/sysctl.conf << 'SYSEOF'
# ortiz-setup-sysctl
# Optimizaciones de red
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.core.netdev_max_backlog = 65535
# Optimizaciones de archivo
fs.file-max = 2097152
fs.inotify.max_user_watches = 524288
SYSEOF
    sysctl -p 2>/dev/null
    log_ok "sysctl.conf actualizado"
else
    log_warn "sysctl.conf ya ajustado"
fi

# ─── RESUMEN FINAL ──────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════════════"
echo -e "  ${GREEN}SERVIDOR CONFIGURADO EXITOSAMENTE${NC}"
echo "══════════════════════════════════════════════════════════"
echo ""
echo "  Sistema:     $(lsb_release -ds)"
echo "  Docker:      $(docker --version | cut -d' ' -f3 | tr -d ',')"
echo "  Node.js:     $(node --version)"
echo "  Python:      $(python3 --version | cut -d' ' -f2)"
echo "  Timezone:    $(timedatectl show --property=Timezone --value)"
echo "  Swap:        $(free -h | awk '/Swap/{print $2}')"
echo "  Firewall:    Activo (22, 80, 443)"
echo "  Fail2ban:    Activo"
echo "  Usuario:     $DEPLOY_USER"
echo "  Proyecto:    $PROJECT_DIR"
echo ""
echo "  SIGUIENTE PASO:"
echo "  1. Cierra sesión y reconecta como $DEPLOY_USER:"
echo "     ssh $DEPLOY_USER@$(curl -4s ifconfig.me)"
echo ""
echo "  2. Clona o copia el proyecto a $PROJECT_DIR"
echo ""
echo "  3. Configura las variables de entorno:"
echo "     cp .env.example .env"
echo "     nano .env"
echo ""
echo "  4. Levanta los servicios:"
echo "     cd $PROJECT_DIR && docker compose up -d"
echo ""
echo "══════════════════════════════════════════════════════════"
