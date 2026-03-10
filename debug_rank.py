import sqlite3

c = sqlite3.connect('game.db')
c.row_factory = sqlite3.Row

print("=== 用户 ===")
for u in c.execute("SELECT * FROM users").fetchall():
    print(dict(u))

print("\n=== 游戏 ===")
for g in c.execute("SELECT id, user_id, status, profit_rate, final_asset, scenario_id FROM games").fetchall():
    print(dict(g))

print("\n=== 总排行 SQL ===")
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
print(f"总排行返回 {len(rows)} 行:")
for r in rows:
    print(dict(r))

print("\n=== 最近排行 SQL ===")
sql2 = """
SELECT u.nickname, g.scenario_id, g.profit_rate, g.final_asset,
       g.id as game_id
FROM games g JOIN users u ON g.user_id = u.id
WHERE g.status = 'finished'
ORDER BY g.id DESC LIMIT 20
"""
rows2 = c.execute(sql2).fetchall()
print(f"最近排行返回 {len(rows2)} 行:")
for r in rows2:
    print(dict(r))

c.close()
