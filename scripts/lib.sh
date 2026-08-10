# Общие функции локального запуска Mova.
# shellcheck shell=bash

mova_root() {
  cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
}

setup_runtime() {
  export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

  local mova_nvm_dir="${NVM_DIR:-$HOME/.nvm}"
  if [ -s "$mova_nvm_dir/nvm.sh" ]; then
    # shellcheck disable=SC1090
    . "$mova_nvm_dir/nvm.sh"
  fi

  if ! command -v node >/dev/null 2>&1; then
    local mova_node_bin
    for mova_node_bin in "$HOME"/.cache/codex-runtimes/*/dependencies/node/bin "$HOME"/.nvm/versions/node/*/bin; do
      if [ -x "$mova_node_bin/node" ]; then
        export PATH="$mova_node_bin:$PATH"
        break
      fi
    done
  fi

  if ! command -v node >/dev/null 2>&1; then
    echo "❌ Node.js не найден."
    echo "   Установите Node.js 20 или новее: https://nodejs.org"
    return 1
  fi

  if command -v pnpm >/dev/null 2>&1; then
    MOVA_PNPM=(pnpm)
  else
    local mova_pnpm_bin
    for mova_pnpm_bin in "$HOME"/.cache/codex-runtimes/*/dependencies/bin/fallback; do
      if [ -x "$mova_pnpm_bin/pnpm" ]; then
        export PATH="$mova_pnpm_bin:$PATH"
        MOVA_PNPM=(pnpm)
        break
      fi
    done
  fi

  if [ "${#MOVA_PNPM[@]}" -eq 0 ] && command -v corepack >/dev/null 2>&1; then
    MOVA_PNPM=(corepack pnpm)
  fi

  if [ "${#MOVA_PNPM[@]}" -eq 0 ]; then
    echo "❌ pnpm не найден."
    echo "   Выполните: corepack enable"
    return 1
  fi
}

run_pnpm() {
  "${MOVA_PNPM[@]}" "$@"
}

mova_runtime_dir() { echo ".mova-runtime"; }
mova_pid_file() { echo "$(mova_runtime_dir)/dev.pid"; }
mova_log_file() { echo "$(mova_runtime_dir)/dev.log"; }
mova_web_url() { echo "http://127.0.0.1:5173"; }
mova_api_url() { echo "http://127.0.0.1:8787"; }

ensure_runtime_dir() {
  mkdir -p "$(mova_runtime_dir)"
}

saved_pid() {
  local mova_file
  mova_file="$(mova_pid_file)"
  [ -f "$mova_file" ] && tr -dc '0-9' < "$mova_file" || true
}

pid_is_alive() {
  local mova_pid="$1"
  [ -n "$mova_pid" ] && kill -0 "$mova_pid" 2>/dev/null
}

port_pids() {
  local mova_port="$1"
  command -v lsof >/dev/null 2>&1 && lsof -tiTCP:"$mova_port" -sTCP:LISTEN 2>/dev/null || true
}

pid_belongs_to_project() {
  local mova_pid="$1" mova_cwd
  mova_cwd="$(lsof -a -p "$mova_pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)"
  [ "$mova_cwd" = "$(pwd)" ]
}

api_is_ready() {
  curl -fsS "$(mova_api_url)/api/health" 2>/dev/null | grep -q '"ok":true'
}

web_is_ready() {
  curl -fsS "$(mova_web_url)" 2>/dev/null | grep -qi '<html'
}

server_is_ready() {
  api_is_ready && web_is_ready
}

print_urls() {
  echo ""
  echo "  Mova:       $(mova_web_url)"
  echo "  API health: $(mova_api_url)/api/health"
  echo "  Лог:        $(pwd)/$(mova_log_file)"
  echo ""
}

open_mova() {
  if [ "${MOVA_OPEN_BROWSER:-1}" = "1" ] && command -v open >/dev/null 2>&1; then
    open "$(mova_web_url)"
  fi
}

stop_mova() {
  ensure_runtime_dir
  local mova_pid mova_wait mova_remaining mova_project_pids mova_foreign_pids mova_child_pid
  mova_pid="$(saved_pid)"

  if pid_is_alive "$mova_pid"; then
    echo "Останавливаем Mova (PID $mova_pid)..."
    kill "$mova_pid" 2>/dev/null || true
    mova_wait=0
    while pid_is_alive "$mova_pid" && [ "$mova_wait" -lt 30 ]; do
      sleep 0.2
      mova_wait=$((mova_wait + 1))
    done
  fi

  mova_remaining="$(printf '%s\n%s\n' "$(port_pids 5173)" "$(port_pids 8787)" | awk 'NF' | sort -u)"
  if [ -n "$mova_remaining" ]; then
    mova_project_pids=""
    mova_foreign_pids=""
    for mova_child_pid in $mova_remaining; do
      if pid_belongs_to_project "$mova_child_pid"; then
        mova_project_pids="$mova_project_pids $mova_child_pid"
      else
        mova_foreign_pids="$mova_foreign_pids $mova_child_pid"
      fi
    done
    if [ -n "$mova_project_pids" ]; then
      echo "Завершаем дочерние процессы Mova..."
      # shellcheck disable=SC2086
      kill $mova_project_pids 2>/dev/null || true
      sleep 0.5
    fi
    if [ -n "$mova_foreign_pids" ]; then
      echo "❌ Порты заняты чужими процессами, они не были остановлены:$mova_foreign_pids"
      return 1
    fi
  fi

  mova_remaining="$(printf '%s\n%s\n' "$(port_pids 5173)" "$(port_pids 8787)" | awk 'NF' | sort -u)"
  if [ -n "$mova_remaining" ]; then
    echo "❌ Не удалось освободить порты 5173 и 8787."
    return 1
  fi

  unlink "$(mova_pid_file)" 2>/dev/null || true
  echo "✅ Mova остановлена."
}

print_status() {
  local mova_pid mova_web_pids mova_api_pids
  mova_pid="$(saved_pid)"
  mova_web_pids="$(port_pids 5173)"
  mova_api_pids="$(port_pids 8787)"
  if ! pid_is_alive "$mova_pid"; then mova_pid=""; fi

  echo "=========================================="
  echo "  Mova — статус локального запуска"
  echo "=========================================="
  if server_is_ready; then
    echo "🟢 Приложение работает."
  elif pid_is_alive "$mova_pid"; then
    echo "🟡 Процесс запущен, но приложение ещё не готово."
  else
    echo "⚪ Приложение не запущено."
  fi
  echo "  Главный PID: ${mova_pid:-—}"
  echo "  Web 5173:   ${mova_web_pids:-свободен}"
  echo "  API 8787:   ${mova_api_pids:-свободен}"
  print_urls

  if [ -f "$(mova_log_file)" ]; then
    echo "Последние строки лога:"
    tail -n 12 "$(mova_log_file)"
  fi
}
