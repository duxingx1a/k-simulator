"""
股票K线数据生成器
基于几何布朗运动生成多种走势类型的逼真K线数据，用于模拟交易游戏
"""
import random
import math


class StockDataManager:
    """管理股票K线数据的生成"""

    # 走势模式定义：每种模式可以有多个阶段（drift漂移率, vol波动率, days天数）
    PATTERNS = [
        {
            'name': '价值发现',
            'pattern': 'bull_steady',
            'phases': [{'drift': 0.004, 'vol': 0.022, 'days': 50}]
        },
        {
            'name': '主升浪',
            'pattern': 'bull_strong',
            'phases': [{'drift': 0.009, 'vol': 0.032, 'days': 50}]
        },
        {
            'name': '慢牛行情',
            'pattern': 'bull_slow',
            'phases': [{'drift': 0.003, 'vol': 0.018, 'days': 50}]
        },
        {
            'name': '阴跌不止',
            'pattern': 'bear_slow',
            'phases': [{'drift': -0.003, 'vol': 0.02, 'days': 50}]
        },
        {
            'name': '瀑布下跌',
            'pattern': 'bear_strong',
            'phases': [{'drift': -0.009, 'vol': 0.035, 'days': 50}]
        },
        {
            'name': '绵绵阴跌',
            'pattern': 'bear_grind',
            'phases': [{'drift': -0.004, 'vol': 0.015, 'days': 50}]
        },
        {
            'name': '箱体震荡',
            'pattern': 'sideways',
            'phases': [{'drift': 0.0, 'vol': 0.022, 'days': 50}]
        },
        {
            'name': '过山车',
            'pattern': 'volatile',
            'phases': [{'drift': 0.001, 'vol': 0.045, 'days': 50}]
        },
        {
            'name': 'V型反转',
            'pattern': 'v_recovery',
            'phases': [
                {'drift': -0.008, 'vol': 0.03, 'days': 25},
                {'drift': 0.012, 'vol': 0.035, 'days': 25}
            ]
        },
        {
            'name': '冲高回落',
            'pattern': 'inverted_v',
            'phases': [
                {'drift': 0.008, 'vol': 0.025, 'days': 25},
                {'drift': -0.009, 'vol': 0.03, 'days': 25}
            ]
        },
        {
            'name': '底部蓄力',
            'pattern': 'bottom_consolidation',
            'phases': [
                {'drift': -0.005, 'vol': 0.025, 'days': 15},
                {'drift': 0.0, 'vol': 0.015, 'days': 18},
                {'drift': 0.009, 'vol': 0.03, 'days': 17}
            ]
        },
        {
            'name': '顶部滞涨',
            'pattern': 'top_stall',
            'phases': [
                {'drift': 0.007, 'vol': 0.02, 'days': 18},
                {'drift': 0.001, 'vol': 0.025, 'days': 15},
                {'drift': -0.007, 'vol': 0.032, 'days': 17}
            ]
        },
        {
            'name': '暴涨暴跌',
            'pattern': 'pump_dump',
            'phases': [
                {'drift': 0.015, 'vol': 0.04, 'days': 15},
                {'drift': -0.012, 'vol': 0.045, 'days': 20},
                {'drift': 0.003, 'vol': 0.025, 'days': 15}
            ]
        },
        {
            'name': '震荡上行',
            'pattern': 'choppy_up',
            'phases': [
                {'drift': 0.006, 'vol': 0.035, 'days': 25},
                {'drift': 0.003, 'vol': 0.03, 'days': 25}
            ]
        },
        {
            'name': '假突破',
            'pattern': 'fake_breakout',
            'phases': [
                {'drift': 0.001, 'vol': 0.018, 'days': 20},
                {'drift': 0.012, 'vol': 0.025, 'days': 10},
                {'drift': -0.008, 'vol': 0.035, 'days': 20}
            ]
        },
    ]

    def generate_all_scenarios(self, count_per_pattern=2):
        """生成所有场景数据，每种模式生成多个变体"""
        scenarios = []
        idx = 1
        for pattern in self.PATTERNS:
            for _ in range(count_per_pattern):
                # 随机基础价格（模拟不同价位的股票）
                base_price = round(random.uniform(8, 80), 2)
                data = self._generate_kline(base_price, pattern['phases'])
                scenarios.append({
                    'name': f'{pattern["name"]} #{idx}',
                    'pattern': pattern['pattern'],
                    'data': data
                })
                idx += 1
        return scenarios

    def _generate_kline(self, base_price, phases):
        """根据阶段配置生成逼真的K线数据"""
        data = []
        price = base_price
        base_volume = random.randint(80000, 600000)
        prev_return = 0

        for phase in phases:
            drift = phase['drift']
            vol = phase['vol']
            days = phase['days']

            for d in range(days):
                # 带有自相关的收益率（模拟趋势效应）
                momentum = prev_return * random.uniform(0.1, 0.3)

                # 偶尔出现大波动（模拟重大消息）
                if random.random() < 0.05:
                    shock = random.gauss(0, vol * 2.5)
                else:
                    shock = random.gauss(0, vol)

                daily_return = drift + momentum + shock

                # 限制单日涨跌幅（A股涨跌停±10%）
                daily_return = max(min(daily_return, 0.095), -0.095)

                # 收盘价
                close = price * math.exp(daily_return)

                # 开盘价（前收盘价附近有小跳空）
                gap = random.gauss(0, vol * 0.15)
                open_price = price * (1 + gap)

                # 日内最高最低价
                if close >= open_price:
                    # 阳线：上影线和下影线
                    high = close * (1 + abs(random.gauss(0, vol * 0.35)))
                    low = open_price * (1 - abs(random.gauss(0, vol * 0.4)))
                else:
                    # 阴线
                    high = open_price * (1 + abs(random.gauss(0, vol * 0.35)))
                    low = close * (1 - abs(random.gauss(0, vol * 0.4)))

                # 保证数据合理性
                high = max(high, open_price, close)
                low = min(low, open_price, close)
                low = max(low, 0.01)

                # 成交量与波动正相关
                vol_factor = 1 + abs(daily_return) * 18
                volume = int(base_volume * vol_factor * random.uniform(0.5, 1.5))

                data.append({
                    'open': round(open_price, 2),
                    'high': round(high, 2),
                    'low': round(low, 2),
                    'close': round(close, 2),
                    'volume': volume
                })

                price = close
                prev_return = daily_return

        return data
