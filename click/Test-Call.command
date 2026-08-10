#!/bin/bash
cd "$(dirname "$0")/.." || exit 1
MOVA_OPEN_BROWSER=0 bash scripts/start-local.sh
MOVA_STATUS=$?
if [ "$MOVA_STATUS" -eq 0 ]; then
  echo "Открываем две вкладки для проверки звонка..."
  open "http://127.0.0.1:5173"
  sleep 0.7
  open "http://127.0.0.1:5173"
  echo ""
  echo "Войдите под двумя разными аккаунтами в открытых вкладках."
  echo "Сессии вкладок независимы, поэтому можно позвонить самому себе."
fi
echo ""
read -r -p "Нажмите Enter для закрытия..."
exit "$MOVA_STATUS"
