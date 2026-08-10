#!/bin/bash
set -e
# shellcheck disable=SC1091
source "$(dirname "$0")/lib.sh"
mova_root
setup_runtime

MOVA_COMMIT_MESSAGE="${1:-Deploy: Mova updates}"
export GIT_TERMINAL_PROMPT=0
export GCM_INTERACTIVE=Never

echo "=========================================="
echo "  Mova — деплой через GitHub"
echo "=========================================="
echo "Папка: $(pwd)"
echo ""

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "❌ Это не git-репозиторий."
  exit 1
fi

MOVA_BRANCH="$(git branch --show-current)"
MOVA_REMOTE="$(git remote get-url origin 2>/dev/null || true)"
if [ -z "$MOVA_REMOTE" ]; then
  echo "❌ Git remote origin не настроен."
  exit 1
fi

echo "Ветка:  $MOVA_BRANCH"
echo "Remote: $MOVA_REMOTE"
echo ""
git status --short
echo ""
echo "Проверяем проект перед отправкой..."
bash scripts/test-local.sh

git add -A
if git diff --cached --quiet; then
  echo "Новых изменений для коммита нет."
else
  git commit -m "$MOVA_COMMIT_MESSAGE"
fi

echo "Отправляем код без интерактивных запросов..."
if ! git push origin "$MOVA_BRANCH"; then
  echo "❌ Не удалось отправить код через сохранённую авторизацию Git."
  echo "   Один раз настройте доступ к GitHub в Связке ключей macOS, затем снова запустите Deploy.command."
  exit 1
fi
echo ""
echo "✅ Код отправлен в origin/$MOVA_BRANCH."
echo "   Amvera подхватит обновление автоматически."
