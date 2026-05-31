/**
 * K线大师 - 前端应用逻辑
 * 管理视图切换、API调用、ECharts图表渲染、游戏流程
 */

// ========== 全局状态 ==========
const state = {
    user: null,           // { id, nickname }
    gameId: null,         // 当前游戏ID
    scenarioId: null,     // 当前场景ID
    scenarioName: '',     // 场景名称
    klineData: [],        // K线数据
    currentDay: 0,        // 当前交易日（0=未开始）
    cash: 100000,         // 可用资金
    shares: 0,            // 持仓股数
    avgCost: 0,           // 平均成本
    initialCash: 100000,  // 初始资金
    chartMode: 'kline',    // 图表模式：'kline' | 'line' | 'both'
    subChart: 'vol',       // 副图模式：'vol' | 'macd' | 'kdj' | 'trix'
    chart: null,          // ECharts实例
    marketData: null,     // 上证指数走势数据
    sectorData: null,     // 板块指数走势数据
    sector: '',           // 板块名称
    legendSelected: {},   // 图例选中状态（持久化）
    tradeAction: null,    // 当前交易操作
    tradePct: 100,        // 交易比例
    trades: [],           // 当前游戏的交易记录 [{day, action, price, shares}]
    historyDetailMode: false, // 是否在历史战绩详情页
};

// ========== 工具函数 ==========

/** 格式化金额 */
function formatMoney(n) {
    return '¥' + Number(n).toLocaleString('zh-CN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

/** 格式化百分比 */
function formatPercent(n) {
    const sign = n > 0 ? '+' : '';
    return sign + n.toFixed(2) + '%';
}

/** 显示Toast提示 */
function showToast(msg, duration = 1500) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), duration);
}

/** API请求封装 */
async function api(url, data = null) {
    const opts = {
        headers: { 'Content-Type': 'application/json' }
    };
    if (data !== null) {
        opts.method = 'POST';
        opts.body = JSON.stringify(data);
    }
    const res = await fetch(url, opts);
    const json = await res.json();
    if (!res.ok) {
        throw new Error(json.error || '请求失败');
    }
    return json;
}

/** 计算移动平均线 */
function calcMA(closes, period) {
    const result = [];
    for (let i = 0; i < closes.length; i++) {
        if (i < period - 1) {
            result.push(null);
        } else {
            let sum = 0;
            for (let j = 0; j < period; j++) {
                sum += closes[i - j];
            }
            result.push(+(sum / period).toFixed(2));
        }
    }
    return result;
}

/** 计算EMA（指数移动平均线） */
function calcEMA(data, period) {
    const result = [];
    const k = 2 / (period + 1);
    for (let i = 0; i < data.length; i++) {
        if (data[i] === null || data[i] === undefined) { result.push(null); continue; }
        if (i === 0 || result[i - 1] === null) {
            result.push(data[i]);
        } else {
            result.push(+(data[i] * k + result[i - 1] * (1 - k)).toFixed(4));
        }
    }
    return result;
}

/** 计算MACD（DIF, DEA, MACD柱） */
function calcMACD(closes, short_p = 12, long_p = 26, signal_p = 9) {
    const ema12 = calcEMA(closes, short_p);
    const ema26 = calcEMA(closes, long_p);
    const dif = [];
    for (let i = 0; i < closes.length; i++) {
        if (ema12[i] === null || ema26[i] === null) { dif.push(null); continue; }
        dif.push(+(ema12[i] - ema26[i]).toFixed(4));
    }
    const dea = calcEMA(dif, signal_p);
    const macd = [];
    for (let i = 0; i < closes.length; i++) {
        if (dif[i] === null || dea[i] === null) { macd.push(null); continue; }
        macd.push(+((dif[i] - dea[i]) * 2).toFixed(4));
    }
    return { dif, dea, macd };
}

/** 计算KDJ */
function calcKDJ(klineData, period = 9) {
    const len = klineData.length;
    const k = [], d = [], j = [];
    let prevK = 50, prevD = 50;
    for (let i = 0; i < len; i++) {
        const start = Math.max(0, i - period + 1);
        let highest = -Infinity, lowest = Infinity;
        for (let n = start; n <= i; n++) {
            if (klineData[n].high > highest) highest = klineData[n].high;
            if (klineData[n].low < lowest) lowest = klineData[n].low;
        }
        const rsv = highest === lowest ? 50 : (klineData[i].close - lowest) / (highest - lowest) * 100;
        const curK = +(2 / 3 * prevK + 1 / 3 * rsv).toFixed(2);
        const curD = +(2 / 3 * prevD + 1 / 3 * curK).toFixed(2);
        const curJ = +(3 * curK - 2 * curD).toFixed(2);
        k.push(curK); d.push(curD); j.push(curJ);
        prevK = curK; prevD = curD;
    }
    return { k, d, j };
}

/** 计算布林带（BOLL） */
function calcBOLL(closes, period = 20, mult = 2) {
    const upper = [], mid = [], lower = [];
    for (let i = 0; i < closes.length; i++) {
        if (i < period - 1) { upper.push(null); mid.push(null); lower.push(null); continue; }
        let sum = 0;
        for (let n = 0; n < period; n++) sum += closes[i - n];
        const ma = sum / period;
        let variance = 0;
        for (let n = 0; n < period; n++) variance += Math.pow(closes[i - n] - ma, 2);
        const std = Math.sqrt(variance / period);
        mid.push(+ma.toFixed(2));
        upper.push(+(ma + mult * std).toFixed(2));
        lower.push(+(ma - mult * std).toFixed(2));
    }
    return { upper, mid, lower };
}

/** 计算TRIX */
function calcTRIX(closes, period = 12, signal_p = 20) {
    const ema1 = calcEMA(closes, period);
    const ema2 = calcEMA(ema1, period);
    const ema3 = calcEMA(ema2, period);
    const trix = [];
    for (let i = 0; i < closes.length; i++) {
        if (i === 0 || ema3[i] === null || ema3[i - 1] === null || ema3[i - 1] === 0) {
            trix.push(null); continue;
        }
        trix.push(+((ema3[i] - ema3[i - 1]) / ema3[i - 1] * 100).toFixed(4));
    }
    const matrix = calcMA(trix.map(v => v === null ? 0 : v), signal_p);
    return { trix, matrix };
}

// ========== 视图管理 ==========

function showView(viewId) {
    document.querySelectorAll('.view').forEach(v => {
        v.classList.remove('active');
    });
    const target = document.getElementById(viewId);
    if (target) {
        target.classList.add('active');
    }
}

// ========== 历史用户管理 ==========

/** 获取最近登录的用户列表（最多5个） */
function getRecentUsers() {
    try {
        return JSON.parse(localStorage.getItem('kmaster_recent_users') || '[]');
    } catch (e) {
        return [];
    }
}

/** 登录成功后将用户存入历史列表（去重+置顶，最多5个） */
function saveRecentUser(user) {
    const list = getRecentUsers().filter(u => u.id !== user.id);
    list.unshift({ id: user.id, nickname: user.nickname });
    localStorage.setItem('kmaster_recent_users', JSON.stringify(list.slice(0, 5)));
    // 同时保留单用户字段，兼容现有逻辑
    localStorage.setItem('kmaster_user', JSON.stringify(user));
}

/** 渲染登录页历史用户卡片 */
function renderRecentUsers() {
    const list = getRecentUsers();
    const section = document.getElementById('recent-users-section');
    const container = document.getElementById('recent-users-list');
    if (!section || !container) return;
    if (list.length === 0) { section.style.display = 'none'; return; }

    const avatars = ['🐉', '🦁', '🐯', '🦊', '🐺', '🦅', '🐻', '🦋'];
    container.innerHTML = list.map((u, i) => `
        <div class="recent-user-card" onclick="quickLogin('${u.nickname.replace(/'/g, "\\'")}')">
            <div class="recent-user-avatar">${avatars[i % avatars.length]}</div>
            <div class="recent-user-info">
                <div class="recent-user-name">${escapeHtml(u.nickname)}</div>
                <div class="recent-user-hint">点击一键进入</div>
            </div>
            <div class="recent-user-arrow">›</div>
        </div>
    `).join('');
    section.style.display = 'block';
}

/** 一键快速登录 */
async function quickLogin(nickname) {
    try {
        const res = await api('/api/register', { nickname });
        state.user = { id: res.id, nickname: res.nickname };
        saveRecentUser(state.user);
        showToast('欢迎回来，' + res.nickname + '！');
        enterLobby();
        history.replaceState({ view: 'view-lobby' }, '');
    } catch (e) {
        showToast(e.message);
    }
}

// ========== 登录逻辑 ==========

async function handleLogin() {
    const input = document.getElementById('nickname-input');
    const nickname = input.value.trim();
    if (!nickname) {
        showToast('请输入昵称');
        return;
    }

    try {
        const res = await api('/api/register', { nickname });
        state.user = { id: res.id, nickname: res.nickname };

        // 保存到历史用户列表
        saveRecentUser(state.user);

        showToast(res.is_new ? '注册成功！' : '欢迎回来！');
        enterLobby();
        history.replaceState({ view: 'view-lobby' }, '');
    } catch (e) {
        showToast(e.message);
    }
}

/** 进入大厅 */
async function enterLobby() {
    document.getElementById('lobby-nickname').textContent = state.user.nickname;
    showView('view-lobby');

    // 加载统计数据
    try {
        const stats = await api('/api/user/stats', { user_id: state.user.id });
        document.getElementById('stat-games').textContent = stats.game_count;
        document.getElementById('stat-avg-profit').textContent = formatPercent(stats.avg_profit);
        document.getElementById('stat-best').textContent = formatPercent(stats.best_profit);

        // 设置颜色
        setValueColor('stat-avg-profit', stats.avg_profit);
        setValueColor('stat-best', stats.best_profit);
    } catch (e) {
        console.error('加载统计数据失败:', e);
    }

    // 检查是否有进行中的游戏
    try {
        const active = await api('/api/game/active', { user_id: state.user.id });
        if (active.game_id) {
            showToast('你有一局未完成的游戏');
            await resumeGame(active.game_id);
        }
    } catch (e) {
        console.error(e);
    }
}

function setValueColor(elId, value) {
    const el = document.getElementById(elId);
    el.style.color = value > 0 ? 'var(--rise)' : value < 0 ? 'var(--fall)' : 'var(--text-muted)';
}

// ========== 游戏逻辑 ==========

/** 开始新游戏 */
async function startNewGame() {
    try {
        const res = await api('/api/game/new', { user_id: state.user.id });
        // 更新状态
        state.gameId = res.game_id;
        state.scenarioId = res.scenario_id;
        state.scenarioName = res.scenario_name;
        state.klineData = res.kline_data;
        state.currentDay = 0;
        state.cash = res.cash;
        state.shares = 0;
        state.avgCost = 0;
        state.initialCash = res.initial_cash;
        state.sector = res.sector || '';
        state.marketData = res.market_data || null;
        state.sectorData = res.sector_data || null;
        state.legendSelected = {};
        state.trades = [];

        showView('view-game');
        initChart();
        updateGameUI();
        showToast('分析历史走势，准备好了点击"开始交易"');
    } catch (e) {
        if (e.message.includes('未完成')) {
            // 有未完成的游戏，尝试恢复
            const res = JSON.parse(e.message.match(/\{.*\}/)?.[0] || '{}');
            if (res.game_id) {
                await resumeGame(res.game_id);
            }
        } else {
            showToast(e.message);
        }
    }
}

/** 恢复进行中的游戏 */
async function resumeGame(gameId) {
    try {
        const res = await api('/api/game/state', { game_id: gameId, user_id: state.user?.id });
        state.gameId = res.game_id;
        state.scenarioId = res.scenario_id;
        state.scenarioName = res.scenario_name;
        state.klineData = res.kline_data;
        state.currentDay = res.current_day;
        state.cash = res.cash;
        state.shares = res.shares;
        state.avgCost = res.avg_cost;
        state.initialCash = res.initial_cash;
        state.sector = res.sector || '';
        state.marketData = res.market_data || null;
        state.sectorData = res.sector_data || null;
        state.legendSelected = {};
        // 恢复已有交易记录
        state.trades = (res.trades || []).map(t => ({
            day: t.day,
            action: t.action === '买入' ? 'buy' : 'sell',
            price: t.price,
            shares: t.shares
        }));

        showView('view-game');
        initChart();
        updateGameUI();
    } catch (e) {
        showToast(e.message);
    }
}

