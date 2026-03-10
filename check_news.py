"""检查新闻数据进度"""
import sqlite3

conn = sqlite3.connect('game.db')
total = conn.execute("SELECT COUNT(*) FROM news_data").fetchone()[0]
imp = conn.execute("SELECT COUNT(*) FROM news_data WHERE importance='important'").fetchone()[0]
codes = conn.execute("SELECT DISTINCT stock_code FROM news_data").fetchall()
print(f"已存储 {total} 条 (重要:{imp}), 涉及 {len(codes)} 只股票")
print(f"已有数据: {[r[0] for r in codes]}")

# 场景数据检查
all_sc = conn.execute("SELECT stock_code, start_date, end_date FROM scenarios ORDER BY stock_code, start_date").fetchall()
missing = []
for sc in all_sc:
    cnt = conn.execute(
        "SELECT COUNT(*) FROM news_data WHERE stock_code=? AND announce_date>=? AND announce_date<=?",
        sc
    ).fetchone()[0]
    if cnt == 0:
        missing.append(sc)

print(f"\n缺失场景: {len(missing)}/{len(all_sc)}")
for m in missing:
    print(f"  {m[0]} ({m[1]}~{m[2]})")

# 示例重要新闻
print("\n=== 最新重要新闻5条 ===")
for r in conn.execute(
    "SELECT stock_code, announce_date, summary FROM news_data WHERE importance='important' ORDER BY announce_date DESC LIMIT 5"
).fetchall():
    print(f"  {r[0]} {r[1]}: {r[2][:50]}")

conn.close()
