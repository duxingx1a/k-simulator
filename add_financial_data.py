"""
财报数据下载脚本
从 akshare 获取 25 只股票的历史财务数据，存入 game.db 的 financial_data 表
数据来源：
  1. stock_financial_analysis_indicator — 财务比率指标（ROE/毛利率/净利率等）
  2. stock_financial_abstract — 营收/净利润绝对值
"""

import sqlite3
import time
import akshare as ak
import pandas as pd

DB_PATH = 'game.db'

# 需要从 stock_financial_analysis_indicator 提取的关键字段
RATIO_FIELDS = {
    '日期': 'report_date',
    '摊薄每股收益(元)': 'eps',
    '每股净资产_调整后(元)': 'nav_per_share',
    '净资产收益率(%)': 'roe',
    '加权净资产收益率(%)': 'weighted_roe',
    '销售毛利率(%)': 'gross_margin',
    '销售净利率(%)': 'net_margin',
    '营业利润率(%)': 'operating_margin',
    '主营业务收入增长率(%)': 'revenue_growth',
    '净利润增长率(%)': 'profit_growth',
    '总资产增长率(%)': 'asset_growth',
    '资产负债率(%)': 'asset_liability_ratio',
    '流动比率': 'current_ratio',
    '速动比率': 'quick_ratio',
    '总资产(元)': 'total_assets',
}


def create_table(conn):
    """创建 financial_data 表"""
    conn.execute('''
        CREATE TABLE IF NOT EXISTS financial_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            stock_code TEXT NOT NULL,
            report_date TEXT NOT NULL,
            eps REAL,
            nav_per_share REAL,
            roe REAL,
            weighted_roe REAL,
            gross_margin REAL,
            net_margin REAL,
            operating_margin REAL,
            revenue_growth REAL,
            profit_growth REAL,
            asset_growth REAL,
            asset_liability_ratio REAL,
            current_ratio REAL,
            quick_ratio REAL,
            total_assets REAL,
            revenue REAL,
            net_profit REAL,
            UNIQUE(stock_code, report_date)
        )
    ''')
    conn.commit()
    print('✓ financial_data 表已创建/确认存在')


def get_stock_codes(conn):
    """从 scenarios 表获取不重复的股票代码"""
    rows = conn.execute('SELECT DISTINCT stock_code FROM scenarios ORDER BY stock_code').fetchall()
    codes = [r[0] for r in rows]
    print(f'✓ 共 {len(codes)} 只股票: {", ".join(codes)}')
    return codes


def fetch_ratio_data(stock_code):
    """获取财务比率指标数据"""
    try:
        df = ak.stock_financial_analysis_indicator(symbol=stock_code, start_year='2019')
        # 只保留需要的字段
        available = [col for col in RATIO_FIELDS.keys() if col in df.columns]
        df_sub = df[available].copy()
        # 重命名为英文字段
        rename_map = {k: v for k, v in RATIO_FIELDS.items() if k in available}
        df_sub = df_sub.rename(columns=rename_map)
        df_sub['stock_code'] = stock_code
        return df_sub
    except Exception as e:
        print(f'  ✗ {stock_code} 比率数据获取失败: {e}')
        return None


def fetch_abstract_data(stock_code):
    """从财务摘要获取营收和净利润绝对值"""
    try:
        df = ak.stock_financial_abstract(symbol=stock_code)
        # 提取归母净利润行和营业总收入行
        profit_row = df[df['指标'] == '归母净利润']
        revenue_row = df[df['指标'] == '营业总收入']

        if profit_row.empty and revenue_row.empty:
            print(f'  ✗ {stock_code} 财务摘要无数据')
            return None

        # 获取所有日期列（格式如 '20240331'）
        date_cols = [c for c in df.columns if c not in ['选项', '指标'] and len(c) == 8 and c.isdigit()]

        records = []
        for dc in date_cols:
            # 转换为 yyyy-mm-dd 格式
            rd = f'{dc[:4]}-{dc[4:6]}-{dc[6:8]}'
            # 只保留 2019 年及以后的数据
            if rd < '2019-01-01':
                continue
            revenue = None
            net_profit = None
            if not revenue_row.empty:
                val = revenue_row.iloc[0].get(dc)
                if pd.notna(val):
                    try:
                        revenue = float(val)
                    except (ValueError, TypeError):
                        pass
            if not profit_row.empty:
                val = profit_row.iloc[0].get(dc)
                if pd.notna(val):
                    try:
                        net_profit = float(val)
                    except (ValueError, TypeError):
                        pass
            if revenue is not None or net_profit is not None:
                records.append({
                    'report_date': rd,
                    'revenue': revenue,
                    'net_profit': net_profit,
                })
        return records
    except Exception as e:
        print(f'  ✗ {stock_code} 财务摘要获取失败: {e}')
        return None


