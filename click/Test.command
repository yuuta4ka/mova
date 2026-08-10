#!/bin/bash
cd "$(dirname "$0")/.." || exit 1
mkdir -p .mova-runtime
set +e
bash scripts/test-local.sh 2>&1 | tee .mova-runtime/last-test.log
MOVA_STATUS=${PIPESTATUS[0]}
set -e
echo ""
if [ "$MOVA_STATUS" -eq 0 ]; then
  echo "✅ Mova прошла все проверки."
else
  echo "❌ Проверки завершились с ошибкой $MOVA_STATUS."
  echo "   Лог: $(pwd)/.mova-runtime/last-test.log"
fi
echo ""
read -r -p "Нажмите Enter для закрытия..."
exit "$MOVA_STATUS"