/** 推进到下一天 */
async function handleNextDay() {
    try {
        const res = await api('/api/game/next_day', { game_id: state.gameId, user_id: state.user?.id });

        if (res.status === 'finished') {
            // 游戏结束
            state.klineData = res.kline_data;
            updateChart();
            showGameResult(res);
            return;
        }

        // 更新状态
        state.klineData = res.kline_data;
        state.currentDay = res.current_day;
        state.cash = res.cash;
        state.shares = res.shares;
        state.scenarioName = res.scenario_name;
        state.marketData = res.market_data || null;
        state.sectorData = res.sector_data || null;

        updateChart();
        updateGameUI();
    } catch (e) {
        showToast(e.message);
    }
}

/** 更新游戏界面信息 */
function updateGameUI() {
    // 场景名和天数
    document.getElementById('game-scenario-name').textContent = state.scenarioName;
    document.getElementById('game-day').textContent = state.currentDay;

    // 板块标签
    const sectorEl = document.getElementById('game-sector');
    if (state.sector && state.sector !== '未知') {
        sectorEl.textContent = state.sector;
        sectorEl.style.display = 'inline-block';
    } else {
        sectorEl.style.display = 'none';
    }

    // 当前价格
    const currentPrice = state.klineData.length > 0
        ? state.klineData[state.klineData.length - 1].close : 0;

    document.getElementById('info-price').textContent = '¥' + currentPrice.toFixed(2);
    document.getElementById('info-cash').textContent = formatMoney(state.cash);
    document.getElementById('info-shares').textContent = state.shares + ' 股';

    const totalAsset = state.cash + state.shares * currentPrice;
    document.getElementById('info-total').textContent = formatMoney(totalAsset);

    const profitRate = ((totalAsset - state.initialCash) / state.initialCash * 100);
    const profitEl = document.getElementById('info-profit');
    profitEl.textContent = formatPercent(profitRate);
    profitEl.className = 'profit-value mono ' + (
        profitRate > 0 ? 'profit-positive' : profitRate < 0 ? 'profit-negative' : 'profit-zero'
    );

    // 按钮状态
    const canTrade = state.currentDay > 0;
    document.getElementById('btn-buy').disabled = !canTrade;
    document.getElementById('btn-sell').disabled = !canTrade || state.shares === 0;

    // 下一天按钮文案
    const nextBtn = document.getElementById('btn-next-day');
    if (state.currentDay === 0) {
        nextBtn.textContent = '开始交易 →';
    } else if (state.currentDay >= 30) {
        nextBtn.textContent = '结算 →';
    } else {
        nextBtn.textContent = `下一天 → (剩余${30 - state.currentDay}天)`;
    }

    // 价格涨跌颜色
    if (state.klineData.length >= 2) {
        const prev = state.klineData[state.klineData.length - 2].close;
        const curr = currentPrice;
        const priceEl = document.getElementById('info-price');
        priceEl.style.color = curr > prev ? 'var(--rise)' : curr < prev ? 'var(--fall)' : 'var(--text-primary)';
    }
}

/** 显示游戏结算 */
function showGameResult(data) {
    showView('view-result');
    history.replaceState({ view: 'view-result' }, '');

    const profitRate = data.profit_rate;
    const pnl = data.final_asset - data.initial_cash;

    document.getElementById('result-scenario').textContent = data.scenario_name || '神秘股票';

    const profitEl = document.getElementById('result-profit');
    profitEl.textContent = formatPercent(profitRate);
    profitEl.style.color = profitRate > 0 ? 'var(--rise)' : profitRate < 0 ? 'var(--fall)' : 'var(--text-muted)';

    // 评级
    let grade = '';
    if (profitRate >= 20) grade = '🏆 股神级别！';
    else if (profitRate >= 10) grade = '🥇 优秀操盘手';
    else if (profitRate >= 5) grade = '👍 不错的收益';
    else if (profitRate >= 0) grade = '😊 小有盈利';
    else if (profitRate >= -5) grade = '😅 略有亏损';
    else if (profitRate >= -10) grade = '😰 需要反思';
    else grade = '💸 重大失误';
    document.getElementById('result-grade').textContent = grade;

    document.getElementById('result-final').textContent = formatMoney(data.final_asset);
    const pnlEl = document.getElementById('result-pnl');
    pnlEl.textContent = (pnl >= 0 ? '+' : '') + formatMoney(pnl).replace('¥', '¥');
    pnlEl.style.color = pnl > 0 ? 'var(--rise)' : pnl < 0 ? 'var(--fall)' : 'var(--text-muted)';

    // 揭晓真实股票信息
    const revealCard = document.getElementById('reveal-card');
    if (data.stock_name && data.stock_code) {
        document.getElementById('reveal-name').textContent = data.stock_name;
        document.getElementById('reveal-code').textContent = data.stock_code;
        document.getElementById('reveal-sector').textContent = data.sector || '---';
        document.getElementById('reveal-period').textContent = data.period || '---';

        // 计算同期上证指数收益率
        const marketEl = document.getElementById('reveal-market');
        if (data.market_data && data.market_data.length >= 2) {
            const mFirst = data.market_data[0].close;
            const mLast = data.market_data[data.market_data.length - 1].close;
            const mReturn = ((mLast / mFirst - 1) * 100).toFixed(2);
            const prefix = mReturn >= 0 ? '+' : '';
            marketEl.textContent = prefix + mReturn + '%';
            marketEl.style.color = mReturn > 0 ? 'var(--rise)' : mReturn < 0 ? 'var(--fall)' : 'var(--text-muted)';
        } else {
            marketEl.textContent = '---';
            marketEl.style.color = '';
        }

        revealCard.style.display = 'block';
    } else {
        // 模拟数据，不显示揭晓卡片
        revealCard.style.display = 'none';
    }

    // 保存场景ID用于排行查看
    state.scenarioId = data.scenario_id;
}

// ========== 交易弹窗 ==========

function showTradeModal(action) {
    state.tradeAction = action;
    state.tradePct = 100;

    const modal = document.getElementById('trade-modal');
    const title = document.getElementById('modal-title');
    const confirmBtn = document.getElementById('btn-modal-confirm');
    const availLabel = document.getElementById('modal-available-label');

    const currentPrice = state.klineData[state.klineData.length - 1].close;
    document.getElementById('modal-price').textContent = '¥' + currentPrice.toFixed(2);

    if (action === 'buy') {
        title.textContent = '买入';
        title.className = 'modal-title buy';
        confirmBtn.textContent = '确认买入';
        confirmBtn.className = 'btn-modal-confirm buy';
        availLabel.textContent = '可用资金';
        document.getElementById('modal-available').textContent = formatMoney(state.cash);
    } else {
        title.textContent = '卖出';
        title.className = 'modal-title sell';
        confirmBtn.textContent = '确认卖出';
        confirmBtn.className = 'btn-modal-confirm sell';
        availLabel.textContent = '可卖股数';
        document.getElementById('modal-available').textContent = state.shares + ' 股';
    }

    // 重置百分比按钮
    document.querySelectorAll('.pct-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.pct === '100');
    });

    updateTradePreview();
    modal.classList.add('show');
}

function hideTradeModal() {
    document.getElementById('trade-modal').classList.remove('show');
}

function updateTradePreview() {
    const currentPrice = state.klineData[state.klineData.length - 1].close;
    const pct = state.tradePct;

    if (state.tradeAction === 'buy') {
        const availCash = state.cash * (pct / 100);
        const shares = Math.floor(availCash / currentPrice);
        const cost = +(shares * currentPrice).toFixed(2);
        document.getElementById('modal-preview-text').textContent = `预计买入 ${shares} 股`;
        document.getElementById('modal-preview-amount').textContent = `花费 ${formatMoney(cost)}`;
    } else {
        const sellShares = Math.floor(state.shares * (pct / 100));
        const revenue = +(sellShares * currentPrice).toFixed(2);
        document.getElementById('modal-preview-text').textContent = `预计卖出 ${sellShares} 股`;
        document.getElementById('modal-preview-amount').textContent = `获得 ${formatMoney(revenue)}`;
    }
}

async function executeTrade() {
    try {
        const res = await api('/api/game/trade', {
            game_id: state.gameId,
            user_id: state.user?.id,
            action: state.tradeAction,
            percentage: state.tradePct
        });

        // 更新状态
        state.cash = res.cash;
        state.shares = res.shares;
        state.avgCost = res.avg_cost;

        // 记录交易到本地列表
        state.trades.push({
            day: state.currentDay,
            action: state.tradeAction,
            price: res.price,
            shares: res.shares_traded
        });

        hideTradeModal();
        updateGameUI();
        updateChart(); // 刷新图表以显示买卖标记
        showToast(`${res.action} ${res.shares_traded} 股，单价 ¥${res.price.toFixed(2)}`);
    } catch (e) {
        showToast(e.message);
    }
}

// ========== 图表渲染 ==========

/** 同步模式按钮状态与state.chartMode一致 */
function syncModeButtons() {
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === state.chartMode);
    });
    document.querySelectorAll('.sub-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.sub === (state.subChart || 'vol'));
    });
}

function initChart() {
    const container = document.getElementById('main-chart');
    if (state.chart) {
        state.chart.dispose();
    }

    // 设置容器尺寸
    const wrapper = container.parentElement;
    container.style.height = wrapper.clientHeight + 'px';

    state.chart = echarts.init(container, null, { renderer: 'canvas' });
    syncModeButtons();
    updateChart();

    // 监听窗口大小变化
    window.addEventListener('resize', () => {
        if (state.chart) {
            container.style.height = wrapper.clientHeight + 'px';
            state.chart.resize();
        }
    });
}

