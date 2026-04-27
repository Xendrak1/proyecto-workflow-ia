#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:-$HOME/proyecto-workflow-ia}"
SERVICE_NAME="workflow-ia"
NODE_MAJOR="20"

echo "==> Actualizando paquetes base"
sudo apt-get update
sudo apt-get install -y python3 python3-venv python3-pip nginx git curl

if ! command -v node >/dev/null 2>&1; then
  echo "==> Instalando Node.js ${NODE_MAJOR}"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "==> Preparando backend"
cd "$ROOT_DIR/backend"
python3 -m venv .venv
. .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

echo "==> Preparando frontend"
cd "$ROOT_DIR/frontend"
npm install
npm run build

echo "==> Copiando servicio systemd"
sudo sed "s|ROOT_PATH_PLACEHOLDER|$ROOT_DIR|g" \
  "$ROOT_DIR/deploy/aws/workflow-ia.service" \
  | sudo tee "/etc/systemd/system/${SERVICE_NAME}.service" >/dev/null

echo "==> Copiando configuracion nginx"
sudo sed -e "s|ROOT_PATH_PLACEHOLDER|$ROOT_DIR|g" -e "s|SERVER_NAME_PLACEHOLDER|_|g" \
  "$ROOT_DIR/deploy/aws/workflow-ia.nginx.conf" \
  | sudo tee "/etc/nginx/sites-available/${SERVICE_NAME}" >/dev/null

sudo ln -sf "/etc/nginx/sites-available/${SERVICE_NAME}" "/etc/nginx/sites-enabled/${SERVICE_NAME}"
sudo rm -f /etc/nginx/sites-enabled/default

sudo mkdir -p "$ROOT_DIR/backend/uploads"
sudo chown -R ubuntu:www-data "$ROOT_DIR/backend/uploads"
sudo chmod -R 775 "$ROOT_DIR/backend/uploads"
sudo chmod 755 "$HOME" "$ROOT_DIR" "$ROOT_DIR/frontend"
find "$ROOT_DIR/frontend/dist" -type d -exec chmod 755 {} +
find "$ROOT_DIR/frontend/dist" -type f -exec chmod 644 {} +

echo "==> Recargando servicios"
sudo systemctl daemon-reload
sudo nginx -t
sudo systemctl enable "${SERVICE_NAME}"

echo "Instalacion base lista. Falta crear backend/.env y reiniciar workflow-ia."
