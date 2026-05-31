"""
游戏相关路由：新建/状态/推进/交易/放弃/挑战/详情
"""
import json
from flask import Blueprint, jsonify, request
from db import get_db, get_stock_db, get_db_with_stock

game_bp = Blueprint('game', __name__, url_prefix='/api/game')


@game_bp.route('/new', methods=['POST'])
def new_game():
    """开始新游戏"""
    data = request.get_json()
    user_id = data.get('user_id')

    if not user_id:
        return jsonify({'error': '未登录'}), 401

    conn = get_db()
    active = conn.execute(
        "SELECT id FROM games WHERE user_id = ? AND status = 'playing'",
        (user_id,)
    ).fetchone()
    if active:
        conn.close()
        return jsonify({'error': '你有一局未完成的游戏', 'game_id': active['id']}), 400

    stock_conn = get_stock_db()
    scenario = stock_conn.execute('SELECT * FROM scenarios ORDER BY RANDOM() LIMIT 1').fetchone()
    stock_conn.close()

    cursor = conn.execute(
        '''INSERT INTO games (user_id, scenario_id, current_day, initial_cash, cash, shares, avg_cost, status)
           VALUES (?, ?, 0, 100000, 100000, 0, 0, 'playing')''',
        (user_id, scenario['id'])
    )
    game_id = cursor.lastrowid
    conn.commit()
    conn.close()

    kline_data = json.loads(scenario['data'])
    visible = kline_data[:20]
    sector = scenario['sector'] if scenario['sector'] else '未知'
    market_data = json.loads(scenario['market_data']) if scenario['market_data'] else None
    visible_market = market_data[:20] if market_data else None
    sector_data_raw = json.loads(scenario['sector_data']) if scenario['sector_data'] else None
    visible_sector = sector_data_raw[:20] if sector_data_raw else None

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
    })


@game_bp.route('/state', methods=['POST'])
def game_state():
    """获取当前游戏的完整状态"""
    data = request.get_json()
    game_id = data.get('game_id')
    user_id = data.get('user_id')

    conn = get_db()
    game = conn.execute('SELECT * FROM games WHERE id = ?', (game_id,)).fetchone()
    if not game:
        conn.close()
        return jsonify({'error': '游戏不存在'}), 404
    if user_id is not None and game['user_id'] != user_id:
        conn.close()
        return jsonify({'error': '无权访问此游戏'}), 403

    stock_conn = get_stock_db()
    scenario = stock_conn.execute(
        'SELECT * FROM scenarios WHERE id = ?', (game['scenario_id'],)
    ).fetchone()
    stock_conn.close()

    kline_data = json.loads(scenario['data'])
    visible_count = 20 + game['current_day']
    visible = kline_data[:visible_count]

    trades = conn.execute(
        'SELECT * FROM trades WHERE game_id = ? ORDER BY day', (game_id,)
    ).fetchall()
    conn.close()

    current_price = visible[-1]['close'] if visible else 0
    total_asset = game['cash'] + game['shares'] * current_price
    profit_rate = (total_asset - game['initial_cash']) / game['initial_cash'] * 100

    sector = scenario['sector'] if scenario['sector'] else '未知'
    market_raw = json.loads(scenario['market_data']) if scenario['market_data'] else None
    visible_market = market_raw[:visible_count] if market_raw else None
    sector_data_raw = json.loads(scenario['sector_data']) if scenario['sector_data'] else None
    visible_sector = sector_data_raw[:visible_count] if sector_data_raw else None

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
    }
    if game['status'] == 'finished':
        result['stock_code'] = scenario['stock_code']
        result['stock_name'] = scenario['stock_name']
        result['period'] = f"{scenario['start_date'] or ''} ~ {scenario['end_date'] or ''}"
    return jsonify(result)