function updateChart() {
    if (!state.chart || !state.klineData.length) return;

    // 保存当前图例选中状态（防止刷新时重置）
    const currentOption = state.chart.getOption();
    if (currentOption && currentOption.legend && currentOption.legend[0] && currentOption.legend[0].selected) {
        Object.assign(state.legendSelected, currentOption.legend[0].selected);
    }

    const data = state.klineData;
    const dayLabels = data.map((_, i) => `${i + 1}`);
    const closes = data.map(d => d.close);
    const firstClose = closes[0]; // 第一天收盘价，用于归一化

    // OHLC数据（ECharts格式：[open, close, low, high]）
    const ohlcData = data.map(d => [d.open, d.close, d.low, d.high]);

    // 成交量数据
    const volumes = data.map((d, i) => ({
        value: d.volume,
        itemStyle: {
            color: d.close >= d.open
                ? 'rgba(239, 68, 68, 0.45)'
                : 'rgba(34, 197, 94, 0.45)'
        }
    }));

    // 计算MA
    const ma5 = calcMA(closes, 5);
    const ma10 = calcMA(closes, 10);
    const ma20 = calcMA(closes, 20);

    const isKline = state.chartMode === 'kline' || state.chartMode === 'both';
    const isLine = state.chartMode === 'line' || state.chartMode === 'both';

    // 构建系列
    const series = [];
    const legendData = [];

    // K线系列
    if (isKline) {
        legendData.push('K线');
        series.push({
            name: 'K线',
            type: 'candlestick',
            data: ohlcData,
            xAxisIndex: 0,
            yAxisIndex: 0,
            itemStyle: {
                color: '#f04444',
                color0: '#1ec870',
                borderColor: '#f04444',
                borderColor0: '#1ec870',
                borderWidth: 1
            },
            barWidth: state.klineData.length > 35 ? '50%' : '60%'
        });
    }

    // 收盘价趋势线
    if (isLine) {
        legendData.push('收盘价');
        series.push({
            name: '收盘价',
            type: 'line',
            data: closes,
            xAxisIndex: 0,
            yAxisIndex: 0,
            smooth: 0.3,
            symbol: 'none',
            itemStyle: { color: '#fbbf24' },
            lineStyle: {
                color: '#fbbf24',
                width: isKline ? 1.5 : 2.5,
                opacity: isKline ? 0.5 : 1
            },
            areaStyle: !isKline ? {
                color: {
                    type: 'linear',
                    x: 0, y: 0, x2: 0, y2: 1,
                    colorStops: [
                        { offset: 0, color: 'rgba(251, 191, 36, 0.25)' },
                        { offset: 1, color: 'rgba(251, 191, 36, 0.02)' }
                    ]
                }
            } : null,
            z: isKline ? 1 : 5
        });
    }

    // MA线（均线）
    legendData.push('MA5', 'MA10', 'MA20');
    series.push(
        {
            name: 'MA5',
            type: 'line',
            data: ma5,
            xAxisIndex: 0,
            yAxisIndex: 0,
            smooth: true,
            symbol: 'none',
            itemStyle: { color: '#f59e0b' },
            lineStyle: { color: '#f59e0b', width: 1, opacity: 0.8 },
            z: 2
        },
        {
            name: 'MA10',
            type: 'line',
            data: ma10,
            xAxisIndex: 0,
            yAxisIndex: 0,
            smooth: true,
            symbol: 'none',
            itemStyle: { color: '#4890f8' },
            lineStyle: { color: '#4890f8', width: 1, opacity: 0.8 },
            z: 2
        },
        {
            name: 'MA20',
            type: 'line',
            data: ma20,
            xAxisIndex: 0,
            yAxisIndex: 0,
            smooth: true,
            symbol: 'none',
            itemStyle: { color: '#a060f0' },
            lineStyle: { color: '#a060f0', width: 1, opacity: 0.8 },
            z: 2
        }
    );

    // 上证指数叠加线（归一化到股价尺度，虚线）
    if (state.marketData && state.marketData.length > 0) {
        const marketFirstClose = state.marketData[0].close;
        const marketNormalized = state.marketData.map(d =>
            +(d.close / marketFirstClose * firstClose).toFixed(2)
        );
        // 填充到与K线数据等长（市场数据可能天数略有差异）
        while (marketNormalized.length < data.length) {
            marketNormalized.push(marketNormalized[marketNormalized.length - 1]);
        }
        legendData.push('上证指数');
        series.push({
            name: '上证指数',
            type: 'line',
            data: marketNormalized.slice(0, data.length),
            xAxisIndex: 0,
            yAxisIndex: 0,
            smooth: 0.3,
            symbol: 'none',
            itemStyle: { color: '#64748b' },
            lineStyle: { color: '#64748b', width: 1.5, type: 'dashed', opacity: 0.7 },
            z: 1
        });
    }

    // 板块指数叠加线（归一化到股价尺度，虚线）
    if (state.sectorData && state.sectorData.length > 0) {
        const sectorFirstClose = state.sectorData[0].close;
        const sectorNormalized = state.sectorData.map(d =>
            +(d.close / sectorFirstClose * firstClose).toFixed(2)
        );
        while (sectorNormalized.length < data.length) {
            sectorNormalized.push(sectorNormalized[sectorNormalized.length - 1]);
        }
        const sectorName = (state.sector || '板块') + '指数';
        legendData.push(sectorName);
        series.push({
            name: sectorName,
            type: 'line',
            data: sectorNormalized.slice(0, data.length),
            xAxisIndex: 0,
            yAxisIndex: 0,
            smooth: 0.3,
            symbol: 'none',
            itemStyle: { color: '#06b6d4' },
            lineStyle: { color: '#06b6d4', width: 1.5, type: 'dashed', opacity: 0.7 },
            z: 1
        });
    }

    // BOLL布林带叠加主图
    const boll = calcBOLL(closes, 20, 2);
    legendData.push('BOLL上', 'BOLL中', 'BOLL下');
    series.push(
        { name: 'BOLL上', type: 'line', data: boll.upper, xAxisIndex: 0, yAxisIndex: 0, smooth: true, symbol: 'none', lineStyle: { color: '#e879f9', width: 1, opacity: 0.5, type: 'dotted' }, z: 1 },
        { name: 'BOLL中', type: 'line', data: boll.mid, xAxisIndex: 0, yAxisIndex: 0, smooth: true, symbol: 'none', lineStyle: { color: '#e879f9', width: 1, opacity: 0.7 }, z: 1 },
        { name: 'BOLL下', type: 'line', data: boll.lower, xAxisIndex: 0, yAxisIndex: 0, smooth: true, symbol: 'none', lineStyle: { color: '#e879f9', width: 1, opacity: 0.5, type: 'dotted' }, z: 1 }
    );

    // 副图系列（根据 state.subChart 切换）
    const subMode = state.subChart || 'vol';

    if (subMode === 'vol') {
        // 成交量
        series.push({
            name: '成交量', type: 'bar', data: volumes,
            xAxisIndex: 1, yAxisIndex: 1, barWidth: '60%'
        });
    } else if (subMode === 'macd') {
        // MACD
        const macdData = calcMACD(closes);
        series.push(
            { name: 'DIF', type: 'line', data: macdData.dif, xAxisIndex: 1, yAxisIndex: 1, symbol: 'none', lineStyle: { color: '#f59e0b', width: 1 }, z: 3 },
            { name: 'DEA', type: 'line', data: macdData.dea, xAxisIndex: 1, yAxisIndex: 1, symbol: 'none', lineStyle: { color: '#4890f8', width: 1 }, z: 3 },
            { name: 'MACD', type: 'bar', data: macdData.macd.map(v => ({
                value: v,
                itemStyle: { color: v !== null && v >= 0 ? 'rgba(239,68,68,0.6)' : 'rgba(34,197,94,0.6)' }
            })), xAxisIndex: 1, yAxisIndex: 1, barWidth: '50%' }
        );
        legendData.push('DIF', 'DEA', 'MACD');
    } else if (subMode === 'kdj') {
        // KDJ
        const kdjData = calcKDJ(data);
        series.push(
            { name: 'K', type: 'line', data: kdjData.k, xAxisIndex: 1, yAxisIndex: 1, symbol: 'none', lineStyle: { color: '#f59e0b', width: 1 }, z: 3 },
            { name: 'D', type: 'line', data: kdjData.d, xAxisIndex: 1, yAxisIndex: 1, symbol: 'none', lineStyle: { color: '#4890f8', width: 1 }, z: 3 },
            { name: 'J', type: 'line', data: kdjData.j, xAxisIndex: 1, yAxisIndex: 1, symbol: 'none', lineStyle: { color: '#a060f0', width: 1 }, z: 3 }
        );
        legendData.push('K', 'D', 'J');
    } else if (subMode === 'trix') {
        // TRIX
        const trixData = calcTRIX(closes);
        series.push(
            { name: 'TRIX', type: 'line', data: trixData.trix, xAxisIndex: 1, yAxisIndex: 1, symbol: 'none', lineStyle: { color: '#f59e0b', width: 1 }, z: 3 },
            { name: 'MATRIX', type: 'line', data: trixData.matrix, xAxisIndex: 1, yAxisIndex: 1, symbol: 'none', lineStyle: { color: '#4890f8', width: 1 }, z: 3 }
        );
        legendData.push('TRIX', 'MATRIX');
    }

    // 历史/交易分界线标记
    const markLineData = [];
    if (state.currentDay > 0) {
        markLineData.push({
            xAxis: '20',
            lineStyle: { color: 'rgba(245, 158, 11, 0.3)', type: 'dashed', width: 1 },
            label: {
                show: true,
                formatter: '← 历史 | 交易 →',
                position: 'middle',
                color: 'rgba(245, 158, 11, 0.5)',
                fontSize: 10
            }
        });
    }

    if (markLineData.length > 0 && series.length > 0) {
        // 给第一个主图系列添加标记线
        const mainSeries = series.find(s => s.yAxisIndex === 0);
        if (mainSeries) {
            mainSeries.markLine = {
                silent: true,
                symbol: 'none',
                data: markLineData
            };
        }
    }

    // 买卖点标记 - 红B蓝S散点
    if (state.trades && state.trades.length > 0) {
        const buyPts = [], sellPts = [];
        state.trades.forEach(t => {
            const xIdx = 19 + t.day;
            if (xIdx < data.length) {
                if (t.action === 'buy') {
                    buyPts.push({ value: [String(xIdx + 1), data[xIdx].low] });
                } else {
                    sellPts.push({ value: [String(xIdx + 1), data[xIdx].high] });
                }
            }
        });
        if (buyPts.length) {
            series.push({
                name: '买入', type: 'scatter', data: buyPts,
                xAxisIndex: 0, yAxisIndex: 0,
                symbol: 'circle', symbolSize: 6, symbolOffset: [0, 8],
                itemStyle: { color: '#f04444' },
                label: { show: true, position: 'bottom', formatter: 'B', color: '#f04444', fontSize: 8, fontWeight: 700, distance: 2, textShadowColor: 'rgba(0,0,0,0.8)', textShadowBlur: 2 },
                z: 20
            });
        }
        if (sellPts.length) {
            series.push({
                name: '卖出', type: 'scatter', data: sellPts,
                xAxisIndex: 0, yAxisIndex: 0,
                symbol: 'circle', symbolSize: 6, symbolOffset: [0, -8],
                itemStyle: { color: '#4890f8' },
                label: { show: true, position: 'top', formatter: 'S', color: '#4890f8', fontSize: 8, fontWeight: 700, distance: 2, textShadowColor: 'rgba(0,0,0,0.8)', textShadowBlur: 2 },
                z: 20
            });
        }
    }

    // 基准价：第20天收盘价（交易开始时）
    const basePrice = data[19] ? data[19].close : data[data.length - 1].close;

    const option = {
        animation: true,
        animationDuration: 300,
        backgroundColor: 'transparent',
        tooltip: {
            trigger: 'axis',
            axisPointer: {
                type: 'cross',
                crossStyle: { color: '#666' }
            },
            backgroundColor: 'rgba(12, 20, 32, 0.96)',
            borderColor: '#162034',
            textStyle: { color: '#e8ecf1', fontSize: 12 },
            formatter: function(params) {
                if (!params || !params.length) return '';
                const dayIdx = params[0].dataIndex;
                const d = data[dayIdx];
                let html = `<div style="font-size:11px;color:#8892a4;margin-bottom:4px;">Day ${dayIdx + 1}</div>`;
                html += `<div style="font-family:JetBrains Mono,monospace;font-size:12px;">`;
                html += `开: <span style="color:${d.close >= d.open ? '#f04444' : '#1ec870'}">${d.open.toFixed(2)}</span><br>`;
                html += `高: <span style="color:#f04444">${d.high.toFixed(2)}</span><br>`;
                html += `低: <span style="color:#1ec870">${d.low.toFixed(2)}</span><br>`;
                html += `收: <span style="color:${d.close >= d.open ? '#f04444' : '#1ec870'};font-weight:700">${d.close.toFixed(2)}</span><br>`;
                html += `量: ${(d.volume / 10000).toFixed(1)}万`;
                html += `</div>`;
                return html;
            }
        },
        legend: {
            data: legendData,
            selected: Object.assign({ 'BOLL上': false, 'BOLL中': false, 'BOLL下': false }, state.legendSelected),
            textStyle: { color: '#666', fontSize: 10 },
            top: 4,
            left: 'center',
            itemWidth: 10,
            itemHeight: 8,
            itemGap: 8
        },
        grid: [
            { left: 55, right: 16, top: 30, bottom: '28%' },
            { left: 55, right: 16, top: '78%', bottom: 24 }
        ],
        xAxis: [
            {
                type: 'category',
                data: dayLabels,
                gridIndex: 0,
                axisLine: { lineStyle: { color: '#1e2738' } },
                axisLabel: {
                    color: '#4d5566',
                    fontSize: 9,
                    interval: function(idx) {
                        return idx % 5 === 0;
                    }
                },
                axisTick: { show: false }
            },
            {
                type: 'category',
                data: dayLabels,
                gridIndex: 1,
                axisLine: { lineStyle: { color: '#1e2738' } },
                axisLabel: { show: false },
                axisTick: { show: false }
            }
        ],
        yAxis: [
            {
                type: 'value',
                gridIndex: 0,
                scale: true,
                splitLine: { lineStyle: { color: '#1a2030', type: 'dashed' } },
                axisLabel: {
                    color: '#4d5566', fontSize: 9,
                    formatter: v => { const p = ((v / basePrice) - 1) * 100; return (p >= 0 ? '+' : '') + p.toFixed(1) + '%'; }
                },
                axisLine: { show: false }
            },
            {
                type: 'value',
                gridIndex: 1,
                scale: subMode !== 'vol',
                splitLine: { show: subMode !== 'vol', lineStyle: { color: '#1a2030', type: 'dashed' } },
                axisLabel: { show: subMode !== 'vol', color: '#4d5566', fontSize: 8 },
                axisLine: { show: false }
            }
        ],
        dataZoom: [
            {
                type: 'inside',
                xAxisIndex: [0, 1],
                start: data.length > 30 ? Math.max(0, (1 - 30 / data.length) * 100) : 0,
                end: 100,
                minValueSpan: 10
            }
        ],
        series: series
    };

    state.chart.setOption(option, true);
}

// ========== 排行榜 ==========

