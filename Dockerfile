# 极简生产镜像：运行时仅需 Flask + Gunicorn
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    DATA_DIR=/data

WORKDIR /app

# 仅安装运行时依赖（akshare/pandas 等仅用于离线数据脚本，不进生产镜像）
RUN pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple \
        flask gunicorn

# 拷贝应用代码（game.db 由 .dockerignore 排除，stock_data.db 作为种子保留）
COPY . /app

# 入口脚本：首次启动把内置 stock_data.db 拷入数据卷（兼容 Windows 换行符）
RUN sed -i 's/\r$//' /app/docker-entrypoint.sh && chmod +x /app/docker-entrypoint.sh

EXPOSE 5000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["gunicorn", "-w", "2", "-k", "gthread", "--threads", "4", \
     "-b", "0.0.0.0:5000", "--access-logfile", "-", "app:app"]
