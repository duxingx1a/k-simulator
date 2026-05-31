"""
K线大师 - 模拟交易游戏后端
"""
import secrets
from flask import Flask, render_template
from db import init_db
from routes.auth import auth_bp
from routes.game import game_bp
from routes.rank import rank_bp

app = Flask(__name__)
app.secret_key = secrets.token_hex(32)

# 注册蓝图
app.register_blueprint(auth_bp)
app.register_blueprint(game_bp)
app.register_blueprint(rank_bp)


@app.route('/')
def index():
    return render_template('index.html')


# 启动时初始化数据库
init_db()

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