async function loadRankings(tab = 'total') {
    const listEl = document.getElementById('ranking-list');
    listEl.innerHTML = '<div class="empty-state"><span class="loading"></span></div>';

    try {
        let data;
        if (tab === 'total') {
            data = await api('/api/rank/total');
            listEl.innerHTML = data.length ? data.map((item, idx) => `
                <div class="rank-item">
                    <div class="rank-position ${idx === 0 ? 'top1' : idx === 1 ? 'top2' : idx === 2 ? 'top3' : ''}">${idx + 1}</div>
                    <div class="rank-info" style="cursor:pointer" onclick="viewUserProfile(${item.user_id}, '${escapeHtml(item.nickname).replace(/'/g, "\\'")}')">
                        <div class="rank-name" style="text-decoration:underline;text-decoration-style:dotted">${escapeHtml(item.nickname)}</div>
                        <div class="rank-meta">${item.game_count}局 | 最佳 ${formatPercent(item.best_profit_rate)}</div>
                    </div>
                    <div class="rank-profit" style="color:${item.avg_profit_rate > 0 ? 'var(--rise)' : item.avg_profit_rate < 0 ? 'var(--fall)' : 'var(--text-muted)'}">
                        ${formatPercent(item.avg_profit_rate)}
                    </div>
                </div>
            `).join('') : '<div class="empty-state">暂无数据，快去挑战吧！</div>';
        } else if (tab === 'recent') {
            data = await api('/api/rank/recent');
            listEl.innerHTML = data.length ? data.map((item, idx) => `
                <div class="rank-item">
                    <div class="rank-seq">${idx + 1}</div>
                    <div class="rank-info">
                        <div class="rank-name">${escapeHtml(item.nickname)}</div>
                        <div class="rank-meta">神秘股票 #${item.scenario_id} | ${item.created_at ? item.created_at.slice(5, 16) : ''}</div>
                    </div>
                    <div class="rank-profit" style="color:${item.profit_rate > 0 ? 'var(--rise)' : item.profit_rate < 0 ? 'var(--fall)' : 'var(--text-muted)'}">
                        ${formatPercent(item.profit_rate)}
                    </div>
                    <button class="rank-challenge" onclick="challengeStock(${item.scenario_id})">挑战</button>
                </div>
            `).join('') : '<div class="empty-state">暂无记录</div>';
        } else if (tab === 'stock') {
            // 同股PK：获取所有场景列表
            data = await api('/api/rank/scenarios');
            if (data.length) {
                listEl.innerHTML = data.map((item, idx) => `
                    <div class="rank-item" style="cursor:pointer" onclick="viewScenarioRank(${item.id})">
                        <div class="rank-position" style="background:var(--accent-bg);color:var(--accent)">#${item.id}</div>
                        <div class="rank-info">
                            <div class="rank-name">神秘股票 #${item.id}${item.sector ? ' <span style="color:var(--text-muted);font-weight:400;font-size:11px">(' + item.sector + ')</span>' : ''}</div>
                            <div class="rank-meta">${item.play_count}人挑战${item.play_count > 0 ? ' | 最佳 ' + formatPercent(item.best_profit) : ''}</div>
                        </div>
                        <button class="rank-challenge" onclick="event.stopPropagation();challengeStock(${item.id})">挑战</button>
                    </div>
                `).join('');
            } else {
                listEl.innerHTML = '<div class="empty-state">暂无记录</div>';
            }
        }
    } catch (e) {
        listEl.innerHTML = '<div class="empty-state">加载失败</div>';
    }
}

/** 查看用户档案（从总排行点击进入） */
async function viewUserProfile(userId, nickname) {
    const listEl = document.getElementById('ranking-list');
    listEl.innerHTML = '<div class="empty-state"><span class="loading"></span></div>';

    try {
        const data = await api(`/api/user/profile/${userId}`);
        let html = `<div class="rank-item" style="background:var(--bg-elevated);border-color:var(--accent);cursor:pointer" onclick="loadRankings('total')">
            <div class="rank-position" style="background:var(--accent);color:#000">←</div>
            <div class="rank-info"><div class="rank-name">返回总排行</div></div>
        </div>`;

        // 用户信息卡片
        const s = data.stats;
        html += `<div class="user-profile-card">
            <div class="profile-nickname">${escapeHtml(data.nickname)}</div>
            <div class="profile-stats">
                <div class="profile-stat-item">
                    <div class="profile-stat-value">${s.game_count}</div>
                    <div class="profile-stat-label">总场次</div>
                </div>
                <div class="profile-stat-item">
                    <div class="profile-stat-value" style="color:${s.avg_profit > 0 ? 'var(--rise)' : s.avg_profit < 0 ? 'var(--fall)' : 'var(--text-muted)'}">${formatPercent(s.avg_profit)}</div>
                    <div class="profile-stat-label">平均收益</div>
                </div>
                <div class="profile-stat-item">
                    <div class="profile-stat-value" style="color:var(--rise)">${formatPercent(s.best_profit)}</div>
                    <div class="profile-stat-label">最佳</div>
                </div>
                <div class="profile-stat-item">
                    <div class="profile-stat-value" style="color:var(--fall)">${formatPercent(s.worst_profit)}</div>
                    <div class="profile-stat-label">最差</div>
                </div>
            </div>
        </div>`;

        // 战绩列表
        html += `<div style="padding:8px 14px;font-size:12px;color:var(--text-muted)">最近战绩</div>`;
        if (data.games.length) {
            html += data.games.map((g, idx) => `
                <div class="rank-item">
                    <div class="rank-position" style="background:var(--accent-bg);color:var(--accent)">#${g.scenario_id}</div>
                    <div class="rank-info">
                        <div class="rank-name">神秘股票 #${g.scenario_id}</div>
                        <div class="rank-meta">${g.created_at ? g.created_at.slice(0, 16) : ''} | ${g.status === 'completed' ? '已完成' : '进行中'}</div>
                    </div>
                    <div class="rank-profit" style="color:${g.profit_rate > 0 ? 'var(--rise)' : g.profit_rate < 0 ? 'var(--fall)' : 'var(--text-muted)'}">
                        ${formatPercent(g.profit_rate)}
                    </div>
                    <button class="rank-challenge" onclick="challengeStock(${g.scenario_id})">PK</button>
                </div>
            `).join('');
        } else {
            html += '<div class="empty-state">暂无战绩</div>';
        }
        listEl.innerHTML = html;
    } catch (e) {
        listEl.innerHTML = '<div class="empty-state">加载失败</div>';
    }
}

/** PK对比查看 - 同一场景下多个用户的买卖点 */
async function viewPKComparison(scenarioId) {
    const listEl = document.getElementById('ranking-list');
    listEl.innerHTML = '<div class="empty-state"><span class="loading"></span></div>';

    try {
        // 获取场景详情（K线数据）
        const detail = await api(`/api/game/detail_multi`, { scenario_id: scenarioId });
        // 获取场景 K线数据（借用第一个游戏的detail）
        const sceneData = await api(`/api/game/detail/${detail[0]?.game_id}`);

        let html = `<div class="rank-item" style="background:var(--bg-elevated);border-color:var(--accent);cursor:pointer" onclick="viewScenarioRank(${scenarioId})">
            <div class="rank-position" style="background:var(--accent);color:#000">←</div>
            <div class="rank-info"><div class="rank-name">返回排行榜</div></div>
        </div>`;
        html += `<div style="padding:8px 14px;font-size:12px;color:var(--text-muted)">神秘股票 #${scenarioId} - 买卖点对比</div>`;

        // 图表容器
        html += `<div id="pk-chart" style="width:100%;height:360px;margin:8px 0"></div>`;

        // 用户收益列表
        html += detail.map(u => {
            const pc = u.profit_rate > 0 ? 'var(--rise)' : u.profit_rate < 0 ? 'var(--fall)' : 'var(--text-muted)';
            return `<div class="rank-item">
                <div class="rank-info"><div class="rank-name">${escapeHtml(u.nickname)}</div>
                <div class="rank-meta">${u.trades.length}次交易</div></div>
                <div class="rank-profit" style="color:${pc}">${formatPercent(u.profit_rate)}</div>
            </div>`;
        }).join('');

        listEl.innerHTML = html;

        // 渲染PK对比图表
        setTimeout(() => renderPKChart(sceneData, detail), 100);
    } catch (e) {
        listEl.innerHTML = '<div class="empty-state">加载失败: ' + e.message + '</div>';
    }
}

/** 渲染PK对比图表 */
function renderPKChart(sceneData, playersData) {
    const chartDom = document.getElementById('pk-chart');
    if (!chartDom) return;

    const pkChart = echarts.init(chartDom, null, { renderer: 'canvas' });
    const klineData = sceneData.kline_data;
    const dayLabels = klineData.map((_, i) => `${i + 1}`);
    const closes = klineData.map(d => d.close);
    const ohlcData = klineData.map(d => [d.open, d.close, d.low, d.high]);

    const series = [];
    const legendData = ['K线'];

    // K线
    series.push({
        name: 'K线', type: 'candlestick', data: ohlcData,
        itemStyle: { color: '#f04444', color0: '#1ec870', borderColor: '#f04444', borderColor0: '#1ec870', borderWidth: 1 },
        barWidth: '50%',
        markLine: {
            silent: true, symbol: 'none',
            data: [{ xAxis: '20', lineStyle: { color: 'rgba(245,158,11,0.3)', type: 'dashed', width: 1 },
                label: { show: true, formatter: '← 历史 | 交易 →', position: 'middle', color: 'rgba(245,158,11,0.5)', fontSize: 10 } }]
        }
    });

    // 为每个玩家生成不同颜色的买卖标记
    const playerColors = ['#ff6b6b', '#4ecdc4', '#ffe66d', '#a29bfe', '#fd79a8', '#00cec9'];

    playersData.forEach((player, pIdx) => {
        const color = playerColors[pIdx % playerColors.length];
        const buyPts = [], sellPts = [];

        player.trades.forEach(t => {
            const xIdx = 19 + t.day;
            if (xIdx < klineData.length) {
                if (t.action === '买入') {
                    buyPts.push({ value: [String(xIdx + 1), klineData[xIdx].low], price: t.price, shares: t.shares, nickname: player.nickname });
                } else {
                    sellPts.push({ value: [String(xIdx + 1), klineData[xIdx].high], price: t.price, shares: t.shares, nickname: player.nickname });
                }
            }
        });

        const label = player.nickname.slice(0, 4);
        if (buyPts.length) {
            const name = `${label}-买`;
            legendData.push(name);
            series.push({
                name, type: 'scatter', data: buyPts,
                symbol: 'circle', symbolSize: 3, symbolOffset: [0, 4 + pIdx * 3],
                itemStyle: { color },
                label: { show: true, position: 'bottom', formatter: () => label[0] + 'B', color, fontSize: 7, fontWeight: 700, distance: 4, textShadowColor: 'rgba(0,0,0,0.8)', textShadowBlur: 3 },
                tooltip: { formatter: p => `<span style="color:${color}">${p.data.nickname} 买入</span><br/>¥${p.data.price.toFixed(2)} × ${p.data.shares}股` },
                z: 10 + pIdx
            });
        }
        if (sellPts.length) {
            const name = `${label}-卖`;
            legendData.push(name);
            series.push({
                name, type: 'scatter', data: sellPts,
                symbol: 'circle', symbolSize: 3, symbolOffset: [0, -4 - pIdx * 3],
                itemStyle: { color },
                label: { show: true, position: 'top', formatter: () => label[0] + 'S', color, fontSize: 7, fontWeight: 700, distance: 4, textShadowColor: 'rgba(0,0,0,0.8)', textShadowBlur: 3 },
                tooltip: { formatter: p => `<span style="color:${color}">${p.data.nickname} 卖出</span><br/>¥${p.data.price.toFixed(2)} × ${p.data.shares}股` },
                z: 10 + pIdx
            });
        }
    });

    pkChart.setOption({
        animation: false,
        backgroundColor: 'transparent',
        tooltip: { trigger: 'axis', axisPointer: { type: 'cross' }, backgroundColor: 'rgba(20,25,35,0.95)', borderColor: '#2a3347', textStyle: { color: '#e8ecf1', fontSize: 12 } },
        legend: { data: legendData, textStyle: { color: '#666', fontSize: 9 }, top: 4, left: 'center', itemWidth: 8, itemHeight: 8, itemGap: 6 },
        grid: { left: 55, right: 16, top: 34, bottom: 30 },
        xAxis: {
            type: 'category', data: dayLabels,
            axisLine: { lineStyle: { color: '#1e2738' } },
            axisLabel: { color: '#4d5566', fontSize: 9, interval: idx => idx % 5 === 0 },
            axisTick: { show: false }
        },
        yAxis: {
            type: 'value', scale: true,
            splitLine: { lineStyle: { color: '#1a2030', type: 'dashed' } },
            axisLabel: {
                color: '#4d5566', fontSize: 9,
                formatter: v => { const p = ((v / (closes[19] || closes[closes.length-1])) - 1) * 100; return (p >= 0 ? '+' : '') + p.toFixed(1) + '%'; }
            }, axisLine: { show: false }
        },
        dataZoom: [{ type: 'inside', start: klineData.length > 30 ? Math.max(0, (1 - 30 / klineData.length) * 100) : 0, end: 100, minValueSpan: 10 }],
        series: series
    });

    window.addEventListener('resize', () => pkChart.resize());
}

