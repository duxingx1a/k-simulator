"""
为场景数据添加板块信息和大盘走势
运行方式：python add_sector_data.py
"""
import os
import json
import time
import sqlite3

import akshare as ak
import pandas as pd

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'game.db')

# 股票→板块映射
STOCK_SECTOR = {
    '600519': '白酒',
    '002594': '新能源汽车',
    '300750': '新能源',
    '601318': '保险',
    '600036': '银行',
    '601012': '光伏',
    '000002': '房地产',
    '300059': '券商',
    '600276': '医药',
    '600031': '工程机械',
    '000651': '家电',
    '601888': '旅游',
    '000858': '白酒',
    '600900': '电力',
    '002475': '消费电子',
    '600887': '食品饮料',
    '000333': '家电',
    '601899': '有色金属',
    '600030': '券商',
    '002714': '养殖',
    '603259': '医药',
    '601225': '煤炭',
    '002371': '半导体',
    '600809': '白酒',
    '002415': '安防',
}

def download_market_index(start_date, end_date, retries=3):
    """下载上证指数数据"""
    for attempt in range(retries):
        try:
            df = ak.stock_zh_index_daily(symbol="sh000001")
            # 过滤日期范围
            df['date'] = pd.to_datetime(df['date'])
            mask = (df['date'] >= pd.to_datetime(start_date)) & (df['date'] <= pd.to_datetime(end_date))
            segment = df[mask].copy()
            if len(segment) == 0:
                return None
            # 归一化为涨跌幅（百分比）
            base = float(segment.iloc[0]['close'])
            result = []
            for _, row in segment.iterrows():
                result.append({
                    'close': round(float(row['close']), 2),
                    'pct': round((float(row['close']) / base - 1) * 100, 2)
                })
            return result
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(2)
            else:
                print(f'  ✗ 下载上证指数失败: {e}')
                return None


def main():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    # 确保有 sector 和 market_data 列
    for col in ['sector TEXT', 'market_data TEXT']:
        try:
            conn.execute(f'ALTER TABLE scenarios ADD COLUMN {col}')
            conn.commit()
        except Exception:
            pass

    # 获取所有场景
    scenarios = conn.execute(
        "SELECT id, stock_code, start_date, end_date FROM scenarios"
    ).fetchall()

    print('=' * 50)
    print('K线大师 - 添加板块和大盘数据')
    print('=' * 50)
    print(f'共 {len(scenarios)} 个场景')
    print()

    # 先下载完整的上证指数数据（避免重复下载）
    print('📥 下载上证指数全量数据...')
    try:
        market_df = ak.stock_zh_index_daily(symbol="sh000001")
        market_df['date'] = pd.to_datetime(market_df['date'])
        print(f'  ✓ {len(market_df)} 条上证指数记录')
    except Exception as e:
        print(f'  ✗ 失败: {e}')
        market_df = None

    updated = 0
    for s in scenarios:
        sid = s['id']
        code = s['stock_code']
        start = s['start_date']
        end = s['end_date']

        # 设置板块
        sector = STOCK_SECTOR.get(code, '未知')

        # 提取对应日期的大盘数据
        market_data = None
        if market_df is not None and start and end:
            try:
                mask = (market_df['date'] >= pd.to_datetime(start)) & \
                       (market_df['date'] <= pd.to_datetime(end))
                seg = market_df[mask].copy()
                if len(seg) > 0:
                    base = float(seg.iloc[0]['close'])
                    market_data = []
                    for _, row in seg.iterrows():
                        market_data.append({
                            'close': round(float(row['close']), 2),
                            'pct': round((float(row['close']) / base - 1) * 100, 2)
                        })
            except Exception:
                pass

        # 更新场景
        conn.execute(
            "UPDATE scenarios SET sector = ?, market_data = ? WHERE id = ?",
            (sector, json.dumps(market_data) if market_data else None, sid)
        )
        updated += 1
        print(f'  场景#{sid}: {sector} | 大盘{len(market_data) if market_data else 0}天')

    conn.commit()
    conn.close()
    print(f'\n✅ 更新完成，共处理 {updated} 个场景')


if __name__ == '__main__':
    main()