@game_bp.route('/next_day', methods=['POST'])
def next_day():
    """推进到下一个交易日"""
    data = request.get_json()
    game_id = data.get('game_id')
    user_id = data.get('user_id')

    conn = get_db()
    game = conn.execute('SELECT * FROM games WHERE id = ?', (game_id,)).fetchone()
    if not game:
        conn.close()
        return jsonify({'error': '游戏不存在'}), 404
    if user_id is not None and game['user_id'] != user_id:
        conn.close()
        return jsonify({'error': '无权访问此游戏'}), 403
    if game['status'] != 'playing':
        conn.close()
        return jsonify({'error': '游戏已结束'}), 400

    new_day = game['current_day'] + 1

    stock_conn = get_stock_db()
    scenario = stock_conn.execute(
        'SELECT * FROM scenarios WHERE id = ?', (game['scenario_id'],)
    ).fetchone()
    stock_conn.close()

    kline_data = json.loads(scenario['data'])

    if new_day > 30:
        visible_count = 20 + game['current_day']
        visible = kline_data[:visible_count]
        final_price = visible[-1]['close']
        total_asset = game['cash'] + game['shares'] * final_price
        profit_rate = (total_asset - game['initial_cash']) / game['initial_cash'] * 100

        conn.execute(
            "UPDATE games SET status = 'finished', profit_rate = ?, final_asset = ? WHERE id = ?",
            (round(profit_rate, 2), round(total_asset, 2), game_id)
        )
        conn.commit()
        conn.close()

        sector = scenario['sector'] if scenario['sector'] else '未知'
        market_raw = json.loads(scenario['market_data']) if scenario['market_data'] else None
        sector_data_raw = json.loads(scenario['sector_data']) if scenario['sector_data'] else None

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
        })

    conn.execute('UPDATE games SET current_day = ? WHERE id = ?', (new_day, game_id))
    conn.commit()
    conn.close()

    visible_count = 20 + new_day
    visible = kline_data[:visible_count]
    current_price = visible[-1]['close']
    total_asset = game['cash'] + game['shares'] * current_price
    profit_rate = (total_asset - game['initial_cash']) / game['initial_cash'] * 100

    sector = scenario['sector'] if scenario['sector'] else '未知'
    market_raw = json.loads(scenario['market_data']) if scenario['market_data'] else None
    visible_market = market_raw[:visible_count] if market_raw else None
    sector_data_raw = json.loads(scenario['sector_data']) if scenario['sector_data'] else None
    visible_sector = sector_data_raw[:visible_count] if sector_data_raw else None

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
    })


@game_bp.route('/trade', methods=['POST'])
def trade():
    """执行买入或卖出交易"""
    data = request.get_json()
    game_id = data.get('game_id')
    user_id = data.get('user_id')
    action = data.get('action')
    percentage = data.get('percentage', 100)

    try:
        percentage = int(percentage)
    except (TypeError, ValueError):
        return jsonify({'error': '仓位比例无效'}), 400
    if percentage < 1 or percentage > 100:
        return jsonify({'error': '仓位比例必须在1~100之间'}), 400

    conn = get_db()
    game = conn.execute('SELECT * FROM games WHERE id = ?', (game_id,)).fetchone()
    if not game:
        conn.close()
        return jsonify({'error': '游戏不存在'}), 404
    if user_id is not None and game['user_id'] != user_id:
        conn.close()
        return jsonify({'error': '无权访问此游戏'}), 403
    if game['status'] != 'playing':
        conn.close()
        return jsonify({'error': '游戏已结束'}), 400
    if game['current_day'] == 0:
        conn.close()
        return jsonify({'error': '请先点击"开始交易"进入第一个交易日'}), 400

    stock_conn = get_stock_db()
    scenario = stock_conn.execute(
        'SELECT data FROM scenarios WHERE id = ?', (game['scenario_id'],)
    ).fetchone()
    stock_conn.close()

    kline_data = json.loads(scenario['data'])
    visible_count = 20 + game['current_day']
    current_price = kline_data[visible_count - 1]['close']

    cash = game['cash']
    shares = game['shares']
    avg_cost = game['avg_cost']

    if action == 'buy':
        available_cash = cash * (percentage / 100)
        buy_shares = int(available_cash / current_price)
        if buy_shares <= 0:
            conn.close()
            return jsonify({'error': '资金不足，无法买入'}), 400

        cost = round(buy_shares * current_price, 2)
        if shares > 0:
            avg_cost = round((avg_cost * shares + cost) / (shares + buy_shares), 2)
        else:
            avg_cost = current_price

        cash = round(cash - cost, 2)
        shares += buy_shares

        conn.execute(
            "INSERT INTO trades (game_id, day, action, price, shares, amount, cash_after, shares_after)"
            " VALUES (?, ?, '买入', ?, ?, ?, ?, ?)",
            (game_id, game['current_day'], current_price, buy_shares, cost, cash, shares)
        )
        traded_shares = buy_shares
        traded_amount = cost

    elif action == 'sell':
        sell_shares = int(shares * (percentage / 100))
        if sell_shares <= 0:
            conn.close()
            return jsonify({'error': '没有持仓可卖出'}), 400

        revenue = round(sell_shares * current_price, 2)
        cash = round(cash + revenue, 2)
        shares -= sell_shares

        conn.execute(
            "INSERT INTO trades (game_id, day, action, price, shares, amount, cash_after, shares_after)"
            " VALUES (?, ?, '卖出', ?, ?, ?, ?, ?)",
            (game_id, game['current_day'], current_price, sell_shares, revenue, cash, shares)
        )
        traded_shares = sell_shares
        traded_amount = revenue

    else:
        conn.close()
        return jsonify({'error': '无效操作'}), 400

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


