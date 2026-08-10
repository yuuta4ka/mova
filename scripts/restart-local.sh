#!/bin/bash
set -e
MOVA_SCRIPT_DIR="$(dirname "$0")"
bash "$MOVA_SCRIPT_DIR/stop-local.sh"
exec bash "$MOVA_SCRIPT_DIR/start-local.sh"
