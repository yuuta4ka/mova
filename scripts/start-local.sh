#!/bin/bash
set -e
# shellcheck disable=SC1091
source "$(dirname "$0")/lib.sh"
mova_root
setup_runtime
ensure_runtime_dir

echo "=========================================="
echo "  Mova — локальный запуск"
echo "=========================================="

if server_is_ready; then
  echo "✅ Mova уже запущена."
  print_urls
  open_mova
  exit 0
fi

MOVA_EXISTING_PIDS="$(printf '%s\n%s\n' "$(port_pids 5173)" "$(port_pids 8787)" | awk 'NF' | sort -u)"
if [ -n "$MOVA_EXISTING_PIDS" ]; then
  echo "❌ Порт 5173 или 8787 занят другим процессом:"
  echo "$MOVA_EXISTING_PIDS"
  echo "   Закройте его или запустите click/Stop.command."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Устанавливаем зависимости..."
  run_pnpm install
fi

echo "Node.js: $(node --version)"
echo "Запускаем web и API в фоне..."
: > "$(mova_log_file)"
nohup "${MOVA_PNPM[@]}" dev >> "$(mova_log_file)" 2>&1 &
MOVA_DEV_PID=$!
echo "$MOVA_DEV_PID" > "$(mova_pid_file)"

MOVA_ATTEMPT=0
while [ "$MOVA_ATTEMPT" -lt 80 ]; do
  if server_is_ready; then
    echo "✅ Mova готова к тестированию."
    print_urls
    open_mova
    exit 0
  fi
  if ! pid_is_alive "$MOVA_DEV_PID"; then
    echo "❌ Mova завершилась во время запуска."
    tail -n 30 "$(mova_log_file)" || true
    exit 1
  fi
  sleep 0.25
  MOVA_ATTEMPT=$((MOVA_ATTEMPT + 1))
done

echo "❌ Mova не запустилась за 20 секунд."
tail -n 30 "$(mova_log_file)" || true
exit 1
