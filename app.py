"""
K线大师 - 模拟交易游戏后端
功能：用户注册登录、游戏管理、交易执行、排行榜
"""
from flask import Flask, render_template, jsonify, request
import sqlite3
import json
import os
import re
import random
import secrets
from datetime import date, timedelta
from stock_data import StockDataManager

app = Flask(__name__)
app.secret_key = secrets.token_hex(32)

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'game.db')
stock_manager = StockDataManager()


def get_db():
    """获取数据库连接"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """初始化数据库表和场景数据"""
    conn = get_db()
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nickname TEXT UNIQUE NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS games (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            scenario_id INTEGER NOT NULL,
            current_day INTEGER DEFAULT 0,
            initial_cash REAL DEFAULT 100000,
            cash REAL DEFAULT 100000,
            shares INTEGER DEFAULT 0,
            avg_cost REAL DEFAULT 0,
            status TEXT DEFAULT 'playing',
            profit_rate REAL DEFAULT 0,
            final_asset REAL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS trades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id INTEGER NOT NULL,
            day INTEGER NOT NULL,
            action TEXT NOT NULL,
            price REAL NOT NULL,
            shares INTEGER NOT NULL,
            amount REAL NOT NULL,
            cash_after REAL NOT NULL,
            shares_after INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (game_id) REFERENCES games(id)
        );
        CREATE TABLE IF NOT EXISTS scenarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            stock_code TEXT,
            stock_name TEXT,
            start_date TEXT,
            end_date TEXT,
            name TEXT NOT NULL,
            pattern TEXT NOT NULL DEFAULT '',
            data TEXT NOT NULL
        );
    ''')
    conn.commit()

    # 尝试添加新列（兼容旧数据库）
    for col in ['stock_code TEXT', 'stock_name TEXT', 'start_date TEXT', 'end_date TEXT',
                'sector TEXT', 'market_data TEXT', 'sector_data TEXT']:
        try:
            conn.execute(f'ALTER TABLE scenarios ADD COLUMN {col}')
            conn.commit()
        except Exception:
            pass

    # 检查是否已有场景数据，没有则生成模拟数据
    cursor = conn.execute('SELECT COUNT(*) as cnt FROM scenarios')
    count = cursor.fetchone()['cnt']
    if count == 0:
        print('未找到股票数据，使用模拟数据（运行 python init_data.py 导入真实数据）')
        scenarios = stock_manager.generate_all_scenarios()
        for s in scenarios:
            conn.execute(
                'INSERT INTO scenarios (name, pattern, data) VALUES (?, ?, ?)',
                (s['name'], s['pattern'], json.dumps(s['data']))
            )
        conn.commit()
        print(f'已生成 {len(scenarios)} 个模拟走势场景')

    conn.close()


# ========== 辅助函数：财报+新闻 ==========

def _calc_current_date(start_date_str, end_date_str, current_day):
    """根据游戏进度估算当前对应的真实日期"""
    sd = date.fromisoformat(start_date_str)
    ed = date.fromisoformat(end_date_str)
    total_real = (ed - sd).days
    # K线共50条: 前20条历史 + 30条交易日, current_day 0~30
    progress = min((19 + current_day) / 49, 1.0)
    return sd + timedelta(days=int(progress * total_real))


def _anonymize_text(text, stock_name):
    """匿名化公告内容，隐藏公司名"""
    if not text:
        return text
    # 去掉股票名称及常见变体
    name_variants = [stock_name]
    # 去掉"A"后缀的名称 (如"万科A" → "万科")
    if stock_name.endswith('A'):
        name_variants.append(stock_name[:-1])
    # 加上可能的全称前缀
    for variant in list(name_variants):
        name_variants.extend([
            variant + '股份有限公司',
            variant + '企业股份有限公司',
            variant + '集团股份有限公司',
        ])
    for name in sorted(name_variants, key=len, reverse=True):
        text = text.replace(name, '该公司')
    return text


def get_game_info(conn, stock_code, stock_name, start_date_str, end_date_str, current_day, is_finished=False):
    """获取游戏当前进度下的财报和新闻信息"""
    current_dt = _calc_current_date(start_date_str, end_date_str, current_day)
    current_date_str = current_dt.isoformat()

    # 查询当前日期之前最近的一期财报
    fin_row = conn.execute(
        '''SELECT report_date, eps, roe, weighted_roe, gross_margin, net_margin,
                  operating_margin, revenue_growth, profit_growth, asset_growth,
                  asset_liability_ratio, current_ratio, quick_ratio,
                  total_assets, revenue, net_profit
           FROM financial_data WHERE stock_code=? AND report_date<=?
           ORDER BY report_date DESC LIMIT 1''',
        (stock_code, current_date_str)
    ).fetchone()

    financial_info = None
    if fin_row:
        financial_info = {
            'report_date': fin_row['report_date'],
            'eps': fin_row['eps'],
            'roe': fin_row['roe'],
            'gross_margin': fin_row['gross_margin'],
            'net_margin': fin_row['net_margin'],
            'revenue_growth': fin_row['revenue_growth'],
            'profit_growth': fin_row['profit_growth'],
            'asset_liability_ratio': fin_row['asset_liability_ratio'],
            'revenue': fin_row['revenue'],
            'net_profit': fin_row['net_profit'],
        }

    # 查询场景时段内已发布的新闻（到当前日期为止）
    news_rows = conn.execute(
        '''SELECT announce_date, summary, importance FROM news_data
           WHERE stock_code=? AND announce_date<=? AND announce_date>=?
           ORDER BY announce_date DESC LIMIT 20''',
        (stock_code, current_date_str, start_date_str)
    ).fetchall()

    news_items = []
    for n in news_rows:
        summary = n['summary'] or ''
        if not is_finished:
            summary = _anonymize_text(summary, stock_name)
        news_items.append({
            'date': n['announce_date'],
            'text': summary,
            'importance': n['importance'],
        })

    return {
        'financial_info': financial_info,
        'news_items': news_items,
    }


# ========== 页面路由 ==========

@app.route('/')
def index():
    return render_template('index.html')


# ========== 用户API ==========

@app.route('/api/register', methods=['POST'])
def register():
    """注册或登录（昵称不存在则注册，存在则登录）"""
    data = request.get_json()
    nickname = data.get('nickname', '').strip()

    if not nickname:
        return jsonify({'error': '昵称不能为空'}), 400
    if len(nickname) > 20:
        return jsonify({'error': '昵称不能超过20个字符'}), 400

    conn = get_db()
    try:
        # 尝试注册
        conn.execute('INSERT INTO users (nickname) VALUES (?)', (nickname,))
        conn.commit()
        user = conn.execute('SELECT * FROM users WHERE nickname = ?', (nickname,)).fetchone()
        return jsonify({'id': user['id'], 'nickname': user['nickname'], 'is_new': True})
    except sqlite3.IntegrityError:
        # 昵称已存在，当作登录
        user = conn.execute('SELECT * FROM users WHERE nickname = ?', (nickname,)).fetchone()
        return jsonify({'id': user['id'], 'nickname': user['nickname'], 'is_new': False})
    finally:
        conn.close()


# ========== 游戏API ==========

@app.route('/api/game/new', methods=['POST'])
def new_game():
    """开始新游戏"""
    data = request.get_json()
    user_id = data.get('user_id')

    if not user_id:
        return jsonify({'error': '未登录'}), 401

    conn = get_db()

    # 检查是否有进行中的游戏
    active = conn.execute(
        "SELECT id FROM games WHERE user_id = ? AND status = 'playing'",
        (user_id,)
    ).fetchone()
    if active:
        conn.close()
        return jsonify({'error': '你有一局未完成的游戏', 'game_id': active['id']}), 400

    # 随机选一个场景
    scenarios = conn.execute('SELECT * FROM scenarios').fetchall()
    scenario = random.choice(scenarios)

    # 创建新游戏
    cursor = conn.execute(
        '''INSERT INTO games (user_id, scenario_id, current_day, initial_cash, cash, shares, avg_cost, status)
           VALUES (?, ?, 0, 100000, 100000, 0, 0, 'playing')''',
        (user_id, scenario['id'])
    )
    game_id = cursor.lastrowid
    conn.commit()

    # 返回初始K线数据（前20天作为历史参考）
    kline_data = json.loads(scenario['data'])
    visible = kline_data[:20]

    # 板块和大盘数据
    sector = scenario['sector'] if scenario['sector'] else '未知'
    market_data = json.loads(scenario['market_data']) if scenario['market_data'] else None
    visible_market = market_data[:20] if market_data else None
    sector_data_raw = json.loads(scenario['sector_data']) if scenario['sector_data'] else None
    visible_sector = sector_data_raw[:20] if sector_data_raw else None

    # 财报+新闻
    info = get_game_info(conn, scenario['stock_code'], scenario['stock_name'],
                         scenario['start_date'], scenario['end_date'], 0, False)

    conn.close()

    # 游戏中隐藏真实股票信息，纯盲操作
    return jsonify({
        'game_id': game_id,
        'scenario_name': '神秘股票',
        'scenario_id': scenario['id'],
        'kline_data': visible,
        'current_day': 0,
        'total_trade_days': 30,
        'cash': 100000,
        'shares': 0,
        'avg_cost': 0,
        'initial_cash': 100000,
        'sector': sector,
        'market_data': visible_market,
        'sector_data': visible_sector,
        **info
    })


@app.route('/api/game/state', methods=['POST'])
def game_state():
    """获取当前游戏的完整状态"""
    data = request.get_json()
    game_id = data.get('game_id')

    conn = get_db()
    game = conn.execute('SELECT * FROM games WHERE id = ?', (game_id,)).fetchone()
    if not game:
        conn.close()
        return jsonify({'error': '游戏不存在'}), 404

    scenario = conn.execute('SELECT * FROM scenarios WHERE id = ?', (game['scenario_id'],)).fetchone()
    kline_data = json.loads(scenario['data'])

    # 可见数据 = 前20天历史 + 已推进的交易天数
    visible_count = 20 + game['current_day']
    visible = kline_data[:visible_count]

    # 获取交易记录
    trades = conn.execute(
        'SELECT * FROM trades WHERE game_id = ? ORDER BY day', (game_id,)
    ).fetchall()

    current_price = visible[-1]['close'] if visible else 0
    total_asset = game['cash'] + game['shares'] * current_price
    profit_rate = (total_asset - game['initial_cash']) / game['initial_cash'] * 100

    # 板块和大盘数据
    sector = scenario['sector'] if scenario['sector'] else '未知'
    market_raw = json.loads(scenario['market_data']) if scenario['market_data'] else None
    visible_market_count = 20 + game['current_day']
    visible_market = market_raw[:visible_market_count] if market_raw else None
    sector_data_raw = json.loads(scenario['sector_data']) if scenario['sector_data'] else None
    visible_sector = sector_data_raw[:visible_market_count] if sector_data_raw else None

    is_finished = game['status'] == 'finished'
    # 财报+新闻
    info = get_game_info(conn, scenario['stock_code'], scenario['stock_name'],
                         scenario['start_date'], scenario['end_date'],
                         game['current_day'], is_finished)

    conn.close()

    # 游戏中隐藏真实股票信息
    display_name = '神秘股票' if game['status'] == 'playing' else scenario['name']
    result = {
        'game_id': game_id,
        'scenario_name': display_name,
        'scenario_id': scenario['id'],
        'kline_data': visible,
        'current_day': game['current_day'],
        'total_trade_days': 30,
        'cash': round(game['cash'], 2),
        'shares': game['shares'],
        'avg_cost': round(game['avg_cost'], 2),
        'initial_cash': game['initial_cash'],
        'status': game['status'],
        'current_price': round(current_price, 2),
        'total_asset': round(total_asset, 2),
        'profit_rate': round(profit_rate, 2),
        'trades': [dict(t) for t in trades],
        'sector': sector,
        'market_data': visible_market,
        'sector_data': visible_sector,
        **info
    }
    # 已结束的游戏揭晓真实股票信息
    if game['status'] == 'finished':
        result['stock_code'] = scenario['stock_code']
        result['stock_name'] = scenario['stock_name']
        result['period'] = f"{scenario['start_date'] or ''} ~ {scenario['end_date'] or ''}"
    return jsonify(result)


@app.route('/api/game/next_day', methods=['POST'])
def next_day():
    """推进到下一个交易日"""
    data = request.get_json()
    game_id = data.get('game_id')

    conn = get_db()
    game = conn.execute('SELECT * FROM games WHERE id = ?', (game_id,)).fetchone()

    if not game:
        conn.close()
        return jsonify({'error': '游戏不存在'}), 404
    if game['status'] != 'playing':
        conn.close()
        return jsonify({'error': '游戏已结束'}), 400

    new_day = game['current_day'] + 1

    scenario = conn.execute('SELECT * FROM scenarios WHERE id = ?', (game['scenario_id'],)).fetchone()
    kline_data = json.loads(scenario['data'])

    if new_day > 30:
        # 游戏结束：计算最终资产（以最后一天收盘价计算持仓价值）
        visible_count = 20 + game['current_day']
        visible = kline_data[:visible_count]
        final_price = visible[-1]['close']

        total_asset = game['cash'] + game['shares'] * final_price
        profit_rate = (total_asset - game['initial_cash']) / game['initial_cash'] * 100

        conn.execute(
            '''UPDATE games SET status = 'finished', profit_rate = ?, final_asset = ?
               WHERE id = ?''',
            (round(profit_rate, 2), round(total_asset, 2), game_id)
        )
        conn.commit()

        # 板块和大盘数据
        sector = scenario['sector'] if scenario['sector'] else '未知'
        market_raw = json.loads(scenario['market_data']) if scenario['market_data'] else None
        sector_data_raw = json.loads(scenario['sector_data']) if scenario['sector_data'] else None

        # 财报+新闻（结束时显示完整信息）
        info = get_game_info(conn, scenario['stock_code'], scenario['stock_name'],
                             scenario['start_date'], scenario['end_date'],
                             game['current_day'], True)

        conn.close()

        # 游戏结束，揭晓真实股票信息
        return jsonify({
            'status': 'finished',
            'kline_data': visible,
            'current_day': game['current_day'],
            'cash': round(game['cash'], 2),
            'shares': game['shares'],
            'profit_rate': round(profit_rate, 2),
            'final_asset': round(total_asset, 2),
            'scenario_name': scenario['name'],
            'scenario_id': scenario['id'],
            'initial_cash': game['initial_cash'],
            'stock_code': scenario['stock_code'],
            'stock_name': scenario['stock_name'],
            'period': f"{scenario['start_date'] or ''} ~ {scenario['end_date'] or ''}",
            'sector': sector,
            'market_data': market_raw,
            'sector_data': sector_data_raw,
            **info
        })

    # 正常推进
    conn.execute('UPDATE games SET current_day = ? WHERE id = ?', (new_day, game_id))
    conn.commit()

    visible_count = 20 + new_day
    visible = kline_data[:visible_count]
    current_price = visible[-1]['close']
    total_asset = game['cash'] + game['shares'] * current_price
    profit_rate = (total_asset - game['initial_cash']) / game['initial_cash'] * 100

    # 板块和大盘数据
    sector = scenario['sector'] if scenario['sector'] else '未知'
    market_raw = json.loads(scenario['market_data']) if scenario['market_data'] else None
    visible_market = market_raw[:visible_count] if market_raw else None
    sector_data_raw = json.loads(scenario['sector_data']) if scenario['sector_data'] else None
    visible_sector = sector_data_raw[:visible_count] if sector_data_raw else None

    # 财报+新闻（游戏中匿名化）
    info = get_game_info(conn, scenario['stock_code'], scenario['stock_name'],
                         scenario['start_date'], scenario['end_date'],
                         new_day, False)

    conn.close()

    # 游戏中隐藏真实股票信息
    return jsonify({
        'status': 'playing',
        'kline_data': visible,
        'current_day': new_day,
        'remaining_days': 30 - new_day,
        'cash': round(game['cash'], 2),
        'shares': game['shares'],
        'avg_cost': round(game['avg_cost'], 2),
        'current_price': round(current_price, 2),
        'total_asset': round(total_asset, 2),
        'profit_rate': round(profit_rate, 2),
        'scenario_name': '神秘股票',
        'scenario_id': scenario['id'],
        'initial_cash': game['initial_cash'],
        'sector': sector,
        'market_data': visible_market,
        'sector_data': visible_sector,
        **info
    })


@app.route('/api/game/trade', methods=['POST'])
def trade():
    """执行买入或卖出交易"""
    data = request.get_json()
    game_id = data.get('game_id')
    action = data.get('action')  # 'buy' 或 'sell'
    percentage = data.get('percentage', 100)  # 仓位比例

    conn = get_db()
    game = conn.execute('SELECT * FROM games WHERE id = ?', (game_id,)).fetchone()

    if not game:
        conn.close()
        return jsonify({'error': '游戏不存在'}), 404
    if game['status'] != 'playing':
        conn.close()
        return jsonify({'error': '游戏已结束'}), 400
    if game['current_day'] == 0:
        conn.close()
        return jsonify({'error': '请先点击"开始交易"进入第一个交易日'}), 400

    # 获取当前收盘价
    scenario = conn.execute('SELECT * FROM scenarios WHERE id = ?', (game['scenario_id'],)).fetchone()
    kline_data = json.loads(scenario['data'])
    visible_count = 20 + game['current_day']
    current_price = kline_data[visible_count - 1]['close']

    cash = game['cash']
    shares = game['shares']
    avg_cost = game['avg_cost']

    if action == 'buy':
        # 买入
        available_cash = cash * (percentage / 100)
        buy_shares = int(available_cash / current_price)
        if buy_shares <= 0:
            conn.close()
            return jsonify({'error': '资金不足，无法买入'}), 400

        cost = round(buy_shares * current_price, 2)

        # 更新平均持仓成本
        if shares > 0:
            avg_cost = round((avg_cost * shares + cost) / (shares + buy_shares), 2)
        else:
            avg_cost = current_price

        cash = round(cash - cost, 2)
        shares += buy_shares

        conn.execute(
            '''INSERT INTO trades (game_id, day, action, price, shares, amount, cash_after, shares_after)
               VALUES (?, ?, '买入', ?, ?, ?, ?, ?)''',
            (game_id, game['current_day'], current_price, buy_shares, cost, cash, shares)
        )
        traded_shares = buy_shares
        traded_amount = cost

    elif action == 'sell':
        # 卖出
        sell_shares = int(shares * (percentage / 100))
        if sell_shares <= 0:
            conn.close()
            return jsonify({'error': '没有持仓可卖出'}), 400

        revenue = round(sell_shares * current_price, 2)
        cash = round(cash + revenue, 2)
        shares -= sell_shares

        conn.execute(
            '''INSERT INTO trades (game_id, day, action, price, shares, amount, cash_after, shares_after)
               VALUES (?, ?, '卖出', ?, ?, ?, ?, ?)''',
            (game_id, game['current_day'], current_price, sell_shares, revenue, cash, shares)
        )
        traded_shares = sell_shares
        traded_amount = revenue

    else:
        conn.close()
        return jsonify({'error': '无效操作'}), 400

    # 更新游戏状态
    total_asset = cash + shares * current_price
    profit_rate = (total_asset - game['initial_cash']) / game['initial_cash'] * 100

    conn.execute(
        'UPDATE games SET cash = ?, shares = ?, avg_cost = ? WHERE id = ?',
        (cash, shares, avg_cost, game_id)
    )
    conn.commit()
    conn.close()

    return jsonify({
        'success': True,
        'action': '买入' if action == 'buy' else '卖出',
        'price': current_price,
        'shares_traded': traded_shares,
        'amount': traded_amount,
        'cash': cash,
        'shares': shares,
        'avg_cost': round(avg_cost, 2),
        'total_asset': round(total_asset, 2),
        'profit_rate': round(profit_rate, 2)
    })


@app.route('/api/game/active', methods=['POST'])
def active_game():
    """检查用户是否有进行中的游戏"""
    data = request.get_json()
    user_id = data.get('user_id')

    conn = get_db()
    game = conn.execute(
        "SELECT id FROM games WHERE user_id = ? AND status = 'playing'",
        (user_id,)
    ).fetchone()
    conn.close()

    if game:
        return jsonify({'game_id': game['id']})
    return jsonify({'game_id': None})


@app.route('/api/game/abandon', methods=['POST'])
def abandon_game():
    """放弃当前游戏"""
    data = request.get_json()
    game_id = data.get('game_id')

    conn = get_db()
    game = conn.execute('SELECT * FROM games WHERE id = ?', (game_id,)).fetchone()
    if game and game['status'] == 'playing':
        conn.execute("UPDATE games SET status = 'abandoned' WHERE id = ?", (game_id,))
        conn.commit()
    conn.close()

    return jsonify({'success': True})


# ========== 排行榜API ==========

@app.route('/api/rank/scenario/<int:scenario_id>')
def scenario_rank(scenario_id):
    """获取特定场景的排行榜（同股PK榜）"""
    conn = get_db()
    results = conn.execute('''
        SELECT g.id, g.profit_rate, g.final_asset, g.created_at,
               u.nickname, g.scenario_id
        FROM games g
        JOIN users u ON g.user_id = u.id
        WHERE g.scenario_id = ? AND g.status = 'finished'
        ORDER BY g.profit_rate DESC
        LIMIT 50
    ''', (scenario_id,)).fetchall()
    conn.close()

    # 隐藏真实股票名
    return jsonify([{
        **dict(r),
        'scenario_name': f'神秘股票 #{r["scenario_id"]}'
    } for r in results])


@app.route('/api/rank/total')
def total_rank():
    """总排行榜（按平均收益率排名）"""
    conn = get_db()
    results = conn.execute('''
        SELECT u.id as user_id, u.nickname,
               COUNT(g.id) as game_count,
               ROUND(AVG(g.profit_rate), 2) as avg_profit_rate,
               ROUND(MAX(g.profit_rate), 2) as best_profit_rate,
               ROUND(MIN(g.profit_rate), 2) as worst_profit_rate,
               ROUND(SUM(g.final_asset - g.initial_cash), 2) as total_profit
        FROM games g
        JOIN users u ON g.user_id = u.id
        WHERE g.status = 'finished'
        GROUP BY u.id
        HAVING game_count >= 1
        ORDER BY avg_profit_rate DESC
        LIMIT 50
    ''').fetchall()
    conn.close()

    return jsonify([dict(r) for r in results])


@app.route('/api/rank/recent')
def recent_rank():
    """近期排行（最近的单局排名）"""
    conn = get_db()
    results = conn.execute('''
        SELECT g.id, g.profit_rate, g.final_asset, g.initial_cash,
               g.created_at, u.nickname, g.scenario_id
        FROM games g
        JOIN users u ON g.user_id = u.id
        WHERE g.status = 'finished'
        ORDER BY g.created_at DESC
        LIMIT 50
    ''').fetchall()
    conn.close()

    # 隐藏真实股票名，用“神秘股票 #N”代替
    return jsonify([{
        **dict(r),
        'scenario_name': f'神秘股票 #{r["scenario_id"]}'
    } for r in results])


# ========== 用户历史 ==========

@app.route('/api/user/history', methods=['POST'])
def user_history():
    """获取用户的游戏历史"""
    data = request.get_json()
    user_id = data.get('user_id')

    conn = get_db()
    results = conn.execute('''
        SELECT g.id, g.scenario_id, g.profit_rate, g.final_asset,
               g.initial_cash, g.status, g.created_at
        FROM games g
        WHERE g.user_id = ?
        ORDER BY g.created_at DESC
        LIMIT 30
    ''', (user_id,)).fetchall()
    conn.close()

    # 隐藏真实股票名
    return jsonify([{
        **dict(r),
        'scenario_name': f'神秘股票 #{r["scenario_id"]}'
    } for r in results])


@app.route('/api/user/stats', methods=['POST'])
def user_stats():
    """获取用户统计数据"""
    data = request.get_json()
    user_id = data.get('user_id')

    conn = get_db()
    stats = conn.execute('''
        SELECT COUNT(*) as game_count,
               COALESCE(ROUND(AVG(profit_rate), 2), 0) as avg_profit,
               COALESCE(ROUND(MAX(profit_rate), 2), 0) as best_profit,
               COALESCE(ROUND(MIN(profit_rate), 2), 0) as worst_profit
        FROM games
        WHERE user_id = ? AND status = 'finished'
    ''', (user_id,)).fetchone()
    conn.close()

    return jsonify(dict(stats))


@app.route('/api/user/profile/<int:user_id>')
def user_profile(user_id):
    """查看其他用户的公开资料（统计 + 历史战绩）"""
    conn = get_db()

    # 用户信息
    user = conn.execute('SELECT id, nickname FROM users WHERE id = ?', (user_id,)).fetchone()
    if not user:
        conn.close()
        return jsonify({'error': '用户不存在'}), 404

    # 统计
    stats = conn.execute('''
        SELECT COUNT(*) as game_count,
               COALESCE(ROUND(AVG(profit_rate), 2), 0) as avg_profit,
               COALESCE(ROUND(MAX(profit_rate), 2), 0) as best_profit,
               COALESCE(ROUND(MIN(profit_rate), 2), 0) as worst_profit
        FROM games WHERE user_id = ? AND status = 'finished'
    ''', (user_id,)).fetchone()

    # 最近战绩
    games = conn.execute('''
        SELECT g.scenario_id, g.profit_rate, g.created_at, g.status
        FROM games g WHERE g.user_id = ? AND g.status = 'finished'
        ORDER BY g.created_at DESC LIMIT 30
    ''', (user_id,)).fetchall()
    conn.close()

    return jsonify({
        'nickname': user['nickname'],
        'stats': dict(stats),
        'games': [dict(g) for g in games]
    })


@app.route('/api/rank/scenarios')
def scenario_list():
    """获取所有场景的排行数据（同股PK列表）"""
    conn = get_db()
    results = conn.execute('''
        SELECT s.id, s.sector,
               COUNT(g.id) as play_count,
               COALESCE(ROUND(MAX(g.profit_rate), 2), 0) as best_profit,
               COALESCE(ROUND(AVG(g.profit_rate), 2), 0) as avg_profit
        FROM scenarios s
        LEFT JOIN games g ON g.scenario_id = s.id AND g.status = 'finished'
        GROUP BY s.id
        ORDER BY play_count DESC, s.id ASC
    ''').fetchall()
    conn.close()

    return jsonify([dict(r) for r in results])


@app.route('/api/game/challenge', methods=['POST'])
def challenge_game():
    """挑战同一只股票（PK同股）"""
    data = request.get_json()
    user_id = data.get('user_id')
    scenario_id = data.get('scenario_id')

    if not user_id or not scenario_id:
        return jsonify({'error': '参数错误'}), 400

    conn = get_db()

    # 检查是否有进行中的游戏
    active = conn.execute(
        "SELECT id FROM games WHERE user_id = ? AND status = 'playing'",
        (user_id,)
    ).fetchone()
    if active:
        conn.close()
        return jsonify({'error': '你有一局未完成的游戏', 'game_id': active['id']}), 400

    scenario = conn.execute('SELECT * FROM scenarios WHERE id = ?', (scenario_id,)).fetchone()
    if not scenario:
        conn.close()
        return jsonify({'error': '场景不存在'}), 404

    cursor = conn.execute(
        '''INSERT INTO games (user_id, scenario_id, current_day, initial_cash, cash, shares, avg_cost, status)
           VALUES (?, ?, 0, 100000, 100000, 0, 0, 'playing')''',
        (user_id, scenario_id)
    )
    game_id = cursor.lastrowid
    conn.commit()

    kline_data = json.loads(scenario['data'])
    visible = kline_data[:20]

    market_raw = json.loads(scenario['market_data']) if scenario['market_data'] else None
    visible_market = market_raw[:20] if market_raw else None
    sector_raw = json.loads(scenario['sector_data']) if scenario['sector_data'] else None
    visible_sector = sector_raw[:20] if sector_raw else None

    conn.close()

    return jsonify({
        'game_id': game_id,
        'scenario_name': '神秘股票',
        'scenario_id': scenario['id'],
        'kline_data': visible,
        'current_day': 0,
        'total_trade_days': 30,
        'cash': 100000,
        'shares': 0,
        'avg_cost': 0,
        'initial_cash': 100000,
        'sector': scenario['sector'] if 'sector' in scenario.keys() else '',
        'market_data': visible_market,
        'sector_data': visible_sector
    })


@app.route('/api/game/detail/<int:game_id>', methods=['GET'])
def game_detail(game_id):
    """获取已完成游戏的完整信息（用于历史战绩详情页）"""
    conn = get_db()

    game = conn.execute('''
        SELECT g.*, s.data, s.stock_code, s.stock_name, s.start_date, s.end_date,
               s.sector, s.market_data, s.sector_data
        FROM games g
        JOIN scenarios s ON g.scenario_id = s.id
        WHERE g.id = ?
    ''', (game_id,)).fetchone()

    if not game:
        conn.close()
        return jsonify({'error': '游戏不存在'}), 404

    trades = conn.execute(
        'SELECT day, action, price, shares, amount FROM trades WHERE game_id = ? ORDER BY id',
        (game_id,)
    ).fetchall()
    conn.close()

    kline_data = json.loads(game['data'])
    market_data = json.loads(game['market_data']) if game['market_data'] else None
    sector_data = json.loads(game['sector_data']) if game['sector_data'] else None

    # 计算最终资产
    final_asset = game['cash'] + game['shares'] * kline_data[-1]['close'] if game['status'] == 'finished' else None
    profit_rate = ((final_asset - game['initial_cash']) / game['initial_cash'] * 100) if final_asset else None

    return jsonify({
        'game_id': game['id'],
        'scenario_id': game['scenario_id'],
        'stock_code': game['stock_code'],
        'stock_name': game['stock_name'],
        'sector': game['sector'] or '',
        'period': f"{game['start_date']} ~ {game['end_date']}",
        'status': game['status'],
        'kline_data': kline_data,
        'market_data': market_data,
        'sector_data': sector_data,
        'initial_cash': game['initial_cash'],
        'final_asset': final_asset,
        'profit_rate': profit_rate,
        'trades': [dict(t) for t in trades]
    })


@app.route('/api/game/detail_multi', methods=['POST'])
def game_detail_multi():
    """获取同一场景下多个用户的交易记录（用于PK对比）"""
    data = request.get_json()
    scenario_id = data.get('scenario_id')
    if not scenario_id:
        return jsonify({'error': '参数错误'}), 400

    conn = get_db()
    games = conn.execute('''
        SELECT g.id, g.user_id, u.nickname,
               g.cash, g.shares, g.initial_cash, g.status
        FROM games g
        JOIN users u ON g.user_id = u.id
        WHERE g.scenario_id = ? AND g.status = 'finished'
        ORDER BY g.id DESC
        LIMIT 20
    ''', (scenario_id,)).fetchall()

    result = []
    for game in games:
        trades = conn.execute(
            'SELECT day, action, price, shares FROM trades WHERE game_id = ? ORDER BY id',
            (game['id'],)
        ).fetchall()
        # 获取场景数据来计算收益率
        scenario = conn.execute('SELECT data FROM scenarios WHERE id = ?', (scenario_id,)).fetchone()
        kline_data = json.loads(scenario['data'])
        final_price = kline_data[-1]['close']
        final_asset = game['cash'] + game['shares'] * final_price
        profit_rate = (final_asset - game['initial_cash']) / game['initial_cash'] * 100

        result.append({
            'game_id': game['id'],
            'nickname': game['nickname'],
            'profit_rate': round(profit_rate, 2),
            'trades': [dict(t) for t in trades]
        })

    conn.close()
    return jsonify(result)


# 启动时初始化
init_db()

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
