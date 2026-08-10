#!/bin/bash
set -e
cd "$(dirname "$0")/.." || exit 1

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
git add -A
if git diff --cached --quiet; then
  echo "Новых изменений для коммита нет."
else
  git commit -m "$MOVA_COMMIT_MESSAGE"
fi

echo "Отправляем код в GitHub..."
if ! git push origin "$MOVA_BRANCH"; then
  echo "❌ GitHub отклонил отправку. Проверьте сообщение Git выше и повторите попытку."
  exit 1
fi
echo ""
echo "✅ Код отправлен в origin/$MOVA_BRANCH."
