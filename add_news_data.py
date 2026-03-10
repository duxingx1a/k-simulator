"""
新闻/公告数据下载脚本
1. 从 scenarios 获取 75 个场景的 (stock_code, start_date, end_date)
2. 用巨潮公告 API 获取场景时间段内的公告
3. 规则过滤 + AI 润色生成简洁新闻摘要
4. 存入 game.db 的 news_data 表
"""

import sqlite3
import time
import re
import requests
import akshare as ak

DB_PATH = 'game.db'

# AI API 配置
AI_API_URL = 'http://43.248.97.247:14000/v1/chat/completions'
AI_API_KEY = 'sk-CTUFS0fGG7O0feRSR3IiJQ'
AI_MODEL = 'doubao-seed-1-6-flash-250828'

# 需要过滤掉的关键词（这些公告对投资决策价值不大）
FILTER_KEYWORDS = [
    '募集说明书', '信用评级报告', '上市的公告', '付息公告',
    '票面利率调整', '回售实施办法', '回售申报', '提示性公告',
    '证券变动月报表', '跟踪评级', '债券票面利率',
    '簿记建档', '更名公告', '发行结果公告', '信用评级',
    '独立董事提名人声明', '独立董事候选人声明',
    '章程修订对照表', '议事规则修订', '议事规则（',
    '公司章程（', '事前认可意见', '一般性授权',
    '公告标题', '回售提示', '跟踪信用',
]

# 重要公告关键词（优先展示）
IMPORTANT_KEYWORDS = [
    '季度报告', '年度报告', '半年度报告', '业绩预告', '业绩快报',
    '销售', '营业收入', '利润', '分红', '派息', '配股', '增发',
    '股权激励', '回购', '重大合同', '中标', '战略合作',
    '资产收购', '资产重组', '对外投资', '签署',
    '控股股东', '实际控制人', '高管变动', '聘任', '辞职',
    '停牌', '复牌', '风险提示', '立案调查',
    '研发', '专利', '产能', '投产', '新增项目',
]


def create_table(conn):
    """创建 news_data 表"""
    conn.execute('''
        CREATE TABLE IF NOT EXISTS news_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            stock_code TEXT NOT NULL,
            announce_date TEXT NOT NULL,
            title TEXT NOT NULL,
            summary TEXT,
            importance TEXT DEFAULT 'normal',
            url TEXT,
            UNIQUE(stock_code, announce_date, title)
        )
    ''')
    conn.commit()
    print('✓ news_data 表已创建/确认存在')


def get_scenarios(conn):
    """获取所有场景信息"""
    rows = conn.execute(
        'SELECT DISTINCT stock_code, stock_name, start_date, end_date FROM scenarios ORDER BY stock_code, start_date'
    ).fetchall()
    print(f'✓ 共 {len(rows)} 个场景')
    return rows


def should_filter(title):
    """判断该公告是否应被过滤"""
    for kw in FILTER_KEYWORDS:
        if kw in title:
            return True
    return False


def get_importance(title):
    """判断公告重要性"""
    for kw in IMPORTANT_KEYWORDS:
        if kw in title:
            return 'important'
    return 'normal'


def clean_title(title, stock_name):
    """简单清理标题（去掉公司名前缀等）"""
    # 去掉常见前缀如 "万科A:" "万科企业股份有限公司"
    # 公告标题可能的格式：
    #   "关于XXX的公告"
    #   "公司名:关于XXX"
    #   "公司全名关于XXX"
    title = title.strip()
    # 去掉 "代码+名称" 前缀
    patterns = [
        rf'^{re.escape(stock_name)}[：:]?\s*',
        r'^\d{6}\s*',  # 以股票代码开头
        r'^关于\s*',
    ]
    for pat in patterns:
        title = re.sub(pat, '', title)

    # 去掉尾部 "的公告"
    title = re.sub(r'的公告$', '', title)
    title = re.sub(r'公告$', '', title)

    return title.strip()


