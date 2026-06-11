#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:-$HOME/proyecto-workflow-ia}"
SERVICE_NAME="workflow-ia"

echo "==> Actualizando codigo"
cd "$ROOT_DIR"
git pull origin main

echo "==> Instalando ffmpeg (necesario para transcripcion de audio)"
if ! command -v ffmpeg &>/dev/null; then
  sudo apt-get install -y ffmpeg
else
  echo "    ffmpeg ya instalado"
fi

echo "==> Actualizando backend"
cd "$ROOT_DIR/backend"
. .venv/bin/activate
pip install -r requirements.txt

echo "==> Descargando modelo Vosk para espanol si no existe"
VOSK_MODEL_DIR="$ROOT_DIR/backend/vosk_model"
VOSK_MODEL_NAME="vosk-model-small-es-0.42"
if [ ! -d "$VOSK_MODEL_DIR/$VOSK_MODEL_NAME" ]; then
  mkdir -p "$VOSK_MODEL_DIR"
  echo "    Descargando $VOSK_MODEL_NAME (~50MB)..."
  curl -L "https://alphacephei.com/vosk/models/${VOSK_MODEL_NAME}.zip" -o "$VOSK_MODEL_DIR/model.zip"
  unzip -q "$VOSK_MODEL_DIR/model.zip" -d "$VOSK_MODEL_DIR"
  rm "$VOSK_MODEL_DIR/model.zip"
  echo "    Modelo Vosk listo en $VOSK_MODEL_DIR/$VOSK_MODEL_NAME"
else
  echo "    Modelo Vosk ya existe"
fi

echo "==> Actualizando frontend"
cd "$ROOT_DIR/frontend"
npm install
npm run build

echo "==> Actualizando configuracion nginx"
sudo sed -e "s|ROOT_PATH_PLACEHOLDER|$ROOT_DIR|g" -e "s|SERVER_NAME_PLACEHOLDER|_|g" \
  "$ROOT_DIR/deploy/aws/workflow-ia.nginx.conf" \
  | sudo tee "/etc/nginx/sites-available/${SERVICE_NAME}" >/dev/null
sudo nginx -t

echo "==> Reiniciando servicios"
sudo systemctl restart "${SERVICE_NAME}"
sudo systemctl restart nginx

echo "==> Estado del backend"
curl -fsS http://127.0.0.1:8000/health
