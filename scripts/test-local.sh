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
echo "1/3 Unit и UI-тесты"
run_pnpm test
echo ""
echo "2/3 Production-сборка"
run_pnpm build
echo ""
echo "3/3 Интеграционный тест API/WebSocket"
run_pnpm test:integration
echo ""
echo "✅ Все проверки Mova прошли."
