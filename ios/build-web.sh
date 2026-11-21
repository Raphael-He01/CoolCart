#!/bin/sh
set -eu

# Xcode launched from Finder does not inherit a terminal's PATH.
export PATH="${PATH}:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin"
cd "$SRCROOT/.."

if ! command -v node >/dev/null || [ ! -f node_modules/vite/bin/vite.js ]; then
    echo "error: 请先安装 Node.js 并在 cool-cart 项目根目录运行 npm ci。" >&2
    exit 1
fi

node node_modules/vite/bin/vite.js build \
    --outDir "$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/Web" --emptyOutDir
