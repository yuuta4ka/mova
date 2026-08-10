#!/bin/bash
cd "$(dirname "$0")/.." || exit 1
bash scripts/start-local.sh
MOVA_STATUS=$?
echo ""
read -r -p "Нажмите Enter для закрытия..."
exit "$MOVA_STATUS"
