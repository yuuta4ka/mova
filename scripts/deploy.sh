#!/bin/bash
set -e
cd "$(dirname "$0")/.." || exit 1

MOVA_COMMIT_MESSAGE="${1:-Deploy: Mova updates}"
MOVA_DEPLOY_URL="${MOVA_DEPLOY_URL:-https://hola-mova.ru}"
export MOVA_DEPLOY_URL
if [ -z "${MOVA_DEPLOY_HOOK_SECRET:-}" ] && command -v security >/dev/null 2>&1; then
  MOVA_DEPLOY_HOOK_SECRET="$(security find-generic-password -a "$(id -un)" -s mova-deploy-hook -w 2>/dev/null || true)"
fi
export MOVA_DEPLOY_HOOK_SECRET

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

node scripts/desktop-release.mjs check-version
MOVA_DESKTOP_VERSION="$(node scripts/desktop-release.mjs version)"
MOVA_DESKTOP_TAG="$(node scripts/desktop-release.mjs tag)"
MOVA_GITHUB_REPOSITORY="$(node scripts/desktop-release.mjs repository)"
MOVA_DESKTOP_RELEASE_NEEDED=0
MOVA_RELEASE_ASSETS=(
  "release/latest-mac.yml"
  "release/latest.yml"
  "release/Mova-$MOVA_DESKTOP_VERSION-arm64.dmg"
  "release/Mova-$MOVA_DESKTOP_VERSION-arm64.dmg.blockmap"
  "release/Mova-$MOVA_DESKTOP_VERSION-arm64.zip"
  "release/Mova-$MOVA_DESKTOP_VERSION-arm64.zip.blockmap"
  "release/Mova.Setup.$MOVA_DESKTOP_VERSION.exe"
  "release/Mova.Setup.$MOVA_DESKTOP_VERSION.exe.blockmap"
)

verify_published_desktop_release() {
  local published_assets
  local release_asset
  local release_asset_name
  if ! published_assets="$(gh release view "$MOVA_DESKTOP_TAG" --repo "$MOVA_GITHUB_REPOSITORY" --json assets --jq '.assets[].name')"; then
    echo "❌ Не удалось проверить файлы desktop-релиза $MOVA_DESKTOP_TAG."
    return 1
  fi
  for release_asset in "${MOVA_RELEASE_ASSETS[@]}"; do
    release_asset_name="${release_asset##*/}"
    if ! printf '%s\n' "$published_assets" | grep -Fxq "$release_asset_name"; then
      echo "❌ В GitHub Release отсутствует $release_asset_name."
      return 1
    fi
  done
  return 0
}

if ! command -v gh >/dev/null 2>&1; then
  echo "❌ Для проверки и публикации desktop-релиза нужен GitHub CLI (gh)."
  exit 1
fi
if ! gh auth status >/dev/null 2>&1; then
  echo "❌ GitHub CLI не авторизован. Выполните gh auth login."
  exit 1
fi

if gh release view "$MOVA_DESKTOP_TAG" --repo "$MOVA_GITHUB_REPOSITORY" >/dev/null 2>&1; then
  if ! verify_published_desktop_release; then
    echo "Существующий релиз не будет перезаписан. Исправьте его вручную или увеличьте version в package.json."
    exit 1
  fi
  echo "Desktop-релиз $MOVA_DESKTOP_TAG уже опубликован — повторная сборка не нужна."
  node scripts/desktop-release.mjs prune
else
  MOVA_DESKTOP_RELEASE_NEEDED=1
  echo "Найдена новая desktop-версия $MOVA_DESKTOP_VERSION. Собираем установщики..."
  pnpm test
  pnpm build
  pnpm desktop:build:mac
  pnpm desktop:build:win
  node scripts/desktop-release.mjs verify
fi

git status --short
echo ""
git add -A
if git diff --cached --quiet; then
  echo "Новых изменений для коммита нет."
else
  git commit -m "$MOVA_COMMIT_MESSAGE"
fi

