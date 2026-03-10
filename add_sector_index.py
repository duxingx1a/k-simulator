"""
为场景数据添加板块指数走势
使用申万行业指数或中证行业指数
运行方式：python add_sector_index.py
"""
import os
import json
import time
import socket
import sqlite3
import requests as req_lib

import akshare as ak
import pandas as pd

# 设置全局 socket 超时 15 秒，防止 SSL 握手卡死
socket.setdefaulttimeout(15)

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'game.db')

# 板块名称 → 可用的行业指数代码（尝试多个来源）
# 格式：板块名 → [(指数代码, 数据获取函数名), ...]
SECTOR_INDEX_MAP = {
    '白酒': '399997',       # 中证白酒
    '新能源汽车': '399976',  # 中证新能车
    '新能源': '399808',      # 中证新能
    '保险': '399809',        # 中证保险（不一定存在）
    '银行': '399986',        # 中证银行
    '光伏': '931151',        # 中证光伏
    '房地产': '399393',      # 国证地产
    '券商': '399975',        # 中证全指证券
    '医药': '399386',        # 中证800医药（不一定存在）
    '工程机械': '000300',    # 沪深300（无对应板块，用大盘替代）
    '家电': '930697',        # 中证家电（不一定存在）
    '旅游': '000300',        # 沪深300（替代）
    '电力': '000300',        # 沪深300（替代）
    '消费电子': '931159',    # 中证消费电子
    '食品饮料': '399396',    # 国证食品
    '有色金属': '399395',    # 国证有色
    '养殖': '000300',        # 沪深300（替代）
    '半导体': '000300',      # 沪深300（半导体指数暂时不可用）
    '煤炭': '399998',        # 中证煤炭
    '安防': '000300',        # 沪深300（替代）
}


def download_index(code, start_date, end_date, max_retries=3):
    """下载指数历史数据，带重试和超时"""
    for attempt in range(max_retries):
        try:
            # 尝试用 index_zh_a_hist 获取
            df = ak.index_zh_a_hist(
                symbol=code, period="daily",
                start_date=start_date.replace('-', ''),
                end_date=end_date.replace('-', '')
            )
            if df is not None and len(df) > 0:
                return df
        except KeyboardInterrupt:
            raise
        except Exception as e:
            if attempt < max_retries - 1:
                print(f' (重试{attempt+1}...)', end='', flush=True)
                time.sleep(3 * (attempt + 1))
                continue

        try:
            # 备用：用 stock_zh_index_daily
            prefix = 'sh' if code.startswith('0') or code.startswith('5') else 'sz'
            df = ak.stock_zh_index_daily(symbol=f"{prefix}{code}")
            if df is not None and len(df) > 0:
                df['date'] = pd.to_datetime(df['date'])
                mask = (df['date'] >= pd.to_datetime(start_date)) & (df['date'] <= pd.to_datetime(end_date))
                return df[mask].copy()
        except KeyboardInterrupt:
            raise
        except Exception:
            if attempt < max_retries - 1:
                print(f' (重试{attempt+1}...)', end='', flush=True)
                time.sleep(3 * (attempt + 1))
                continue

    return None


def main():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    # 确保有 sector_data 列
    try:
        conn.execute('ALTER TABLE scenarios ADD COLUMN sector_data TEXT')
        conn.commit()
    except Exception:
        pass

    scenarios = conn.execute(
        "SELECT id, sector, start_date, end_date, sector_data FROM scenarios WHERE sector IS NOT NULL"
    ).fetchall()

    print('=' * 50)
    print('K线大师 - 添加板块指数走势')
    print('=' * 50)
    print(f'共 {len(scenarios)} 个场景')
    print()

    # 缓存已下载的指数数据（避免重复下载同一指数）
    index_cache = {}
    updated = 0
    failed = 0

    for s in scenarios:
        sid = s['id']
        sector = s['sector']
        start = s['start_date']
        end = s['end_date']
        existing = s['sector_data']

        # 跳过已有数据的场景（断点续传）
        if existing:
            print(f'  场景#{sid}: {sector} → 已有数据，跳过')
            updated += 1
            continue

        if not sector or sector == '未知' or not start or not end:
            continue

        index_code = SECTOR_INDEX_MAP.get(sector)
        if not index_code:
            print(f'  场景#{sid}: {sector} → 无对应指数')
            continue

        # 使用缓存键
        cache_key = f"{index_code}_{start}_{end}"
        if cache_key in index_cache:
            sector_data = index_cache[cache_key]
        else:
            print(f'  📥 下载 {sector} 指数({index_code}) {start}~{end}...', end='', flush=True)
            df = download_index(index_code, start, end)
            if df is not None and len(df) > 0:
                # 提取收盘价并归一化为涨跌幅
                close_col = '收盘' if '收盘' in df.columns else 'close'
                closes = df[close_col].astype(float).tolist()
                base = closes[0]
                sector_data = [
                    {'close': round(c, 2), 'pct': round((c / base - 1) * 100, 2)}
                    for c in closes
                ]
                print(f' ✓ {len(sector_data)}天')
            else:
                sector_data = None
                print(' ✗ 失败')
                failed += 1

            index_cache[cache_key] = sector_data
            time.sleep(0.3)

        if sector_data:
            conn.execute(
                "UPDATE scenarios SET sector_data = ? WHERE id = ?",
                (json.dumps(sector_data), sid)
            )
            conn.commit()  # 每次立即提交，防止崩溃丢失
            updated += 1
            print(f'  场景#{sid}: {sector} ✓ ({len(sector_data)}天)')

    conn.close()
    print(f'\n✅ 更新完成: 成功 {updated}, 失败 {failed}')


if __name__ == '__main__':
    main()
