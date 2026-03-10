"""
增量下载更多股票数据（不影响现有数据）
运行方式：python add_more_data.py
"""
import os
import json
import random
import time
import sqlite3

import akshare as ak
import pandas as pd

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'game.db')

# 完整股票池（扩充到25只，覆盖更多行业和风格）
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
    # 新增
    ('600887', '伊利股份'),
    ('000333', '美的集团'),
    ('601899', '紫金矿业'),
    ('600030', '中信证券'),
    ('002714', '牧原股份'),
    ('603259', '药明康德'),
    ('601225', '陕西煤业'),
    ('002371', '北方华创'),
    ('600809', '山西汾酒'),
    ('002415', '海康威视'),
]

SEGMENTS_PER_STOCK = 3
SEGMENT_DAYS = 50


def download_stock(code, name, retries=3):
    """下载单只股票数据，带重试"""
    for attempt in range(retries):
        try:
            print(f'  📥 {name}({code}) 第{attempt+1}次尝试...', end='', flush=True)
            df = ak.stock_zh_a_hist(
                symbol=code, period="daily",
                start_date='20200101', end_date='20260301',
                adjust="qfq"
            )
            print(f' ✓ {len(df)}条')
            return df
        except Exception as e:
            print(f' ✗ {e}')
            if attempt < retries - 1:
                wait = (attempt + 1) * 2
                print(f'    等待{wait}秒后重试...')
                time.sleep(wait)
    return None


def extract_segments(df, stock_code, stock_name):
    """抽取K线片段"""
    if df is None or len(df) < SEGMENT_DAYS + 20:
        return []
    segments = []
    max_start = len(df) - SEGMENT_DAYS
    used = set()
    attempts = 0
    while len(segments) < SEGMENTS_PER_STOCK and attempts < SEGMENTS_PER_STOCK * 20:
        attempts += 1
        start = random.randint(20, max_start)
        if any(abs(start - u) < SEGMENT_DAYS for u in used):
            continue
        used.add(start)
        seg = df.iloc[start:start + SEGMENT_DAYS]
        kline = []
        for _, row in seg.iterrows():
            kline.append({
                'open': round(float(row['开盘']), 2),
                'high': round(float(row['最高']), 2),
                'low': round(float(row['最低']), 2),
                'close': round(float(row['收盘']), 2),
                'volume': int(row['成交量'])
            })
        sd = str(seg.iloc[0]['日期'])[:10]
        ed = str(seg.iloc[-1]['日期'])[:10]
        segments.append({
            'stock_code': stock_code,
            'stock_name': stock_name,
            'start_date': sd,
            'end_date': ed,
            'name': f'{stock_name} ({sd} ~ {ed})',
            'data': kline
        })
    return segments


def main():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    # 查看现有数据中已有哪些股票
    existing = set()
    try:
        rows = conn.execute("SELECT DISTINCT stock_code FROM scenarios WHERE stock_code IS NOT NULL").fetchall()
        existing = {r['stock_code'] for r in rows}
    except Exception:
        pass

    existing_count = conn.execute("SELECT COUNT(*) as cnt FROM scenarios").fetchone()['cnt']
    print('=' * 50)
    print('K线大师 - 增量数据下载')
    print('=' * 50)
    print(f'现有场景数: {existing_count}')
    print(f'已有股票: {existing or "无"}')
    print()

    # 只下载还没有的股票
    todo = [(code, name) for code, name in STOCK_POOL if code not in existing]
    if not todo:
        print('所有股票已下载完毕！无需操作。')
        conn.close()
        return

    print(f'待下载: {len(todo)} 只股票')
    print()

    added = 0
    for code, name in todo:
        df = download_stock(code, name)
        if df is not None and len(df) > 0:
            segs = extract_segments(df, code, name)
            for seg in segs:
                conn.execute(
                    '''INSERT INTO scenarios (stock_code, stock_name, start_date, end_date, name, pattern, data)
                       VALUES (?, ?, ?, ?, ?, '', ?)''',
                    (seg['stock_code'], seg['stock_name'], seg['start_date'], seg['end_date'],
                     seg['name'], json.dumps(seg['data']))
                )
            added += len(segs)
            print(f'    → 添加 {len(segs)} 个片段')
        time.sleep(0.5)

    conn.commit()
    total = conn.execute("SELECT COUNT(*) as cnt FROM scenarios").fetchone()['cnt']
    conn.close()

    print()
    print(f'✅ 新增 {added} 个场景，总计 {total} 个场景')


if __name__ == '__main__':
    main()
