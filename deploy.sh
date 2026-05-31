#!/bin/sh
# 一键更新部署：拉取最新代码并重建容器。
# 用法（在服务器项目目录下）： ./deploy.sh
set -e

cd "$(dirname "$0")"

echo "==> 拉取最新代码"
git pull --ff-only

echo "==> 重建并启动容器"
docker compose up -d --build

echo "==> 清理悬空镜像"
docker image prune -f

echo "==> 完成，当前状态："
docker compose ps
