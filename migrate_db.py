"""
数据库迁移脚本：将 game.db 中的 scenarios 表迁移到 stock_data.db
运行一次即可。不会影响现有用户数据。
"""
import sqlite3
import os
import shutil

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
GAME_DB = os.path.join(BASE_DIR, 'game.db')
STOCK_DB = os.path.join(BASE_DIR, 'stock_data.db')


def migrate():
    # 检查 game.db 是否存在
    if not os.path.exists(GAME_DB):
        print('未找到 game.db，无需迁移')
        return

    # 备份 game.db
    backup = GAME_DB + '.bak'
    shutil.copy2(GAME_DB, backup)
    print(f'✓ 已备份 game.db → game.db.bak')

    src = sqlite3.connect(GAME_DB)
    src.row_factory = sqlite3.Row

    # 检查 scenarios 表是否存在
    table_exists = src.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='scenarios'"
    ).fetchone()
    if not table_exists:
        print('game.db 中没有 scenarios 表，跳过迁移')
        src.close()
        return

    # 读取 scenarios 表结构和数据
    col_info = src.execute("PRAGMA table_info(scenarios)").fetchall()
    col_names = [c[1] for c in col_info]
    scenarios = src.execute('SELECT * FROM scenarios').fetchall()
    print(f'✓ 读取到 {len(scenarios)} 条 scenarios 数据')

    # 创建 stock_data.db 并建表（含所有字段）
    dst = sqlite3.connect(STOCK_DB)
    dst.executescript('''
        CREATE TABLE IF NOT EXISTS scenarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            stock_code TEXT,
            stock_name TEXT,
            start_date TEXT,
            end_date TEXT,
            name TEXT NOT NULL,
            pattern TEXT NOT NULL DEFAULT '',
            data TEXT NOT NULL,
            sector TEXT,
            market_data TEXT,
            sector_data TEXT
        );
    ''')

    existing = dst.execute('SELECT COUNT(*) FROM scenarios').fetchone()[0]
    if existing > 0:
        print(f'stock_data.db 中已有 {existing} 条数据，清空后重新写入...')
        dst.execute('DELETE FROM scenarios')
        dst.execute("DELETE FROM sqlite_sequence WHERE name='scenarios'")
        dst.commit()

    # 写入数据
    dst_cols = ['stock_code', 'stock_name', 'start_date', 'end_date',
                'name', 'pattern', 'data', 'sector', 'market_data', 'sector_data']
    placeholders = ','.join(['?'] * len(dst_cols))
    for row in scenarios:
        values = [row[c] if c in col_names else None for c in dst_cols]
        dst.execute(
            f'INSERT INTO scenarios ({",".join(dst_cols)}) VALUES ({placeholders})',
            values
        )
    dst.commit()
    print(f'✓ 已迁移 {len(scenarios)} 条数据到 stock_data.db')

    # 验证行数
    src_count = len(scenarios)
    dst_count = dst.execute('SELECT COUNT(*) FROM scenarios').fetchone()[0]
    if src_count != dst_count:
        print(f'⚠ 迁移验证失败！源:{src_count} 目标:{dst_count}')
        dst.close()
        src.close()
        return
    print(f'✓ 验证通过：scenarios 行数一致 ({dst_count})')
    dst.close()

    # 清理 game.db 中的旧表
    for table in ['scenarios', 'financial_data', 'news_data']:
        src.execute(f'DROP TABLE IF EXISTS {table}')
    src.commit()
    src.close()
    print('✓ 已从 game.db 中删除 scenarios/financial_data/news_data 表')
    print()
    print('迁移完成！现在 stock_data.db 含股票数据，game.db 仅含用户数据。')


if __name__ == '__main__':
    migrate()