def ai_summarize_batch(titles_info, stock_name):
    """
    批量用 AI 润色公告标题为简洁新闻
    titles_info: [(title, date), ...]
    返回: {title: summary}
    """
    if not titles_info:
        return {}

    # 构建提示词
    titles_text = '\n'.join([f'{i+1}. [{info[1]}] {info[0]}' for i, info in enumerate(titles_info)])

    prompt = f"""你是一个财经新闻编辑。以下是{stock_name}的上市公告标题列表，请将每个标题改写为简洁的一句话财经新闻（10-25字），直接输出编号和新闻，不要添加额外解释。

{titles_text}

输出格式（每行一条）：
1. 新闻内容
2. 新闻内容
..."""

    try:
        resp = requests.post(
            AI_API_URL,
            headers={'Authorization': f'Bearer {AI_API_KEY}', 'Content-Type': 'application/json'},
            json={
                'model': AI_MODEL,
                'messages': [{'role': 'user', 'content': prompt}],
                'temperature': 0.3,
                'max_tokens': 2000,
            },
            timeout=30,
        )
        data = resp.json()
        content = data['choices'][0]['message']['content'].strip()

        # 解析返回结果
        result = {}
        for line in content.split('\n'):
            line = line.strip()
            if not line:
                continue
            # 匹配格式如 "1. xxxx" 或 "1、xxxx"
            m = re.match(r'^(\d+)[.、]\s*(.+)', line)
            if m:
                idx = int(m.group(1)) - 1
                summary = m.group(2).strip()
                if 0 <= idx < len(titles_info):
                    result[titles_info[idx][0]] = summary
        return result
    except Exception as e:
        print(f'    ✗ AI 润色失败: {e}')
        return {}


def fetch_and_save_news(conn, stock_code, stock_name, start_date, end_date):
    """获取并存储一个场景的公告"""
    # 检查是否已有数据
    existing = conn.execute(
        "SELECT COUNT(*) FROM news_data WHERE stock_code=? AND announce_date>=? AND announce_date<=?",
        (stock_code, start_date, end_date)
    ).fetchone()[0]
    if existing > 0:
        print(f'    ⏭ 已有 {existing} 条, 跳过')
        return 0

    sd = start_date.replace('-', '')
    ed = end_date.replace('-', '')
    df = None
    for attempt in range(3):
        try:
            df = ak.stock_zh_a_disclosure_report_cninfo(
                symbol=stock_code, market='沪深京',
                start_date=sd, end_date=ed
            )
            break
        except Exception as e:
            if attempt < 2:
                print(f'    ✗ 重试 ({attempt+1}/3): {e}')
                time.sleep(3)
            else:
                print(f'    ✗ 获取公告失败(已重试3次): {e}')
                return 0
    if df is None:
        return 0

    if df.empty:
        print(f'    ✗ 无公告数据')
        return 0

    print(f'    原始公告 {len(df)} 条 → ', end='')

    # 过滤
    filtered = []
    for _, row in df.iterrows():
        title = str(row['公告标题'])
        if should_filter(title):
            continue
        date_str = str(row['公告时间'])[:10]
        url = str(row.get('公告链接', ''))
        importance = get_importance(title)
        cleaned = clean_title(title, stock_name)
        filtered.append({
            'date': date_str,
            'title': title,
            'cleaned_title': cleaned,
            'importance': importance,
            'url': url,
        })

    print(f'过滤后 {len(filtered)} 条')

    if not filtered:
        return 0

    # 分批 AI 润色（只对 important 的做）
    important_items = [(item['cleaned_title'], item['date']) for item in filtered if item['importance'] == 'important']
    summaries = {}
    if important_items:
        # 每批最多 15 条
        for i in range(0, len(important_items), 15):
            batch = important_items[i:i+15]
            batch_summaries = ai_summarize_batch(batch, stock_name)
            summaries.update(batch_summaries)
            if i + 15 < len(important_items):
                time.sleep(1)

    # 存储
    count = 0
    for item in filtered:
        summary = summaries.get(item['cleaned_title'], item['cleaned_title'])
        try:
            conn.execute('''
                INSERT OR IGNORE INTO news_data (stock_code, announce_date, title, summary, importance, url)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (stock_code, item['date'], item['title'], summary, item['importance'], item['url']))
            count += 1
        except Exception:
            pass
    conn.commit()
    return count


def main():
    print('=' * 50)
    print('新闻/公告数据下载脚本')
    print('=' * 50)

    conn = sqlite3.connect(DB_PATH)
    create_table(conn)
    scenarios = get_scenarios(conn)

    total = 0
    for i, (code, name, sd, ed) in enumerate(scenarios):
        print(f'\n[{i+1}/{len(scenarios)}] {code} {name} ({sd} ~ {ed})')
        n = fetch_and_save_news(conn, code, name, sd, ed)
        total += n
        print(f'    ✓ 已存储 {n} 条')
        time.sleep(1.5)  # 巨潮 API 间隔

    # 统计
    total_db = conn.execute('SELECT COUNT(*) FROM news_data').fetchone()[0]
    important = conn.execute("SELECT COUNT(*) FROM news_data WHERE importance='important'").fetchone()[0]

    conn.close()
    print(f'\n{"=" * 50}')
    print(f'✓ 全部完成！本次存储 {total} 条, 数据库共 {total_db} 条 (重要:{important})')
    print(f'{"=" * 50}')


if __name__ == '__main__':
    main()
