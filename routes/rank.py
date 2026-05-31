"""
排行榜和用户资料路由
"""
from flask import Blueprint, jsonify, request
from db import get_db, get_db_with_stock

rank_bp = Blueprint('rank', __name__, url_prefix='/api')


@rank_bp.route('/rank/scenario/<int:scenario_id>')
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

    return jsonify([{
        **dict(r),
        'scenario_name': f'神秘股票 #{r["scenario_id"]}'
    } for r in results])


@rank_bp.route('/rank/total')
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


@rank_bp.route('/rank/recent')
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

    return jsonify([{
        **dict(r),
        'scenario_name': f'神秘股票 #{r["scenario_id"]}'
    } for r in results])


@rank_bp.route('/user/history', methods=['POST'])
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

    return jsonify([{
        **dict(r),
        'scenario_name': f'神秘股票 #{r["scenario_id"]}'
    } for r in results])


@rank_bp.route('/user/stats', methods=['POST'])
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


@rank_bp.route('/user/profile/<int:user_id>')
def user_profile(user_id):
    """查看其他用户的公开资料（统计 + 历史战绩）"""
    conn = get_db()

    user = conn.execute('SELECT id, nickname FROM users WHERE id = ?', (user_id,)).fetchone()
    if not user:
        conn.close()
        return jsonify({'error': '用户不存在'}), 404

    stats = conn.execute('''
        SELECT COUNT(*) as game_count,
               COALESCE(ROUND(AVG(profit_rate), 2), 0) as avg_profit,
               COALESCE(ROUND(MAX(profit_rate), 2), 0) as best_profit,
               COALESCE(ROUND(MIN(profit_rate), 2), 0) as worst_profit
        FROM games WHERE user_id = ? AND status = 'finished'
    ''', (user_id,)).fetchone()

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


@rank_bp.route('/rank/scenarios')
def scenario_list():
    """获取所有场景的排行数据（同股PK列表）
    使用 ATTACH 跨库 JOIN scenarios（stock_data.db）和 games（game.db）
    """
    conn = get_db_with_stock()
    results = conn.execute('''
        SELECT s.id, s.sector,
               COUNT(g.id) as play_count,
               COALESCE(ROUND(MAX(g.profit_rate), 2), 0) as best_profit,
               COALESCE(ROUND(AVG(g.profit_rate), 2), 0) as avg_profit
        FROM stock_db.scenarios s
        LEFT JOIN games g ON g.scenario_id = s.id AND g.status = 'finished'
        GROUP BY s.id
        ORDER BY play_count DESC, s.id ASC
    ''').fetchall()
    conn.close()

    return jsonify([dict(r) for r in results])
