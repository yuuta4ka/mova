#!/bin/bash
cd "$(dirname "$0")/.." || exit 1
mkdir -p .mova-runtime
set -o pipefail
bash scripts/deploy.sh "$@" 2>&1 | tee .mova-runtime/last-deploy.log
MOVA_STATUS=${PIPESTATUS[0]}
echo ""
if [ "$MOVA_STATUS" -eq 0 ]; then
  echo "✅ Деплой завершён."
else
  echo "❌ Деплой завершился с ошибкой $MOVA_STATUS."
  echo "   Лог: $(pwd)/.mova-runtime/last-deploy.log"
fi
exit "$MOVA_STATUS"
