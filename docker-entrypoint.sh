#!/bin/sh
# 首次启动时，把镜像内置的股票场景数据拷入持久化卷（已存在则不覆盖）。
# 用户数据库 game.db 不拷贝，由应用启动时自动新建空表。
set -e

mkdir -p "$DATA_DIR"

if [ ! -f "$DATA_DIR/stock_data.db" ] && [ -f /app/stock_data.db ]; then
    echo "[entrypoint] 初始化股票数据 -> $DATA_DIR/stock_data.db"
    cp /app/stock_data.db "$DATA_DIR/stock_data.db"
fi

exec "$@"