def save_data(conn, stock_code, ratio_df, abstract_list):
    """合并比率数据和绝对值数据，写入数据库"""
    # 构建营收/净利润字典（以 report_date 为 key）
    abs_dict = {}
    if abstract_list:
        for item in abstract_list:
            abs_dict[item['report_date']] = item

    count = 0
    if ratio_df is not None and not ratio_df.empty:
        for _, row in ratio_df.iterrows():
            rd = str(row.get('report_date', ''))
            if not rd or rd == 'nan':
                continue
            # 从摘要获取营收/净利润
            abs_item = abs_dict.pop(rd, {})
            try:
                conn.execute('''
                    INSERT OR REPLACE INTO financial_data (
                        stock_code, report_date, eps, nav_per_share, roe, weighted_roe,
                        gross_margin, net_margin, operating_margin, revenue_growth,
                        profit_growth, asset_growth, asset_liability_ratio,
                        current_ratio, quick_ratio, total_assets, revenue, net_profit
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    stock_code, rd,
                    _safe_float(row.get('eps')),
                    _safe_float(row.get('nav_per_share')),
                    _safe_float(row.get('roe')),
                    _safe_float(row.get('weighted_roe')),
                    _safe_float(row.get('gross_margin')),
                    _safe_float(row.get('net_margin')),
                    _safe_float(row.get('operating_margin')),
                    _safe_float(row.get('revenue_growth')),
                    _safe_float(row.get('profit_growth')),
                    _safe_float(row.get('asset_growth')),
                    _safe_float(row.get('asset_liability_ratio')),
                    _safe_float(row.get('current_ratio')),
                    _safe_float(row.get('quick_ratio')),
                    _safe_float(row.get('total_assets')),
                    abs_item.get('revenue'),
                    abs_item.get('net_profit'),
                ))
                count += 1
            except Exception as e:
                print(f'  ✗ 插入 {stock_code} {rd} 失败: {e}')

    # 把没匹配上的摘要数据也插入（只有营收/净利润）
    for rd, item in abs_dict.items():
        try:
            conn.execute('''
                INSERT OR REPLACE INTO financial_data (
                    stock_code, report_date, revenue, net_profit
                ) VALUES (?, ?, ?, ?)
            ''', (stock_code, rd, item.get('revenue'), item.get('net_profit')))
            count += 1
        except Exception as e:
            pass

    conn.commit()
    return count


def _safe_float(val):
    """安全转换为 float"""
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def main():
    print('=' * 50)
    print('财报数据下载脚本')
    print('=' * 50)

    conn = sqlite3.connect(DB_PATH)
    create_table(conn)
    codes = get_stock_codes(conn)

    total = 0
    for i, code in enumerate(codes):
        print(f'\n[{i + 1}/{len(codes)}] 处理 {code} ...')

        # 获取比率数据
        print(f'  → 获取财务比率指标...')
        ratio_df = fetch_ratio_data(code)
        if ratio_df is not None:
            print(f'  ✓ 比率数据 {len(ratio_df)} 条')
        time.sleep(1)  # 避免请求过快

        # 获取营收/净利润
        print(f'  → 获取营收/净利润...')
        abstract_list = fetch_abstract_data(code)
        if abstract_list:
            print(f'  ✓ 摘要数据 {len(abstract_list)} 条')
        time.sleep(1)

        # 合并存储
        n = save_data(conn, code, ratio_df, abstract_list)
        total += n
        print(f'  ✓ 已存储 {n} 条记录')

    conn.close()
    print(f'\n{"=" * 50}')
    print(f'✓ 全部完成！共存储 {total} 条财报记录')
    print(f'{"=" * 50}')


if __name__ == '__main__':
    main()
