#!/bin/sh
# 一键更新部署：拉取最新代码并重启容器（代码目录已挂载为 volume，无需重建镜像）。
# 用法（在服务器项目目录下）： ./deploy.sh
set -e

cd "$(dirname "$0")"

echo "==> 拉取最新代码"
git pull --ff-only

echo "==> 重启容器（代码已通过卷挂载，无需重建镜像）"
docker compose restart k-simulator

echo "==> 完成，当前状态："
docker compose ps