/** 查看特定场景排行 */
async function viewScenarioRank(scenarioId) {
    const listEl = document.getElementById('ranking-list');
    listEl.innerHTML = '<div class="empty-state"><span class="loading"></span></div>';

    try {
        const data = await api(`/api/rank/scenario/${scenarioId}`);
        let html = `<div class="rank-item" style="background:var(--bg-elevated);border-color:var(--accent);cursor:pointer" onclick="loadRankings('stock')">
            <div class="rank-position" style="background:var(--accent);color:#000">←</div>
            <div class="rank-info"><div class="rank-name">返回同股列表</div></div>
            <button class="rank-challenge" onclick="event.stopPropagation();challengeStock(${scenarioId})">挑战此股</button>
        </div>`;
        html += `<div style="padding:8px 14px;font-size:12px;color:var(--text-muted)">神秘股票 #${scenarioId} 排行榜</div>`;
        if (data.length) {
            // 对比查看按钮
            html += `<div style="padding:4px 14px 8px"><button class="rank-challenge" style="padding:8px 20px;font-size:13px;border-radius:16px;background:linear-gradient(135deg,#8b5cf6,#6d28d9)" onclick="viewPKComparison(${scenarioId})">📊 对比所有买卖点</button></div>`;
            html += data.map((item, idx) => `
                <div class="rank-item">
                    <div class="rank-position ${idx === 0 ? 'top1' : idx === 1 ? 'top2' : idx === 2 ? 'top3' : ''}">${idx + 1}</div>
                    <div class="rank-info">
                        <div class="rank-name">${escapeHtml(item.nickname)}</div>
                        <div class="rank-meta">${item.created_at || ''}</div>
                    </div>
                    <div class="rank-profit" style="color:${item.profit_rate > 0 ? 'var(--rise)' : item.profit_rate < 0 ? 'var(--fall)' : 'var(--text-muted)'}">
                        ${formatPercent(item.profit_rate)}
                    </div>
                </div>
            `).join('');
        } else {
            html += '<div class="empty-state">暂无挑战记录</div>';
        }
        listEl.innerHTML = html;
    } catch (e) {
        listEl.innerHTML = '<div class="empty-state">加载失败</div>';
    }
}

