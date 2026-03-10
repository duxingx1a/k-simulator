"""验证财报数据完整性"""
import sqlite3

conn = sqlite3.connect('game.db')

# 统计每只股票的记录数
rows = conn.execute('''
    SELECT stock_code, COUNT(*), MIN(report_date), MAX(report_date),
           SUM(CASE WHEN roe IS NOT NULL THEN 1 ELSE 0 END),
           SUM(CASE WHEN revenue IS NOT NULL THEN 1 ELSE 0 END)
    FROM financial_data GROUP BY stock_code ORDER BY stock_code
''').fetchall()

print(f"{'代码':<8} {'记录':>4} {'最早':<12} {'最晚':<12} {'ROE':>4} {'营收':>4}")
print("-" * 55)
for r in rows:
    print(f"{r[0]:<8} {r[1]:>4} {r[2]:<12} {r[3]:<12} {r[4]:>4} {r[5]:>4}")
print(f"\n总计 {sum(r[1] for r in rows)} 条记录, {len(rows)} 只股票")

# 示例数据
print("\n=== 万科A 最近3条 ===")
for r in conn.execute(
    "SELECT report_date, eps, roe, gross_margin, net_margin, revenue, net_profit "
    "FROM financial_data WHERE stock_code='000002' ORDER BY report_date DESC LIMIT 3"
).fetchall():
    rev = f"{r[5]/1e8:.1f}亿" if r[5] else "N/A"
    np_ = f"{r[6]/1e8:.1f}亿" if r[6] else "N/A"
    print(f"  {r[0]}  EPS={r[1]}  ROE={r[2]}%  毛利率={r[3]}%  净利率={r[4]}%  营收={rev}  净利={np_}")

conn.close()