@game_bp.route('/active', methods=['POST'])
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


@game_bp.route('/abandon', methods=['POST'])
def abandon_game():
    """放弃当前游戏"""
    data = request.get_json()
    game_id = data.get('game_id')
    user_id = data.get('user_id')

    conn = get_db()
    game = conn.execute('SELECT * FROM games WHERE id = ?', (game_id,)).fetchone()
    if game:
        if user_id is not None and game['user_id'] != user_id:
            conn.close()
            return jsonify({'error': '无权操作此游戏'}), 403
        if game['status'] == 'playing':
            conn.execute("UPDATE games SET status = 'abandoned' WHERE id = ?", (game_id,))
            conn.commit()
    conn.close()
    return jsonify({'success': True})


@game_bp.route('/challenge', methods=['POST'])
def challenge_game():
    """挑战同一只股票（PK同股）"""
    data = request.get_json()
    user_id = data.get('user_id')
    scenario_id = data.get('scenario_id')

    if not user_id or not scenario_id:
        return jsonify({'error': '参数错误'}), 400

    conn = get_db()
    active = conn.execute(
        "SELECT id FROM games WHERE user_id = ? AND status = 'playing'",
        (user_id,)
    ).fetchone()
    if active:
        conn.close()
        return jsonify({'error': '你有一局未完成的游戏', 'game_id': active['id']}), 400

    stock_conn = get_stock_db()
    scenario = stock_conn.execute(
        'SELECT * FROM scenarios WHERE id = ?', (scenario_id,)
    ).fetchone()
    stock_conn.close()

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
    conn.close()

    kline_data = json.loads(scenario['data'])
    visible = kline_data[:20]
    market_raw = json.loads(scenario['market_data']) if scenario['market_data'] else None
    visible_market = market_raw[:20] if market_raw else None
    sector_raw = json.loads(scenario['sector_data']) if scenario['sector_data'] else None
    visible_sector = sector_raw[:20] if sector_raw else None

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
        'sector_data': visible_sector,
    })


@game_bp.route('/detail/<int:game_id>', methods=['GET'])
def game_detail(game_id):
    """获取已完成游戏的完整信息（用于历史战绩详情页）"""
    # 使用 ATTACH 跨库 JOIN
    conn = get_db_with_stock()
    game = conn.execute('''
        SELECT g.*, s.data, s.stock_code, s.stock_name, s.start_date, s.end_date,
               s.sector, s.market_data, s.sector_data
        FROM games g
        JOIN stock_db.scenarios s ON g.scenario_id = s.id
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


@game_bp.route('/detail_multi', methods=['POST'])
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

    stock_conn = get_stock_db()
    scenario = stock_conn.execute(
        'SELECT data FROM scenarios WHERE id = ?', (scenario_id,)
    ).fetchone()
    stock_conn.close()

    result = []
    for game in games:
        trades = conn.execute(
            'SELECT day, action, price, shares FROM trades WHERE game_id = ? ORDER BY id',
            (game['id'],)
        ).fetchall()
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