/** PK挑战同一只股票 */
async function challengeStock(scenarioId) {
    if (!state.user) {
        showToast('请先登录');
        return;
    }
    try {
        const res = await api('/api/game/challenge', {
            user_id: state.user.id,
            scenario_id: scenarioId
        });
        state.gameId = res.game_id;
        state.scenarioId = res.scenario_id;
        state.scenarioName = res.scenario_name;
        state.klineData = res.kline_data;
        state.currentDay = 0;
        state.cash = res.cash;
        state.shares = 0;
        state.avgCost = 0;
        state.initialCash = res.initial_cash;
        state.marketData = res.market_data || null;
        state.sectorData = res.sector_data || null;
        state.sector = res.sector || '';
        state.legendSelected = {};
        state.trades = [];

        showView('view-game');
        initChart();
        updateGameUI();
        showToast('PK挑战开始！分析走势后点击"开始交易"');
    } catch (e) {
        showToast(e.message);
    }
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ========== 历史记录 ==========

async function loadHistory() {
    state.historyDetailMode = false; // 回到列表模式
    const listEl = document.getElementById('history-list');
    listEl.innerHTML = '<div class="empty-state"><span class="loading"></span></div>';

    try {
        const data = await api('/api/user/history', { user_id: state.user.id });
        if (!data.length) {
            listEl.innerHTML = '<div class="empty-state">还没有游戏记录</div>';
            return;
        }

        listEl.innerHTML = data.map(item => {
            const isFinished = item.status === 'finished';
            return `
                <div class="history-item" style="cursor:pointer" onclick="viewGameDetail(${item.id})">
                    <div class="history-info">
                        <div class="history-name">神秘股票 #${item.scenario_id}</div>
                        <div class="history-date">${item.created_at || ''}</div>
                        <span class="history-status ${isFinished ? 'status-finished' : 'status-abandoned'}">
                            ${isFinished ? '已完成' : '已放弃'}
                        </span>
                    </div>
                    ${isFinished ? `
                        <div style="display:flex;align-items:center;gap:8px">
                            <div class="history-profit" style="color:${item.profit_rate > 0 ? 'var(--rise)' : item.profit_rate < 0 ? 'var(--fall)' : 'var(--text-muted)'}">
                                ${formatPercent(item.profit_rate)}
                            </div>
                            <button class="rank-challenge" onclick="event.stopPropagation();challengeStock(${item.scenario_id})">PK</button>
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');
    } catch (e) {
        listEl.innerHTML = '<div class="empty-state">加载失败</div>';
    }
}

/** 查看游戏详情（历史战绩点击进入） */
async function viewGameDetail(gameId) {
    history.pushState({ view: 'view-history-detail' }, '');
    state.historyDetailMode = true; // 进入详情模式
    const listEl = document.getElementById('history-list');
    listEl.innerHTML = '<div class="empty-state"><span class="loading"></span></div>';

    try {
        const data = await api(`/api/game/detail/${gameId}`);

        // 构建详情页HTML
        let html = `<div class="rank-item" style="background:var(--bg-elevated);border-color:var(--accent);cursor:pointer" onclick="loadHistory()">
            <div class="rank-position" style="background:var(--accent);color:#000">←</div>
            <div class="rank-info"><div class="rank-name">返回战绩列表</div></div>
        </div>`;

        // 股票信息卡片
        const profitColor = data.profit_rate > 0 ? 'var(--rise)' : data.profit_rate < 0 ? 'var(--fall)' : 'var(--text-muted)';
        html += `<div class="user-profile-card">
            <div class="profile-nickname">${data.stock_name || '神秘股票'} ${data.stock_code ? '(' + data.stock_code + ')' : '#' + data.scenario_id}</div>
            <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">${data.period || ''} ${data.sector ? '| ' + data.sector : ''}</div>
            <div class="profile-stats">
                <div class="profile-stat-item">
                    <div class="profile-stat-value" style="color:${profitColor}">${data.profit_rate !== null ? formatPercent(data.profit_rate) : 'N/A'}</div>
                    <div class="profile-stat-label">收益率</div>
                </div>
                <div class="profile-stat-item">
                    <div class="profile-stat-value">${data.initial_cash ? formatMoney(data.initial_cash) : 'N/A'}</div>
                    <div class="profile-stat-label">初始资金</div>
                </div>
                <div class="profile-stat-item">
                    <div class="profile-stat-value" style="color:${profitColor}">${data.final_asset ? formatMoney(data.final_asset) : 'N/A'}</div>
                    <div class="profile-stat-label">最终资产</div>
                </div>
            </div>
        </div>`;

        // 图表容器
        html += `<div id="detail-chart" style="width:100%;height:320px;margin:8px 0"></div>`;

        // 交易记录列表
        html += `<div style="padding:8px 14px;font-size:12px;color:var(--text-muted)">交易记录</div>`;
        if (data.trades && data.trades.length > 0) {
            html += data.trades.map(t => {
                const isBuy = t.action === '买入';
                return `<div class="rank-item">
                    <div class="rank-position" style="background:${isBuy ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.15)'};color:${isBuy ? 'var(--rise)' : 'var(--fall)'}">${isBuy ? 'B' : 'S'}</div>
                    <div class="rank-info">
                        <div class="rank-name" style="color:${isBuy ? 'var(--rise)' : 'var(--fall)'}">${t.action} ${t.shares}股</div>
                        <div class="rank-meta">第${t.day}个交易日 | 单价 ¥${t.price.toFixed(2)}</div>
                    </div>
                    <div class="rank-profit" style="font-size:14px;color:var(--text-primary)">¥${t.amount.toFixed(2)}</div>
                </div>`;
            }).join('');
        } else {
            html += '<div class="empty-state">无交易记录</div>';
        }

        // PK按钮
        html += `<div style="padding:16px;text-align:center">
            <button class="rank-challenge" style="padding:10px 24px;font-size:14px;border-radius:20px" onclick="challengeStock(${data.scenario_id})">挑战这只股票</button>
        </div>`;

        listEl.innerHTML = html;

        // 渲染详情图表
        setTimeout(() => renderDetailChart(data), 100);
    } catch (e) {
        listEl.innerHTML = '<div class="empty-state">加载失败: ' + e.message + '</div>';
    }
}

/** 渲染详情页图表（含买卖标记） */
function renderDetailChart(data) {
    const chartDom = document.getElementById('detail-chart');
    if (!chartDom) return;

    const detailChart = echarts.init(chartDom, null, { renderer: 'canvas' });
    const klineData = data.kline_data;
    const dayLabels = klineData.map((_, i) => `${i + 1}`);
    const closes = klineData.map(d => d.close);
    const firstClose = closes[0];

    // OHLC
    const ohlcData = klineData.map(d => [d.open, d.close, d.low, d.high]);

    // MA
    const ma5 = calcMA(closes, 5);
    const ma10 = calcMA(closes, 10);
    const ma20 = calcMA(closes, 20);

    const series = [];
    const legendData = ['K线', 'MA5', 'MA10', 'MA20'];

    // K线
    series.push({
        name: 'K线',
        type: 'candlestick',
        data: ohlcData,
        itemStyle: {
            color: '#f04444', color0: '#1ec870',
            borderColor: '#f04444', borderColor0: '#1ec870', borderWidth: 1
        },
        barWidth: '50%'
    });

    // MA
    series.push(
        { name: 'MA5', type: 'line', data: ma5, smooth: true, symbol: 'none', itemStyle: { color: '#f59e0b' }, lineStyle: { color: '#f59e0b', width: 1, opacity: 0.8 }, z: 2 },
        { name: 'MA10', type: 'line', data: ma10, smooth: true, symbol: 'none', itemStyle: { color: '#4890f8' }, lineStyle: { color: '#4890f8', width: 1, opacity: 0.8 }, z: 2 },
        { name: 'MA20', type: 'line', data: ma20, smooth: true, symbol: 'none', itemStyle: { color: '#a060f0' }, lineStyle: { color: '#a060f0', width: 1, opacity: 0.8 }, z: 2 }
    );

    // 上证指数叠加
    if (data.market_data && data.market_data.length > 0) {
        const mFirst = data.market_data[0].close;
        const mNorm = data.market_data.map(d => +(d.close / mFirst * firstClose).toFixed(2));
        while (mNorm.length < klineData.length) mNorm.push(mNorm[mNorm.length - 1]);
        legendData.push('上证指数');
        series.push({
            name: '上证指数', type: 'line', data: mNorm.slice(0, klineData.length),
            smooth: 0.3, symbol: 'none', itemStyle: { color: '#64748b' },
            lineStyle: { color: '#64748b', width: 1.5, type: 'dashed', opacity: 0.7 }, z: 1
        });
    }

    // 板块指数叠加
    if (data.sector_data && data.sector_data.length > 0) {
        const sFirst = data.sector_data[0].close;
        const sNorm = data.sector_data.map(d => +(d.close / sFirst * firstClose).toFixed(2));
        while (sNorm.length < klineData.length) sNorm.push(sNorm[sNorm.length - 1]);
        const sName = (data.sector || '板块') + '指数';
        legendData.push(sName);
        series.push({
            name: sName, type: 'line', data: sNorm.slice(0, klineData.length),
            smooth: 0.3, symbol: 'none', itemStyle: { color: '#06b6d4' },
            lineStyle: { color: '#06b6d4', width: 1.5, type: 'dashed', opacity: 0.7 }, z: 1
        });
    }

    // 第20天分界线（先设置，再追加买卖标记）
    series[0].markLine = {
        silent: true, symbol: 'none',
        data: [{
            xAxis: '20',
            lineStyle: { color: 'rgba(245,158,11,0.3)', type: 'dashed', width: 1 },
            label: { show: true, formatter: '← 历史 | 交易 →', position: 'middle', color: 'rgba(245,158,11,0.5)', fontSize: 10 }
        }]
    };

    // 买卖标记 - 红B蓝S散点
    if (data.trades && data.trades.length > 0) {
        const buyPts = [], sellPts = [];
        data.trades.forEach(t => {
            const xIdx = 19 + t.day;
            if (xIdx < klineData.length) {
                if (t.action === '买入') {
                    buyPts.push({ value: [String(xIdx + 1), klineData[xIdx].low] });
                } else {
                    sellPts.push({ value: [String(xIdx + 1), klineData[xIdx].high] });
                }
            }
        });
        if (buyPts.length) {
            series.push({
                name: '买入', type: 'scatter', data: buyPts,
                symbol: 'circle', symbolSize: 6, symbolOffset: [0, 8],
                itemStyle: { color: '#f04444' },
                label: { show: true, position: 'bottom', formatter: 'B', color: '#f04444', fontSize: 8, fontWeight: 700, distance: 2, textShadowColor: 'rgba(0,0,0,0.8)', textShadowBlur: 2 },
                z: 20
            });
        }
        if (sellPts.length) {
            series.push({
                name: '卖出', type: 'scatter', data: sellPts,
                symbol: 'circle', symbolSize: 6, symbolOffset: [0, -8],
                itemStyle: { color: '#4890f8' },
                label: { show: true, position: 'top', formatter: 'S', color: '#4890f8', fontSize: 8, fontWeight: 700, distance: 2, textShadowColor: 'rgba(0,0,0,0.8)', textShadowBlur: 2 },
                z: 20
            });
        }
    }

    detailChart.setOption({
        animation: false,
        backgroundColor: 'transparent',
        tooltip: { trigger: 'axis', axisPointer: { type: 'cross' }, backgroundColor: 'rgba(20,25,35,0.95)', borderColor: '#2a3347', textStyle: { color: '#e8ecf1', fontSize: 12 } },
        legend: { data: legendData, textStyle: { color: '#666', fontSize: 10 }, top: 4, left: 'center', itemWidth: 10, itemHeight: 8, itemGap: 8 },
        grid: { left: 55, right: 16, top: 30, bottom: 30 },
        xAxis: {
            type: 'category', data: dayLabels,
            axisLine: { lineStyle: { color: '#1e2738' } },
            axisLabel: { color: '#4d5566', fontSize: 9, interval: idx => idx % 5 === 0 },
            axisTick: { show: false }
        },
        yAxis: {
            type: 'value', scale: true,
            splitLine: { lineStyle: { color: '#1a2030', type: 'dashed' } },
            axisLabel: {
                color: '#4d5566', fontSize: 9,
                formatter: v => { const p = ((v / (closes[19] || closes[closes.length-1])) - 1) * 100; return (p >= 0 ? '+' : '') + p.toFixed(1) + '%'; }
            }, axisLine: { show: false }
        },
        dataZoom: [{
            type: 'inside', start: klineData.length > 30 ? Math.max(0, (1 - 30 / klineData.length) * 100) : 0, end: 100, minValueSpan: 10
        }],
        series: series
    });

    // 窗口尺寸变化时resize
    window.addEventListener('resize', () => detailChart.resize());
}

// ========== K线图鉴数据 ==========

const KLINE_PATTERNS = [
    // ---- 单根K线 ----
    {
        id: 'big-yang', name: '大阳线', engName: 'Bullish Marubozu',
        category: 'single', signal: 'bullish',
        candles: [{ o: 30, h: 73, l: 27, c: 70 }],
        description: '开盘价接近最低价，收盘价接近最高价，实体很长，上下影线极短或无。是多头力量极为强劲的信号。',
        note: '出现在下跌趋势末端或突破时，往往预示行情反转向上；出现在上涨途中，则是趋势延续信号。',
        rules: ['实体长度占K线总高度70%以上', '上下影线极短（影线/实体 < 10%）', '收盘价接近全天最高价']
    },
    {
        id: 'big-yin', name: '大阴线', engName: 'Bearish Marubozu',
        category: 'single', signal: 'bearish',
        candles: [{ o: 70, h: 73, l: 27, c: 30 }],
        description: '开盘价接近最高价，收盘价接近最低价，实体很长，上下影线极短或无。是空头力量极为强劲的信号。',
        note: '出现在上涨趋势末端，往往是趋势反转的信号；若在跌势中出现，则代表下跌加速。',
        rules: ['实体长度占K线总高度70%以上', '上下影线极短', '收盘价接近全天最低价']
    },
    {
        id: 'hammer', name: '锤子线', engName: 'Hammer',
        category: 'single', signal: 'bullish',
        candles: [{ o: 65, h: 68, l: 30, c: 67 }],
        description: '实体小，位于K线上部；下影线很长（至少是实体的2倍），上影线极短或无。如同一把锤子，象征多头把价格从低位锤回。',
        note: '必须出现在下跌趋势末端才有效。下影线越长，反转信号越强。次日出现阳线可确认。',
        rules: ['必须在下跌趋势中出现', '下影线 ≥ 实体的2倍', '上影线极短或无', '实体颜色不限，阳线更佳']
    },
    {
        id: 'hanging-man', name: '上吊线', engName: 'Hanging Man',
        category: 'single', signal: 'bearish',
        candles: [{ o: 65, h: 68, l: 30, c: 67 }],
        description: '外形与锤子线相同，但出现在上涨趋势末端。价格高开，盘中一度大幅下跌，虽收回但下影线很长，暗示多头已现疲态。',
        note: '出现后若次日开盘低于上吊线实体，则反转信号得到确认。成交量越大，信号越可靠。',
        rules: ['必须在上涨趋势末端出现', '下影线 ≥ 实体的2倍', '上影线极短或无', '次日确认下跌更有效']
    },
    {
        id: 'shooting-star', name: '射击之星', engName: 'Shooting Star',
        category: 'single', signal: 'bearish',
        candles: [{ o: 36, h: 72, l: 33, c: 38 }],
        description: '实体小，位于K线下部；上影线很长（至少是实体的2倍），下影线极短或无。价格大幅冲高后被空头强力压回，多头失守。',
        note: '出现在上涨趋势末端，是常见的顶部反转信号。实体越小、上影线越长，信号越强。',
        rules: ['必须在上涨趋势末端出现', '上影线 ≥ 实体的2倍', '下影线极短或无', '实体位于K线下部']
    },
    {
        id: 'inverted-hammer', name: '倒锤子线', engName: 'Inverted Hammer',
        category: 'single', signal: 'bullish',
        candles: [{ o: 36, h: 72, l: 33, c: 38 }],
        description: '外形与射击之星相同，但出现在下跌趋势末端。多头试图推动价格上涨，虽未守住高位，但预示多头力量正在积聚。',
        note: '需要次日阳线确认。单独出现意义不大，结合成交量放大更可靠。',
        rules: ['必须在下跌趋势末端出现', '上影线 ≥ 实体的2倍', '下影线极短或无', '需次日阳线确认']
    },
    {
        id: 'doji', name: '十字星', engName: 'Doji',
        category: 'single', signal: 'neutral',
        candles: [{ o: 50, h: 72, l: 28, c: 50 }],
        description: '开盘价与收盘价几乎相等，实体极小甚至为一条线，上下影线均存在。代表多空力量的极度平衡与市场犹豫。',
        note: '在上涨趋势顶部出现可能预示反转；在下跌趋势底部出现可能预示反转。需结合趋势背景判断。',
        rules: ['开收盘价差极小（< 价格范围的5%）', '上下均有影线', '需结合趋势背景才有意义']
    },
    {
        id: 'gravestone-doji', name: '墓碑十字', engName: 'Gravestone Doji',
        category: 'single', signal: 'bearish',
        candles: [{ o: 30, h: 72, l: 29, c: 30 }],
        description: '开盘价、收盘价与最低价几乎相同，只有很长的上影线。形如墓碑，象征多头的最后一搏被彻底压垮。',
        note: '在上涨趋势末端出现，是非常强烈的顶部反转信号。上影线越长，信号越强。',
        rules: ['开盘、收盘、最低价几乎相同', '上影线极长', '无下影线或极短', '出现在上涨趋势末端']
    },
    {
        id: 'dragonfly-doji', name: '蜻蜓十字', engName: 'Dragonfly Doji',
        category: 'single', signal: 'bullish',
        candles: [{ o: 71, h: 72, l: 28, c: 71 }],
        description: '开盘价、收盘价与最高价几乎相同，只有很长的下影线。形如蜻蜓，象征空头被多头在低位全力拉回。',
        note: '在下跌趋势末端出现，是强烈的底部反转信号。下影线越长，买盘越强劲。',
        rules: ['开盘、收盘、最高价几乎相同', '下影线极长', '无上影线或极短', '出现在下跌趋势末端']
    },
    {
        id: 'spinning-top', name: '纺锤线', engName: 'Spinning Top',
        category: 'single', signal: 'neutral',
        candles: [{ o: 48, h: 68, l: 32, c: 52 }],
        description: '实体较小，上下影线均较长且大致相等。多空双方均有一定作为，但谁也无法占据明显优势，市场方向不明。',
        note: '在趋势末期出现，可能预示趋势即将反转或进入盘整。需结合前后K线判断。',
        rules: ['实体短小', '上下影线均较长', '影线长度大致相近', '代表多空均衡状态']
    },
    // ---- 双根K线 ----
    {
        id: 'bullish-engulfing', name: '看涨吞噬', engName: 'Bullish Engulfing',
        category: 'double', signal: 'bullish',
        candles: [{ o: 58, h: 61, l: 40, c: 44 }, { o: 38, h: 70, l: 35, c: 67 }],
        description: '第一根为阴线，第二根为阳线，且阳线实体完全包住（吞噬）阴线实体。阳线开盘低于阴线收盘，但收盘高于阴线开盘。',
        note: '出现在下跌趋势末端，是强力看涨反转信号。吞噬幅度越大，信号越强。成交量放大效果更佳。',
        rules: ['需出现在下跌趋势中', '第二根阳线实体须完全吞噬第一根阴线实体', '第二根成交量应大于第一根']
    },
    {
        id: 'bearish-engulfing', name: '看跌吞噬', engName: 'Bearish Engulfing',
        category: 'double', signal: 'bearish',
        candles: [{ o: 42, h: 62, l: 39, c: 58 }, { o: 63, h: 65, l: 30, c: 34 }],
        description: '第一根为阳线，第二根为阴线，且阴线实体完全包住（吞噬）阳线实体。阴线开盘高于阳线收盘，但收盘低于阳线开盘。',
        note: '出现在上涨趋势末端，是强力看跌反转信号。是预判顶部的重要信号之一。',
        rules: ['需出现在上涨趋势中', '第二根阴线实体须完全吞噬第一根阳线实体', '成交量放大更可靠']
    },
    {
        id: 'bullish-harami', name: '看涨孕线', engName: 'Bullish Harami',
        category: 'double', signal: 'bullish',
        candles: [{ o: 65, h: 67, l: 30, c: 33 }, { o: 40, h: 58, l: 37, c: 54 }],
        description: '第一根为长阴线，第二根为短阳线，且第二根实体完全在第一根实体范围之内（孕于其中）。名称来自日语"母子"。',
        note: '出现在下跌趋势中，提示趋势可能放缓。信号较弱，需次日阳线确认。',
        rules: ['出现在下跌趋势中', '第二根小阳线须在第一根阴线实体内', '第二根成交量通常较小']
    },
    {
        id: 'bearish-harami', name: '看跌孕线', engName: 'Bearish Harami',
        category: 'double', signal: 'bearish',
        candles: [{ o: 35, h: 68, l: 32, c: 65 }, { o: 52, h: 62, l: 42, c: 47 }],
        description: '第一根为长阳线，第二根为短阴线，且第二根实体完全在第一根实体范围之内。预示上涨势头减弱。',
        note: '出现在上涨趋势末端，是潜在的顶部反转信号。需配合其他指标确认。',
        rules: ['出现在上涨趋势中', '第二根小阴线须在第一根阳线实体内', '若第二根为十字星则信号更强']
    },
    {
        id: 'piercing', name: '刺穿形态', engName: 'Piercing Pattern',
        category: 'double', signal: 'bullish',
        candles: [{ o: 65, h: 67, l: 30, c: 34 }, { o: 27, h: 58, l: 24, c: 55 }],
        description: '第一根为阴线，第二根阳线低开（低于第一根最低价），但收盘价超过第一根实体的中点以上。多头在低位强力反击。',
        note: '出现在下跌趋势末端，是看涨反转信号。阳线穿入阴线实体越深，信号越强。',
        rules: ['第二根须跳空低开', '收盘须高于第一根阴线实体的中点', '出现在下跌趋势末端']
    },
    {
        id: 'dark-cloud', name: '乌云压顶', engName: 'Dark Cloud Cover',
        category: 'double', signal: 'bearish',
        candles: [{ o: 35, h: 68, l: 32, c: 65 }, { o: 72, h: 74, l: 42, c: 45 }],
        description: '第一根为阳线，第二根阴线高开（高于第一根最高价），但收盘价跌入第一根实体的中点以下。空头从高位大力压制。',
        note: '出现在上涨趋势末端，是强烈的看跌反转信号。与刺穿形态互为镜像。',
        rules: ['第二根须跳空高开', '收盘须低于第一根阳线实体的中点', '出现在上涨趋势末端']
    },
    {
        id: 'tweezers-top', name: '平头顶部', engName: 'Tweezers Top',
        category: 'double', signal: 'bearish',
        candles: [{ o: 45, h: 70, l: 42, c: 65 }, { o: 65, h: 70, l: 38, c: 42 }],
        description: '两根K线的最高价（或收盘价）完全相同，形成双重阻力。第二根无法突破前一日高点，显示上方阻力极强。',
        note: '在上涨趋势末端出现，有效提示阻力位。结合其他反转形态信号更强。',
        rules: ['两根K线最高价相同', '出现在上涨趋势末端', '成交量配合下降时更有效']
    },
    {
        id: 'tweezers-bottom', name: '平头底部', engName: 'Tweezers Bottom',
        category: 'double', signal: 'bullish',
        candles: [{ o: 55, h: 58, l: 30, c: 35 }, { o: 35, h: 62, l: 30, c: 58 }],
        description: '两根K线的最低价完全相同，形成双重支撑。第二根无法跌破前一日低点，显示下方支撑极为坚固。',
        note: '在下跌趋势末端出现，有效提示支撑位。常与其他底部形态组合出现。',
        rules: ['两根K线最低价相同', '出现在下跌趋势末端', '第二根为阳线时信号更强']
    },
    // ---- 三根K线 ----
    {
        id: 'three-white-soldiers', name: '红三兵', engName: 'Three White Soldiers',
        category: 'triple', signal: 'bullish',
        candles: [
            { o: 30, h: 52, l: 28, c: 50 },
            { o: 48, h: 65, l: 46, c: 63 },
            { o: 61, h: 78, l: 59, c: 76 }
        ],
        description: '连续三根实体较长的阳线，每根都在前一根实体内开盘，收盘依次升高。每根K线的上影线很短甚至没有。',
        note: '出现在下跌趋势末端或盘整突破后，是极强的多头信号。若在高位出现，要警惕过度延伸的风险。',
        rules: ['三根均为阳线且实体较长', '每根在前一根实体内开盘', '收盘价依次创新高', '上影线极短']
    },
    {
        id: 'three-black-crows', name: '三只乌鸦', engName: 'Three Black Crows',
        category: 'triple', signal: 'bearish',
        candles: [
            { o: 70, h: 72, l: 50, c: 52 },
            { o: 54, h: 56, l: 36, c: 38 },
            { o: 40, h: 42, l: 22, c: 24 }
        ],
        description: '连续三根实体较长的阴线，每根都在前一根实体内开盘，收盘依次走低。形如三只乌鸦展翅，预兆不祥。',
        note: '出现在上涨趋势末端或高位，是极强的空头信号。成交量逐日放大时信号更强。',
        rules: ['三根均为阴线且实体较长', '每根在前一根实体内开盘', '收盘价依次创新低', '下影线极短']
    },
    {
        id: 'morning-star', name: '早晨之星', engName: 'Morning Star',
        category: 'triple', signal: 'bullish',
        candles: [
            { o: 65, h: 67, l: 35, c: 40 },
            { o: 38, h: 42, l: 28, c: 34 },
            { o: 36, h: 68, l: 34, c: 65 }
        ],
        description: '第一根为长阴线，第二根为小实体K线（可阴可阳）且通常跳空低开，第三根为长阳线且收盘深入第一根实体内。如黎明前的晨星，预示黑暗即将结束。',
        note: '出现在下跌趋势末端，是经典的底部反转信号。第三根阳线收复第一根阴线实体越多，信号越强。',
        rules: ['第一根为长阴线', '第二根实体小，且低于第一根实体', '第三根阳线收复第一根实体一半以上']
    },
    {
        id: 'evening-star', name: '黄昏之星', engName: 'Evening Star',
        category: 'triple', signal: 'bearish',
        candles: [
            { o: 35, h: 62, l: 33, c: 58 },
            { o: 60, h: 68, l: 57, c: 63 },
            { o: 61, h: 63, l: 33, c: 37 }
        ],
        description: '第一根为长阳线，第二根为小实体K线且跳空高开，第三根为长阴线且收盘深入第一根实体内。如黄昏将至，预示上涨行情即将终结。',
        note: '出现在上涨趋势末端，是经典的顶部反转信号。与早晨之星互为镜像，同样可靠。',
        rules: ['第一根为长阳线', '第二根实体小，且高于第一根实体', '第三根阴线跌入第一根实体一半以上']
    },
    {
        id: 'morning-doji-star', name: '早晨十字星', engName: 'Morning Doji Star',
        category: 'triple', signal: 'bullish',
        candles: [
            { o: 65, h: 67, l: 33, c: 38 },
            { o: 36, h: 39, l: 27, c: 36 },
            { o: 40, h: 70, l: 38, c: 67 }
        ],
        description: '早晨之星的增强版，第二根为十字星。十字星代表极度犹豫，结合前后的长阴线和长阳线，反转信号极为强烈。',
        note: '比普通早晨之星更可靠，是非常有价值的底部信号。机构往往在此大量建仓。',
        rules: ['第二根必须为十字星', '十字星跳空低于第一根阴线实体', '第三根阳线大幅回升，越过第一根实体中点']
    },
    {
        id: 'evening-doji-star', name: '黄昏十字星', engName: 'Evening Doji Star',
        category: 'triple', signal: 'bearish',
        candles: [
            { o: 35, h: 65, l: 33, c: 60 },
            { o: 62, h: 68, l: 60, c: 62 },
            { o: 65, h: 67, l: 33, c: 38 }
        ],
        description: '黄昏之星的增强版，第二根为十字星。是顶部反转中最强烈的信号之一，十字星代表多空力量极度撕裂后的反转。',
        note: '可靠性极高的顶部信号。出现后若配合成交量缩量，说明做多意愿已消退，下跌概率极大。',
        rules: ['第二根必须为十字星', '十字星跳空高于第一根阳线实体', '第三根阴线大幅回落，越过第一根实体中点']
    },
    {
        id: 'rising-three', name: '上升三法', engName: 'Rising Three Methods',
        category: 'triple', signal: 'continuation',
        candles: [
            { o: 28, h: 74, l: 26, c: 70 },
            { o: 66, h: 72, l: 52, c: 56 },
            { o: 56, h: 65, l: 50, c: 54 },
            { o: 55, h: 62, l: 48, c: 52 },
            { o: 50, h: 82, l: 48, c: 79 }
        ],
        description: '第一根长阳线后跟随三根下跌的小K线（均在第一根实体内），最后一根长阳线突破前期高点。代表短暂调整后趋势延续。',
        note: '出现在上涨途中，表明主力在调整期间依然控盘。最后一根阳线确认突破后可以加仓。',
        rules: ['第一根为长阳线', '中间3根小K线在第一根范围内震荡', '最后一根阳线突破第一根高点', '整体处于上升趋势中']
    },
    {
        id: 'falling-three', name: '下降三法', engName: 'Falling Three Methods',
        category: 'triple', signal: 'continuation',
        candles: [
            { o: 72, h: 74, l: 28, c: 32 },
            { o: 34, h: 48, l: 30, c: 44 },
            { o: 42, h: 52, l: 38, c: 48 },
            { o: 46, h: 54, l: 40, c: 43 },
            { o: 50, h: 52, l: 20, c: 25 }
        ],
        description: '第一根长阴线后跟随三根上涨的小K线（均在第一根实体内），最后一根长阴线跌破前期低点。代表短暂反弹后继续下跌。',
        note: '出现在下跌途中，表明空头依然强势。最后一根阴线确认后可考虑做空或清仓。',
        rules: ['第一根为长阴线', '中间3根小K线在第一根范围内反弹', '最后一根阴线跌破第一根低点', '整体处于下降趋势中']
    },
    // ---- 趋势形态（多根K线，折线轮廓）----
    {
        id: 'double-top', name: '双顶（M顶）', engName: 'Double Top',
        category: 'multi', signal: 'bearish',
        trendLine: [20, 10, 25, 10, 30, 40, 35, 25, 40, 10, 45, 10, 50, 40, 55, 68, 60, 65, 65, 68, 70, 65, 75, 68, 80, 55, 85, 35, 90, 20],
        description: '价格上涨到某一高点，回落后再次上涨到相近高点，随后无法突破并下跌。两个高点连成"M"形，颈线为两者之间的低点。',
        note: '颈线被有效跌破后，下跌目标约等于顶部到颈线的距离。颈线突破时成交量放大是关键确认信号。',
        rules: ['两个高点高度相近（差距<3%）', '颈线被明确跌破才确认形态', '第二个高点成交量通常低于第一个', '颈线突破后可能回踩确认']
    },
    {
        id: 'double-bottom', name: '双底（W底）', engName: 'Double Bottom',
        category: 'multi', signal: 'bullish',
        trendLine: [20, 78, 25, 78, 30, 48, 35, 65, 40, 78, 45, 78, 50, 48, 55, 28, 60, 32, 65, 28, 70, 32, 75, 45, 80, 62, 85, 72, 90, 78],
        description: '价格下跌到某一低点，反弹后再次下跌到相近低点，随后无法跌破并上涨。两个低点连成"W"形，颈线为两者之间的高点。',
        note: '颈线被有效突破后，上涨目标约等于底部到颈线的距离。是常见的底部反转信号，可靠性较高。',
        rules: ['两个低点深度相近', '颈线被有效突破才确认形态', '第二个低点成交量通常低于第一个', '颈线突破后成交量应放大']
    },
    {
        id: 'head-shoulders', name: '头肩顶', engName: 'Head & Shoulders Top',
        category: 'multi', signal: 'bearish',
        trendLine: [15, 60, 20, 50, 25, 30, 30, 15, 35, 30, 40, 45, 45, 50, 50, 20, 55, 10, 60, 20, 65, 40, 70, 45, 75, 35, 80, 50, 85, 68, 90, 78],
        description: '由左肩（较小高点）、头部（最高高点）、右肩（较小高点）组成，颈线连接两个低点。是技术分析中最经典的顶部反转形态。',
        note: '颈线被跌破时，下跌目标等于头部到颈线的距离。跌破颈线后可能回踩，是确认后的卖出时机。',
        rules: ['头部高于两肩', '两肩高度大致相当', '颈线跌破时成交量应明显放大', '右肩成交量通常低于左肩']
    },
    {
        id: 'inv-head-shoulders', name: '头肩底', engName: 'Inverse Head & Shoulders',
        category: 'multi', signal: 'bullish',
        trendLine: [15, 38, 20, 48, 25, 68, 30, 82, 35, 68, 40, 53, 45, 48, 50, 78, 55, 88, 60, 78, 65, 55, 70, 53, 75, 62, 80, 48, 85, 30, 90, 20],
        description: '头肩顶的镜像，由左肩（较小低点）、头部（最低低点）、右肩（较小低点）组成。颈线连接两个高点。',
        note: '颈线突破时，上涨目标等于头部到颈线的距离。是下跌趋势转为上涨的可靠信号。',
        rules: ['头部低于两肩', '两肩深度大致相当', '颈线突破时成交量放大', '右肩通常成交量较低']
    }
];

// ========== K线图鉴 - Canvas绘制 ==========

/**
 * 绘制K线形态示意图到 canvas
 * @param {HTMLCanvasElement} canvas
 * @param {Object} pattern - 形态数据
 * @param {boolean} isDetail - 是否为详情模式（较大尺寸）
 */
function drawPatternCanvas(canvas, pattern, isDetail = false) {
    const ctx = canvas.getContext('2d');
    // canvas.width/height 是物理像素，需除以 dpr 得到逻辑像素坐标
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.width / dpr;
    const H = canvas.height / dpr;

    // 清空
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#04080f';
    ctx.fillRect(0, 0, W, H);

    // 如果是折线趋势形态
    if (pattern.trendLine) {
        drawTrendLine(ctx, W, H, pattern.trendLine, pattern.signal);
        return;
    }

    const candles = pattern.candles;
    if (!candles || candles.length === 0) return;

    // 找出价格范围
    let minV = Infinity, maxV = -Infinity;
    for (const c of candles) {
        minV = Math.min(minV, c.l);
        maxV = Math.max(maxV, c.h);
    }
    const range = maxV - minV || 1;

    // 留边距
    const padTop = H * 0.1;
    const padBot = H * 0.1;
    const drawH = H - padTop - padBot;

    // 映射函数（价格→像素 y，价格越高 y 越小）
    const py = v => padTop + drawH * (1 - (v - minV) / range);

    // 蜡烛布局
    const n = candles.length;
    const totalW = W * 0.8;
    const startX = W * 0.1;
    const candleW = totalW / n;
    const bodyW = Math.max(candleW * 0.55, 4);

    for (let i = 0; i < n; i++) {
        const c = candles[i];
        const cx = startX + candleW * i + candleW / 2;
        const isBull = c.c >= c.o;
        const color = isBull ? '#f04444' : '#1ec870'; // A股：红涨绿跌

        const bodyTop = py(Math.max(c.o, c.c));
        const bodyBot = py(Math.min(c.o, c.c));
        const bodyH = Math.max(bodyBot - bodyTop, 1.5);
        const wickTop = py(c.h);
        const wickBot = py(c.l);

        // 影线
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = isDetail ? 1.5 : 1;
        ctx.moveTo(cx, wickTop);
        ctx.lineTo(cx, bodyTop);
        ctx.moveTo(cx, bodyBot);
        ctx.lineTo(cx, wickBot);
        ctx.stroke();

        // 实体
        ctx.fillStyle = color;
        ctx.fillRect(cx - bodyW / 2, bodyTop, bodyW, bodyH);

        // 十字星（开盘=收盘）：画一条横线
        if (Math.abs(c.o - c.c) < 0.5) {
            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.lineWidth = isDetail ? 2 : 1.5;
            ctx.moveTo(cx - bodyW / 2, py(c.o));
            ctx.lineTo(cx + bodyW / 2, py(c.o));
            ctx.stroke();
        }
    }
}

/**
 * 绘制趋势折线形态（双顶/双底/头肩等）
 * pairs: [x0, y0, x1, y1, ...] 坐标对（归一化0-100）
 */
function drawTrendLine(ctx, W, H, pairs, signal) {
    const padX = W * 0.05;
    const padY = H * 0.1;
    const drawW = W - padX * 2;
    const drawH = H - padY * 2;

    // 转换坐标
    const pts = [];
    for (let i = 0; i < pairs.length; i += 2) {
        pts.push({
            x: padX + (pairs[i] / 100) * drawW,
            y: padY + (pairs[i + 1] / 100) * drawH
        });
    }

    // 渐变颜色
    const col = signal === 'bullish' ? '#f04444' : signal === 'bearish' ? '#1ec870' : '#f0a030';
    const grad = ctx.createLinearGradient(0, padY, 0, H - padY);
    grad.addColorStop(0, col + '55');
    grad.addColorStop(1, col + '00');

    // 填充区域
    ctx.beginPath();
    ctx.moveTo(pts[0].x, H - padY);
    ctx.lineTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.lineTo(pts[pts.length - 1].x, H - padY);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // 折线
    ctx.beginPath();
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.stroke();
}

// ========== K线图鉴 - 页面逻辑 ==========

let patternFilter = { cat: 'all', signal: 'all' };

function enterPatterns() {
    showView('view-patterns');
    renderPatternGrid();
}

function renderPatternGrid() {
    const grid = document.getElementById('patterns-grid');
    const filtered = KLINE_PATTERNS.filter(p => {
        const catOk = patternFilter.cat === 'all' || p.category === patternFilter.cat;
        const sigOk = patternFilter.signal === 'all' || p.signal === patternFilter.signal;
        return catOk && sigOk;
    });

    document.getElementById('patterns-count').textContent = filtered.length;

    if (filtered.length === 0) {
        grid.innerHTML = '<div class="patterns-empty">暂无符合条件的形态</div>';
        return;
    }

    grid.innerHTML = '';

    const signalLabels = { bullish: '看涨', bearish: '看跌', neutral: '中性', continuation: '持续' };
    const catLabels = { single: '单根', double: '双根', triple: '三根', multi: '趋势' };

    filtered.forEach((p, idx) => {
        const card = document.createElement('div');
        card.className = 'pattern-card';
        card.style.animationDelay = (idx * 0.04) + 's';

        const canvas = document.createElement('canvas');
        canvas.className = 'pattern-card-canvas';
        // 设置canvas实际分辨率（考虑dpr）
        const dpr = window.devicePixelRatio || 1;
        canvas.width = 160 * dpr;
        canvas.height = 120 * dpr;
        canvas.style.width = '100%';
        canvas.style.height = '120px';
        canvas.getContext('2d').scale(dpr, dpr);

        card.innerHTML = `
            <div class="pattern-card-info">
                <div class="pattern-card-name">${p.name}</div>
                <div class="pattern-card-engname">${p.engName}</div>
                <div class="pattern-card-badges">
                    <span class="signal-badge ${p.signal}">${signalLabels[p.signal] || p.signal}</span>
                    <span class="cat-badge">${catLabels[p.category] || p.category}</span>
                </div>
            </div>
        `;
        card.prepend(canvas);

        // 延迟绘制（等DOM插入后）
        setTimeout(() => drawPatternCanvas(canvas, p), 10);

        card.addEventListener('click', () => showPatternDetail(p));
        grid.appendChild(card);
    });
}

function showPatternDetail(p) {
    const modal = document.getElementById('pattern-detail-modal');
    const signalLabels = { bullish: '📈 看涨', bearish: '📉 看跌', neutral: '⚖️ 中性', continuation: '🔄 趋势延续' };
    const catLabels = { single: '单根K线', double: '双根组合', triple: '三根组合', multi: '趋势形态' };

    document.getElementById('pd-name').textContent = p.name;
    document.getElementById('pd-engname').textContent = p.engName;

    const typeBadge = document.getElementById('pd-type-badge');
    typeBadge.textContent = signalLabels[p.signal] || p.signal;
    typeBadge.className = `signal-badge ${p.signal}`;

    document.getElementById('pd-cat-badge').textContent = catLabels[p.category] || p.category;
    document.getElementById('pd-description').textContent = p.description;
    document.getElementById('pd-note').textContent = p.note;

    const rulesList = document.getElementById('pd-rules');
    const rulesSection = document.getElementById('pd-rules-section');
    if (p.rules && p.rules.length > 0) {
        rulesList.innerHTML = p.rules.map(r => `<li>${r}</li>`).join('');
        rulesSection.style.display = '';
    } else {
        rulesSection.style.display = 'none';
    }

    modal.classList.add('show');

    // 绘制详情Canvas
    requestAnimationFrame(() => {
        const dc = document.getElementById('pattern-detail-canvas');
        const dpr = window.devicePixelRatio || 1;
        dc.width = 160 * dpr;
        dc.height = 120 * dpr;
        dc.style.width = '160px';
        dc.style.height = '120px';
        dc.getContext('2d').scale(dpr, dpr);
        drawPatternCanvas(dc, p, true);
    });
}

function hidePatternDetail() {
    document.getElementById('pattern-detail-modal').classList.remove('show');
}

// ========== 事件绑定 ==========

function bindEvents() {
    // 登录
    document.getElementById('btn-enter').addEventListener('click', handleLogin);
    document.getElementById('nickname-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleLogin();
    });

    // 大厅
    document.getElementById('btn-new-game').addEventListener('click', startNewGame);
    document.getElementById('btn-logout').addEventListener('click', handleLogout);
    document.getElementById('btn-history').addEventListener('click', () => {
        history.pushState({ view: 'view-history' }, '');
        showView('view-history');
        loadHistory();
    });
    document.getElementById('btn-goto-rank').addEventListener('click', () => {
        history.pushState({ view: 'view-ranking' }, '');
        showView('view-ranking');
        loadRankings('total');
    });

    // 游戏
    document.getElementById('btn-game-back').addEventListener('click', async () => {
        if (state.gameId && state.currentDay > 0) {
            if (confirm('退出将放弃当前游戏，确定吗？')) {
                await api('/api/game/abandon', { game_id: state.gameId, user_id: state.user?.id });
                state.gameId = null;
                enterLobby();
            }
        } else if (state.gameId && state.currentDay === 0) {
            await api('/api/game/abandon', { game_id: state.gameId, user_id: state.user?.id });
            state.gameId = null;
            enterLobby();
        } else {
            enterLobby();
        }
    });

    document.getElementById('btn-next-day').addEventListener('click', handleNextDay);
    document.getElementById('btn-buy').addEventListener('click', () => showTradeModal('buy'));
    document.getElementById('btn-sell').addEventListener('click', () => showTradeModal('sell'));

    // 图表模式切换
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.chartMode = btn.dataset.mode;
            updateChart();
        });
    });

    // 副图指标切换
    document.querySelectorAll('.sub-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.sub-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.subChart = btn.dataset.sub;
            updateChart();
        });
    });

    // 交易弹窗
    document.getElementById('btn-modal-cancel').addEventListener('click', hideTradeModal);
    document.getElementById('btn-modal-confirm').addEventListener('click', executeTrade);
    document.getElementById('trade-modal').addEventListener('click', (e) => {
        if (e.target.id === 'trade-modal') hideTradeModal();
    });

    document.querySelectorAll('.pct-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.pct-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.tradePct = parseInt(btn.dataset.pct);
            updateTradePreview();
        });
    });

    // 结算页
    document.getElementById('btn-play-again').addEventListener('click', () => {
        state.gameId = null;
        startNewGame();
    });
    document.getElementById('btn-pk-same').addEventListener('click', () => {
        if (state.scenarioId) {
            challengeStock(state.scenarioId);
        }
    });
    document.getElementById('btn-back-lobby').addEventListener('click', () => {
        state.gameId = null;
        enterLobby();
    });
    document.getElementById('btn-view-rank').addEventListener('click', () => {
        history.pushState({ view: 'view-ranking' }, '');
        showView('view-ranking');
        loadRankings('total');
    });

    // 排行榜
    document.getElementById('btn-rank-back').addEventListener('click', () => history.back());
    document.querySelectorAll('.rank-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.rank-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            loadRankings(tab.dataset.tab);
        });
    });

    // 历史（使用浏览器历史API返回）
    document.getElementById('btn-history-back').addEventListener('click', () => {
        history.back();
    });

    // 底部导航
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const view = item.dataset.view;
            if (view === 'lobby') {
                enterLobby();
            } else if (view === 'ranking') {
                history.pushState({ view: 'view-ranking' }, '');
                showView('view-ranking');
                loadRankings('total');
            } else if (view === 'patterns') {
                history.pushState({ view: 'view-patterns' }, '');
                enterPatterns();
            }
        });
    });

    // 图鉴页面
    document.getElementById('btn-patterns-back').addEventListener('click', () => {
        history.back();
    });

    document.querySelectorAll('.pattern-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.pattern-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            patternFilter.cat = btn.dataset.cat;
            renderPatternGrid();
        });
    });

    document.querySelectorAll('.signal-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.signal-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            patternFilter.signal = btn.dataset.signal;
            renderPatternGrid();
        });
    });

    document.getElementById('btn-close-pattern-detail').addEventListener('click', hidePatternDetail);
    document.getElementById('pattern-detail-modal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) hidePatternDetail();
    });
}

