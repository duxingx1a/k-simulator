"""
数据库连接模块
- game.db      : 用户数据（users / games / trades）
- stock_data.db: 股票场景数据（scenarios）
"""
import sqlite3
import os
import json
from stock_data import StockDataManager

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
GAME_DB_PATH = os.path.join(BASE_DIR, 'game.db')
STOCK_DB_PATH = os.path.join(BASE_DIR, 'stock_data.db')

_stock_manager = StockDataManager()

# 允许通过环境变量 DATA_DIR 指定数据库存放目录（用于 Docker 持久化卷）
_DATA_DIR = os.environ.get('DATA_DIR')
if _DATA_DIR:
    os.makedirs(_DATA_DIR, exist_ok=True)
    GAME_DB_PATH = os.path.join(_DATA_DIR, 'game.db')
    STOCK_DB_PATH = os.path.join(_DATA_DIR, 'stock_data.db')


def get_db():
    """连接用户数据库（users / games / trades）"""
    conn = sqlite3.connect(GAME_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def get_stock_db():
    """连接股票数据库（scenarios）"""
    conn = sqlite3.connect(STOCK_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def get_db_with_stock():
    """连接用户数据库，并挂载股票数据库为 stock_db
    适用于需要跨库 JOIN 的查询（如 scenario_list、game_detail）。
    使用 stock_db.scenarios 前缀引用场景表。
    """
    conn = sqlite3.connect(GAME_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute('ATTACH DATABASE ? AS stock_db', (STOCK_DB_PATH,))
    return conn


def init_db():
    """初始化两个数据库的表结构，并在无数据时生成模拟场景"""
    # ── 用户数据库 ──────────────────────────────────────
    conn = get_db()
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nickname TEXT UNIQUE NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS games (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            scenario_id INTEGER NOT NULL,
            current_day INTEGER DEFAULT 0,
            initial_cash REAL DEFAULT 100000,
            cash REAL DEFAULT 100000,
            shares INTEGER DEFAULT 0,
            avg_cost REAL DEFAULT 0,
            status TEXT DEFAULT 'playing',
            profit_rate REAL DEFAULT 0,
            final_asset REAL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS trades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id INTEGER NOT NULL,
            day INTEGER NOT NULL,
            action TEXT NOT NULL,
            price REAL NOT NULL,
            shares INTEGER NOT NULL,
            amount REAL NOT NULL,
            cash_after REAL NOT NULL,
            shares_after INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (game_id) REFERENCES games(id)
        );
    ''')
    conn.commit()
    conn.close()

    # ── 股票数据库 ──────────────────────────────────────
    stock_conn = get_stock_db()
    stock_conn.executescript('''
        CREATE TABLE IF NOT EXISTS scenarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            stock_code TEXT,
            stock_name TEXT,
            start_date TEXT,
            end_date TEXT,
            name TEXT NOT NULL,
            pattern TEXT NOT NULL DEFAULT '',
            data TEXT NOT NULL
        );
    ''')
    stock_conn.commit()

    # 兼容旧库：尝试添加扩展列
    for col in ['sector TEXT', 'market_data TEXT', 'sector_data TEXT']:
        try:
            stock_conn.execute(f'ALTER TABLE scenarios ADD COLUMN {col}')
            stock_conn.commit()
        except Exception:
            pass

    # 无场景数据时生成模拟数据
    count = stock_conn.execute('SELECT COUNT(*) as cnt FROM scenarios').fetchone()['cnt']
    if count == 0:
        print('未找到股票数据，使用模拟数据（运行 python init_data.py 导入真实数据）')
        scenarios = _stock_manager.generate_all_scenarios()
        for s in scenarios:
            stock_conn.execute(
                'INSERT INTO scenarios (name, pattern, data) VALUES (?, ?, ?)',
                (s['name'], s['pattern'], json.dumps(s['data']))
            )
        stock_conn.commit()
        print(f'已生成 {len(scenarios)} 个模拟走势场景')

    stock_conn.close()
