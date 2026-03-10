"""检查 K 线数据与真实日期的映射关系"""
import sqlite3, json
import akshare as ak

conn = sqlite3.connect('game.db')
s = conn.execute('SELECT stock_code, stock_name, start_date, end_date, data FROM scenarios LIMIT 1').fetchone()
d = json.loads(s[4])

print(f"股票: {s[0]} {s[1]}")
print(f"start_date={s[2]}, end_date={s[3]}")
print(f"K线数据条数: {len(d)} (前20天=历史, 后30天=交易)")

# 看看 start_date 和 end_date 之间有多少交易日
sd = s[2].replace("-", "")
ed = s[3].replace("-", "")
df = ak.stock_zh_a_hist(symbol=s[0], period='daily', start_date=sd, end_date=ed, adjust='qfq')
print(f"\nakshare 从 {s[2]} 到 {s[3]} 的数据: {len(df)} 条")
print(f"日期列: {df.columns[0]}")
print(f"前3条: {df.iloc[:3, 0].tolist()}")
print(f"后3条: {df.iloc[-3:, 0].tolist()}")

# start_date 对应 kline_data 的第几条?
# 看 K 线第一条的价格和 akshare 的比较
print(f"\nK线第1条 close={d[0]['close']}")
print(f"K线第20条 close={d[19]['close']}")
print(f"K线第21条 close={d[20]['close']}")

conn.close()
