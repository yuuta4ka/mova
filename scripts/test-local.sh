#!/bin/bash
set -e
# shellcheck disable=SC1091
source "$(dirname "$0")/lib.sh"
mova_root
setup_runtime
ensure_runtime_dir

echo "=========================================="
echo "  Mova — автоматическая проверка"
echo "=========================================="
echo ""
echo "1/4 Unit и UI-тесты"
run_pnpm test
echo ""
echo "2/4 Production-сборка"
run_pnpm build
echo ""
echo "3/4 Интеграционный тест API/WebSocket"
run_pnpm test:integration
echo ""
echo ""
echo "4/4 Браузерный тест голосового звонка"
run_pnpm test:call
echo ""
echo "✅ Все проверки Mova прошли."