/** 退出登录 */
function handleLogout() {
    if (state.gameId) {
        if (!confirm('当前有进行中的游戏，退出将放弃游戏。确定退出吗？')) return;
        api('/api/game/abandon', { game_id: state.gameId, user_id: state.user?.id }).catch(() => {});
    }
    // 清除状态
    state.user = null;
    state.gameId = null;
    state.scenarioId = null;
    state.klineData = [];
    state.currentDay = 0;
    state.cash = 100000;
    state.shares = 0;
    state.avgCost = 0;
    state.marketData = null;
    state.sectorData = null;
    state.sector = '';
    state.legendSelected = {};
    // 清理图表
    if (state.chart) { state.chart.dispose(); state.chart = null; }
    // 清除本地存储
    localStorage.removeItem('kmaster_user');
    // 返回登录页
    document.getElementById('nickname-input').value = '';
    showView('view-login');
}

// ========== 浏览器导航处理 ==========

function handleBrowserBack(e) {
    const s = e.state;
    if (!s || !s.view) {
        if (state.user) enterLobby();
        else showView('view-login');
        return;
    }
    switch (s.view) {
        case 'view-lobby':
            state.historyDetailMode = false;
            if (state.user) enterLobby();
            else showView('view-login');
            break;
        case 'view-history':
            state.historyDetailMode = false;
            showView('view-history');
            loadHistory();
            break;
        case 'view-ranking':
            showView('view-ranking');
            loadRankings('total');
            break;
        case 'view-patterns':
            enterPatterns();
            break;
        case 'view-result':
            // 结算页回退到大厅
            if (state.user) enterLobby();
            break;
        default:
            if (state.user) enterLobby();
            break;
    }
}

// ========== 初始化 ==========

document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    window.addEventListener('popstate', handleBrowserBack);

    // 迁移旧版单用户数据到新版历史列表
    const legacySaved = localStorage.getItem('kmaster_user');
    if (legacySaved) {
        try {
            const legacyUser = JSON.parse(legacySaved);
            // 如果历史列表里还没有这个用户，把他加进去
            const recent = getRecentUsers();
            if (!recent.find(u => u.id === legacyUser.id)) {
                saveRecentUser(legacyUser);
            }
        } catch (e) {
            localStorage.removeItem('kmaster_user');
        }
    }

    // 始终显示登录页（带历史用户快速登录），不再静默跳转
    renderRecentUsers();
    history.replaceState({ view: 'view-login' }, '');
});