if [ -z "${MOVA_DEPLOY_HOOK_SECRET:-}" ]; then
  echo "❌ Deploy secret не найден в MOVA_DEPLOY_HOOK_SECRET или macOS Keychain (service: mova-deploy-hook)."
  exit 1
fi

MOVA_MAINTENANCE_STATE="$(node scripts/maintenance.mjs status)"
MOVA_DEPLOYMENT_ID=""
if printf '%s' "$MOVA_MAINTENANCE_STATE" | grep -q '"active":true'; then
  MOVA_DEPLOYMENT_ID="$(printf '%s' "$MOVA_MAINTENANCE_STATE" | sed -n 's/.*"deploymentId":"\([^"]*\)".*/\1/p')"
fi
if [ -n "$MOVA_DEPLOYMENT_ID" ]; then
  echo "Продолжаем активный maintenance ($MOVA_DEPLOYMENT_ID)..."
else
  MOVA_DEPLOYMENT_ID="deploy-$(date -u +%Y%m%dT%H%M%SZ)-$(git rev-parse --short HEAD)"
  echo "Включаем maintenance ($MOVA_DEPLOYMENT_ID)..."
  node scripts/maintenance.mjs on "$MOVA_DEPLOYMENT_ID"
fi

echo "Отправляем код в GitHub..."
if ! git push origin "$MOVA_BRANCH"; then
  echo "❌ GitHub отклонил отправку. Maintenance оставлен включённым."
  exit 1
fi
echo ""
echo "✅ Код отправлен в origin/$MOVA_BRANCH."

if [ "$MOVA_DESKTOP_RELEASE_NEEDED" -eq 1 ]; then
  MOVA_DEPLOY_COMMIT="$(git rev-parse HEAD)"
  MOVA_REMOTE_COMMIT="$(git ls-remote origin "refs/heads/$MOVA_BRANCH" | awk 'NR == 1 { print $1 }')"
  if [ "$MOVA_REMOTE_COMMIT" != "$MOVA_DEPLOY_COMMIT" ]; then
    echo "❌ Удалённая ветка не указывает на подготовленный commit. Desktop-релиз не опубликован."
    exit 1
  fi

  MOVA_REMOTE_TAG_COMMIT="$(git ls-remote origin "refs/tags/$MOVA_DESKTOP_TAG" "refs/tags/$MOVA_DESKTOP_TAG^{}" | awk '/\^\{\}$/ { peeled=$1 } !/\^\{\}$/ { direct=$1 } END { print peeled ? peeled : direct }')"
  if [ -n "$MOVA_REMOTE_TAG_COMMIT" ] && [ "$MOVA_REMOTE_TAG_COMMIT" != "$MOVA_DEPLOY_COMMIT" ]; then
    echo "❌ Тег $MOVA_DESKTOP_TAG уже указывает на другой commit. Desktop-релиз не опубликован."
    exit 1
  fi

  echo "Публикуем desktop-релиз $MOVA_DESKTOP_TAG..."
  if ! gh release create "$MOVA_DESKTOP_TAG" "${MOVA_RELEASE_ASSETS[@]}" \
    --repo "$MOVA_GITHUB_REPOSITORY" \
    --target "$MOVA_DEPLOY_COMMIT" \
    --title "Mova $MOVA_DESKTOP_VERSION" \
    --generate-notes \
    --latest; then
    echo "❌ Desktop-релиз не опубликован. Maintenance оставлен включённым."
    exit 1
  fi

  if ! verify_published_desktop_release; then
    echo "❌ Desktop-релиз опубликован не полностью. Maintenance оставлен включённым."
    exit 1
  fi
  echo "✅ Desktop-релиз $MOVA_DESKTOP_TAG опубликован."
fi

echo "Ждём readiness нового backend..."
if ! node scripts/maintenance.mjs wait-ready "$MOVA_DEPLOYMENT_ID" "${MOVA_DEPLOY_READY_TIMEOUT:-900}"; then
  echo "❌ Новый backend не подтвердил readiness. Maintenance оставлен включённым."
  exit 1
fi
echo "✅ Новый backend готов, maintenance выключен."
