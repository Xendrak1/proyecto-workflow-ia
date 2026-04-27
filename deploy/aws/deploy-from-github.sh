#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:-$HOME/proyecto-workflow-ia}"
SERVICE_NAME="workflow-ia"

echo "==> Actualizando codigo"
cd "$ROOT_DIR"
git pull origin main

echo "==> Actualizando backend"
cd "$ROOT_DIR/backend"
. .venv/bin/activate
pip install -r requirements.txt

echo "==> Actualizando frontend"
cd "$ROOT_DIR/frontend"
npm install
npm run build

echo "==> Reiniciando servicios"
sudo systemctl restart "${SERVICE_NAME}"
sudo systemctl restart nginx

echo "==> Estado del backend"
curl -fsS http://127.0.0.1:8000/health
