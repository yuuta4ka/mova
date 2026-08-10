#!/bin/bash
cd "$(dirname "$0")/.." || exit 1
mkdir -p .mova-runtime
set +e
bash scripts/deploy.sh "$@" 2>&1 | tee .mova-runtime/last-deploy.log
MOVA_STATUS=${PIPESTATUS[0]}
set -e
echo ""
if [ "$MOVA_STATUS" -eq 0 ]; then
  echo "✅ Команда деплоя завершена."
else
  echo "❌ Деплой завершился с ошибкой $MOVA_STATUS."
  echo "   Лог: $(pwd)/.mova-runtime/last-deploy.log"
fi
echo ""
read -r -p "Нажмите Enter для закрытия..."
exit "$MOVA_STATUS"
