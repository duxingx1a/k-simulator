"""
用户认证路由：注册/登录
"""
import sqlite3
from flask import Blueprint, jsonify, request
from db import get_db

auth_bp = Blueprint('auth', __name__)


@auth_bp.route('/api/register', methods=['POST'])
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
        conn.execute('INSERT INTO users (nickname) VALUES (?)', (nickname,))
        conn.commit()
        user = conn.execute('SELECT * FROM users WHERE nickname = ?', (nickname,)).fetchone()
        return jsonify({'id': user['id'], 'nickname': user['nickname'], 'is_new': True})
    except sqlite3.IntegrityError:
        user = conn.execute('SELECT * FROM users WHERE nickname = ?', (nickname,)).fetchone()
        return jsonify({'id': user['id'], 'nickname': user['nickname'], 'is_new': False})
    finally:
        conn.close()
