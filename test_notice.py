"""测试短范围公告查询"""
import akshare as ak

df = ak.stock_zh_a_disclosure_report_cninfo(
    symbol='000002', market='沪深京',
    start_date='20200408', end_date='20200619'
)
print(f'shape: {df.shape}')
for _, r in df.iterrows():
    t = str(r['公告时间'])[:10]
    title = r['公告标题'][:60]
    print(f'  {t}  {title}')
