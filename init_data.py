"""
初始化真实股票数据
从 akshare 下载A股历史日K线数据，随机提取50个交易日的片段
运行方式：python init_data.py
"""
import os
import sys
import json
import random
import time
import sqlite3

try:
    import akshare as ak
except ImportError:
    print('❌ 请先安装 akshare：pip install akshare -i https://pypi.tuna.tsinghua.edu.cn/simple')
    sys.exit(1)

try:
    import pandas as pd
except ImportError:
    print('❌ 请先安装 pandas：pip install pandas -i https://pypi.tuna.tsinghua.edu.cn/simple')
    sys.exit(1)

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'game.db')

# 代表性A股股票池（覆盖各行业、各市值、各风格）
STOCK_POOL = [
    ('600519', '贵州茅台'),
    ('002594', '比亚迪'),
    ('300750', '宁德时代'),
    ('601318', '中国平安'),
    ('600036', '招商银行'),
    ('601012', '隆基绿能'),
    ('000002', '万科A'),
    ('300059', '东方财富'),
    ('600276', '恒瑞医药'),
    ('600031', '三一重工'),
    ('000651', '格力电器'),
    ('601888', '中国中免'),
    ('000858', '五粮液'),
    ('600900', '长江电力'),
    ('002475', '立讯精密'),
]

# 每只股票提取的片段数量
SEGMENTS_PER_STOCK = 3
# 每个片段的交易日天数（前20天看，后30天交易）
SEGMENT_DAYS = 50


def download_stock_data(code, name, start_date='20200101', end_date='20260301'):
    """下载单只股票的历史日K线数据（前复权）"""
    print(f'  📥 下载 {name}({code})...', end='', flush=True)
    try:
        df = ak.stock_zh_a_hist(
            symbol=code, period="daily",
            start_date=start_date, end_date=end_date,
            adjust="qfq"
        )
        print(f' ✓ {len(df)}条记录')
        return df
    except Exception as e:
        print(f' ✗ 失败: {e}')
        return None


def extract_segments(df, stock_code, stock_name, segment_days=SEGMENT_DAYS, count=SEGMENTS_PER_STOCK):
    """从股票历史数据中随机抽取不重叠的K线片段"""
    if df is None or len(df) < segment_days + 20:
        return []

    segments = []
    max_start = len(df) - segment_days
    used_starts = set()

    attempts = 0
    while len(segments) < count and attempts < count * 20:
        attempts += 1
        start_idx = random.randint(20, max_start)

        # 检查是否与已选片段重叠
        overlap = False
        for used in used_starts:
            if abs(start_idx - used) < segment_days:
                overlap = True
                break
        if overlap:
            continue

        used_starts.add(start_idx)
        segment = df.iloc[start_idx:start_idx + segment_days]

        # 转换为OHLCV格式
        kline_data = []
        for _, row in segment.iterrows():
            kline_data.append({
                'open': round(float(row['开盘']), 2),
                'high': round(float(row['最高']), 2),
                'low': round(float(row['最低']), 2),
                'close': round(float(row['收盘']), 2),
                'volume': int(row['成交量'])
            })

        # 获取时间范围
        start_date = str(segment.iloc[0]['日期'])[:10]
        end_date = str(segment.iloc[-1]['日期'])[:10]

        segments.append({
            'stock_code': stock_code,
            'stock_name': stock_name,
            'start_date': start_date,
            'end_date': end_date,
            'name': f'{stock_name} ({start_date} ~ {end_date})',
            'data': kline_data
        })

    return segments


def init_database():
    """初始化数据库并导入真实股票数据"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    # 创建表结构（如果不存在）
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

    # 删除旧的场景表，重建带真实数据字段的版本
    conn.execute('DROP TABLE IF EXISTS scenarios')
    conn.execute('''
        CREATE TABLE scenarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            stock_code TEXT,
            stock_name TEXT,
            start_date TEXT,
            end_date TEXT,
            name TEXT NOT NULL,
            pattern TEXT NOT NULL DEFAULT '',
            data TEXT NOT NULL
        )
    ''')
    conn.commit()

    print('=' * 50)
    print('K线大师 - 真实股票数据初始化')
    print('=' * 50)
    print(f'股票池：{len(STOCK_POOL)} 只')
    print(f'每只提取：{SEGMENTS_PER_STOCK} 个片段')
    print(f'片段长度：{SEGMENT_DAYS} 个交易日')
    print()

    all_segments = []

    for code, name in STOCK_POOL:
        df = download_stock_data(code, name)
        if df is not None and len(df) > 0:
            segments = extract_segments(df, code, name)
            all_segments.extend(segments)
        time.sleep(0.3)  # 避免请求过快

    if not all_segments:
        print('\n⚠ 未能下载任何数据！请检查网络连接。')
        print('将使用模拟数据作为替代...')
        from stock_data import StockDataManager
        mgr = StockDataManager()
        scenarios = mgr.generate_all_scenarios()
        for s in scenarios:
            conn.execute(
                'INSERT INTO scenarios (name, pattern, data) VALUES (?, ?, ?)',
                (s['name'], s['pattern'], json.dumps(s['data']))
            )
        conn.commit()
        print(f'已生成 {len(scenarios)} 个模拟数据场景')
    else:
        for seg in all_segments:
            conn.execute(
                '''INSERT INTO scenarios (stock_code, stock_name, start_date, end_date, name, pattern, data)
                   VALUES (?, ?, ?, ?, ?, '', ?)''',
                (seg['stock_code'], seg['stock_name'], seg['start_date'], seg['end_date'],
                 seg['name'], json.dumps(seg['data']))
            )
        conn.commit()
        print(f'\n✅ 成功导入 {len(all_segments)} 个真实数据场景')

    conn.close()
    print(f'📁 数据库路径：{DB_PATH}')
    print('现在可以运行 python app.py 启动应用了！')


if __name__ == '__main__':
    init_database()
