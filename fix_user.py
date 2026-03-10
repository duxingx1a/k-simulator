# 修复用户表数据
import sqlite3

c = sqlite3.connect('game.db')
c.execute("INSERT OR REPLACE INTO users (id, nickname) VALUES (1, 'duxingx1a')")
c.commit()
print("用户已修复")
for r in c.execute("SELECT * FROM users").fetchall():
    print(r)

# 验证排行榜查询
c.row_factory = sqlite3.Row
sql = """
SELECT u.nickname, COUNT(g.id) as games_count,
       ROUND(AVG(g.profit_rate), 2) as avg_profit,
       ROUND(MAX(g.profit_rate), 2) as best_profit,
       MAX(g.final_asset) as best_asset
FROM games g JOIN users u ON g.user_id = u.id
WHERE g.status = 'finished'
GROUP BY u.id
ORDER BY avg_profit DESC
"""
rows = c.execute(sql).fetchall()
print(f"\n总排行返回 {len(rows)} 行:")
for r in rows:
    print(dict(r))

c.close()
