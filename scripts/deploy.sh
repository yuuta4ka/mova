#!/bin/bash
set -e
# shellcheck disable=SC1091
source "$(dirname "$0")/lib.sh"
mova_root
setup_runtime

MOVA_COMMIT_MESSAGE="${1:-Deploy: Mova updates}"

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
read -r -p "Введите DEPLOY, чтобы закоммитить все изменения и отправить их: " MOVA_CONFIRM
if [ "$MOVA_CONFIRM" != "DEPLOY" ]; then
  echo "Деплой отменён."
  exit 0
fi

echo "Проверяем проект перед отправкой..."
bash scripts/test-local.sh

git add -A
if git diff --cached --quiet; then
  echo "Новых изменений для коммита нет."
else
  git commit -m "$MOVA_COMMIT_MESSAGE"
fi

git push origin "$MOVA_BRANCH"
echo ""
echo "✅ Код отправлен в origin/$MOVA_BRANCH."
echo "   Amvera подхватит обновление автоматически."
