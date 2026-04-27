#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/home/ubuntu/proyecto-workflow-ia"
LOG_FILE="/home/ubuntu/workflow-ia-auto-update.log"

cd "$ROOT_DIR"

git fetch origin main >/dev/null 2>&1

LOCAL_COMMIT="$(git rev-parse HEAD)"
REMOTE_COMMIT="$(git rev-parse origin/main)"

if [ "$LOCAL_COMMIT" != "$REMOTE_COMMIT" ]; then
  ./deploy/aws/deploy-from-github.sh >> "$LOG_FILE" 2>&1
fi
