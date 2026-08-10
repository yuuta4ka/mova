#!/bin/bash
cd "$(dirname "$0")/.." || exit 1
# shellcheck disable=SC1091
source scripts/lib.sh
mova_root
setup_runtime
print_status
echo ""
read -r -p "Нажмите Enter для закрытия..."
