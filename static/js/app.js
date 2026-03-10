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

        // 保存到localStorage
        localStorage.setItem('kmaster_user', JSON.stringify(state.user));

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
        const res = await api('/api/game/state', { game_id: gameId });
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
        state.financialInfo = res.financial_info || null;
        state.newsItems = res.news_items || [];
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
        renderNewsPanel();
    } catch (e) {
        showToast(e.message);
    }
}

/** 推进到下一天 */
async function handleNextDay() {
    try {
        const res = await api('/api/game/next_day', { game_id: state.gameId });

        if (res.status === 'finished') {
            // 游戏结束
            state.klineData = res.kline_data;
            state.financialInfo = res.financial_info || null;
            state.newsItems = res.news_items || [];
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
        state.financialInfo = res.financial_info || null;
        state.newsItems = res.news_items || [];

        updateChart();
        updateGameUI();
        renderNewsPanel();
    } catch (e) {
        showToast(e.message);
    }
}

/** 渲染资讯面板（财报快照 + 新闻列表） */
function renderNewsPanel() {
    const panel = document.getElementById('news-panel');
    const badge = document.getElementById('news-badge');
    const finSnapshot = document.getElementById('fin-snapshot');
    const finGrid = document.getElementById('fin-grid');
    const newsList = document.getElementById('news-list');
    const newsDivider = document.getElementById('news-divider');

    if (!panel) return;

    const hasFinInfo = state.financialInfo && Object.keys(state.financialInfo).length > 0;
    const newsItems = state.newsItems || [];
    const newsCount = newsItems.length;

    // 没有任何数据时隐藏面板
    if (!hasFinInfo && newsCount === 0) {
        panel.style.display = 'none';
        return;
    }
    panel.style.display = 'block';

    // 关闭展开状态（每次更新重置）
    const content = document.getElementById('news-content');
    const arrow = document.getElementById('news-arrow');
    const backdrop = document.getElementById('news-backdrop');
    if (content) content.classList.remove('open');
    if (arrow) arrow.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');

    // 更新徽章
    if (badge) {
        const total = newsCount + (hasFinInfo ? 1 : 0);
        badge.textContent = total;
        badge.style.display = total > 0 ? 'inline-block' : 'none';
    }

    // 渲染财报快照
    if (hasFinInfo && finSnapshot && finGrid) {
        const fi = state.financialInfo;
        finSnapshot.style.display = 'block';

        const finDate = document.getElementById('fin-date');
        if (finDate && fi.report_date) {
            finDate.textContent = fi.report_date;
        }

        // 格式化亿元
        const toYi = (val) => {
            if (val === null || val === undefined || val === '') return '--';
            const num = parseFloat(val);
            if (isNaN(num)) return '--';
            return (num / 100000000).toFixed(2) + '亿';
        };

        // 格式化百分比
        const toPct = (val) => {
            if (val === null || val === undefined || val === '') return '--';
            const num = parseFloat(val);
            if (isNaN(num)) return '--';
            return num.toFixed(2) + '%';
        };

        // 值的颜色类名
        const valClass = (val) => {
            if (val === null || val === undefined || val === '') return '';
            const num = parseFloat(val);
            if (isNaN(num)) return '';
            return num > 0 ? 'positive' : num < 0 ? 'negative' : '';
        };

        // 核心指标（紧凑 3×2 布局）
        const metrics = [
            { label: 'ROE', value: toPct(fi.roe), cls: valClass(fi.roe) },
            { label: '净利率', value: toPct(fi.net_margin), cls: valClass(fi.net_margin) },
            { label: '毛利率', value: toPct(fi.gross_margin), cls: valClass(fi.gross_margin) },
            { label: '营收增长', value: toPct(fi.revenue_growth), cls: valClass(fi.revenue_growth) },
            { label: '利润增长', value: toPct(fi.profit_growth), cls: valClass(fi.profit_growth) },
            { label: '负债率', value: toPct(fi.asset_liability_ratio), cls: '' },
        ];

        // 有营收/净利润则追加
        if (fi.revenue) {
            metrics.push({ label: '营收', value: toYi(fi.revenue), cls: '' });
        }
        if (fi.net_profit) {
            metrics.push({ label: '净利润', value: toYi(fi.net_profit), cls: valClass(fi.net_profit) });
        }

        finGrid.innerHTML = metrics.map(m => `
            <div class="fin-cell">
                <span class="fin-cell-label">${m.label}</span>
                <span class="fin-cell-value ${m.cls}">${m.value}</span>
            </div>
        `).join('');
    } else if (finSnapshot) {
        finSnapshot.style.display = 'none';
    }

    // 新闻分隔线（有财报且有新闻时显示）
    if (newsDivider) {
        newsDivider.style.display = (hasFinInfo && newsCount > 0) ? 'flex' : 'none';
    }

    // 渲染新闻列表
    if (newsList) {
        if (newsCount === 0) {
            newsList.innerHTML = '';
        } else {
            newsList.innerHTML = newsItems.map(item => {
                const isImportant = item.importance === 'important';
                const text = item.text || '';
                const itemDate = item.date || '';
                const shortDate = itemDate.length >= 10 ? itemDate.substring(5, 10) : itemDate;
                return `
                    <div class="news-item${isImportant ? ' important' : ''}">
                        <span class="news-date">${shortDate}</span>
                        <span class="news-dot${isImportant ? ' important' : ''}"></span>
                        <span class="news-text">${text}</span>
                    </div>
                `;
            }).join('');
        }
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
                color: '#ef4444',
                color0: '#22c55e',
                borderColor: '#ef4444',
                borderColor0: '#22c55e',
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
            itemStyle: { color: '#3b82f6' },
            lineStyle: { color: '#3b82f6', width: 1, opacity: 0.8 },
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
            itemStyle: { color: '#a855f7' },
            lineStyle: { color: '#a855f7', width: 1, opacity: 0.8 },
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
            { name: 'DEA', type: 'line', data: macdData.dea, xAxisIndex: 1, yAxisIndex: 1, symbol: 'none', lineStyle: { color: '#3b82f6', width: 1 }, z: 3 },
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
            { name: 'D', type: 'line', data: kdjData.d, xAxisIndex: 1, yAxisIndex: 1, symbol: 'none', lineStyle: { color: '#3b82f6', width: 1 }, z: 3 },
            { name: 'J', type: 'line', data: kdjData.j, xAxisIndex: 1, yAxisIndex: 1, symbol: 'none', lineStyle: { color: '#a855f7', width: 1 }, z: 3 }
        );
        legendData.push('K', 'D', 'J');
    } else if (subMode === 'trix') {
        // TRIX
        const trixData = calcTRIX(closes);
        series.push(
            { name: 'TRIX', type: 'line', data: trixData.trix, xAxisIndex: 1, yAxisIndex: 1, symbol: 'none', lineStyle: { color: '#f59e0b', width: 1 }, z: 3 },
            { name: 'MATRIX', type: 'line', data: trixData.matrix, xAxisIndex: 1, yAxisIndex: 1, symbol: 'none', lineStyle: { color: '#3b82f6', width: 1 }, z: 3 }
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
                itemStyle: { color: '#ef4444' },
                label: { show: true, position: 'bottom', formatter: 'B', color: '#ef4444', fontSize: 8, fontWeight: 700, distance: 2, textShadowColor: 'rgba(0,0,0,0.8)', textShadowBlur: 2 },
                z: 20
            });
        }
        if (sellPts.length) {
            series.push({
                name: '卖出', type: 'scatter', data: sellPts,
                xAxisIndex: 0, yAxisIndex: 0,
                symbol: 'circle', symbolSize: 6, symbolOffset: [0, -8],
                itemStyle: { color: '#3b82f6' },
                label: { show: true, position: 'top', formatter: 'S', color: '#3b82f6', fontSize: 8, fontWeight: 700, distance: 2, textShadowColor: 'rgba(0,0,0,0.8)', textShadowBlur: 2 },
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
            backgroundColor: 'rgba(20, 25, 35, 0.95)',
            borderColor: '#2a3347',
            textStyle: { color: '#e8ecf1', fontSize: 12 },
            formatter: function(params) {
                if (!params || !params.length) return '';
                const dayIdx = params[0].dataIndex;
                const d = data[dayIdx];
                let html = `<div style="font-size:11px;color:#8892a4;margin-bottom:4px;">Day ${dayIdx + 1}</div>`;
                html += `<div style="font-family:JetBrains Mono,monospace;font-size:12px;">`;
                html += `开: <span style="color:${d.close >= d.open ? '#ef4444' : '#22c55e'}">${d.open.toFixed(2)}</span><br>`;
                html += `高: <span style="color:#ef4444">${d.high.toFixed(2)}</span><br>`;
                html += `低: <span style="color:#22c55e">${d.low.toFixed(2)}</span><br>`;
                html += `收: <span style="color:${d.close >= d.open ? '#ef4444' : '#22c55e'};font-weight:700">${d.close.toFixed(2)}</span><br>`;
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
        itemStyle: { color: '#ef4444', color0: '#22c55e', borderColor: '#ef4444', borderColor0: '#22c55e', borderWidth: 1 },
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
            color: '#ef4444', color0: '#22c55e',
            borderColor: '#ef4444', borderColor0: '#22c55e', borderWidth: 1
        },
        barWidth: '50%'
    });

    // MA
    series.push(
        { name: 'MA5', type: 'line', data: ma5, smooth: true, symbol: 'none', itemStyle: { color: '#f59e0b' }, lineStyle: { color: '#f59e0b', width: 1, opacity: 0.8 }, z: 2 },
        { name: 'MA10', type: 'line', data: ma10, smooth: true, symbol: 'none', itemStyle: { color: '#3b82f6' }, lineStyle: { color: '#3b82f6', width: 1, opacity: 0.8 }, z: 2 },
        { name: 'MA20', type: 'line', data: ma20, smooth: true, symbol: 'none', itemStyle: { color: '#a855f7' }, lineStyle: { color: '#a855f7', width: 1, opacity: 0.8 }, z: 2 }
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
                itemStyle: { color: '#ef4444' },
                label: { show: true, position: 'bottom', formatter: 'B', color: '#ef4444', fontSize: 8, fontWeight: 700, distance: 2, textShadowColor: 'rgba(0,0,0,0.8)', textShadowBlur: 2 },
                z: 20
            });
        }
        if (sellPts.length) {
            series.push({
                name: '卖出', type: 'scatter', data: sellPts,
                symbol: 'circle', symbolSize: 6, symbolOffset: [0, -8],
                itemStyle: { color: '#3b82f6' },
                label: { show: true, position: 'top', formatter: 'S', color: '#3b82f6', fontSize: 8, fontWeight: 700, distance: 2, textShadowColor: 'rgba(0,0,0,0.8)', textShadowBlur: 2 },
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
                await api('/api/game/abandon', { game_id: state.gameId });
                state.gameId = null;
                enterLobby();
            }
        } else if (state.gameId && state.currentDay === 0) {
            await api('/api/game/abandon', { game_id: state.gameId });
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

    // 资讯面板折叠/展开（底部抽屉模式）
    const newsToggle = document.getElementById('news-toggle');
    const newsBackdrop = document.getElementById('news-backdrop');
    const newsSheetClose = document.getElementById('news-sheet-close');

    function toggleNewsSheet(forceClose) {
        const content = document.getElementById('news-content');
        const bd = document.getElementById('news-backdrop');
        const arrow = document.querySelector('#news-toggle .news-arrow');
        if (!content) return;
        const isOpen = content.classList.contains('open');
        const shouldClose = forceClose || isOpen;
        content.classList.toggle('open', !shouldClose);
        if (bd) bd.classList.toggle('open', !shouldClose);
        if (arrow) arrow.classList.toggle('open', !shouldClose);
    }

    if (newsToggle) {
        newsToggle.addEventListener('click', () => toggleNewsSheet());
    }
    if (newsBackdrop) {
        newsBackdrop.addEventListener('click', () => toggleNewsSheet(true));
    }
    if (newsSheetClose) {
        newsSheetClose.addEventListener('click', () => toggleNewsSheet(true));
    }

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
            }
        });
    });
}

/** 退出登录 */
function handleLogout() {
    if (state.gameId) {
        if (!confirm('当前有进行中的游戏，退出将放弃游戏。确定退出吗？')) return;
        api('/api/game/abandon', { game_id: state.gameId }).catch(() => {});
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

    // 尝试从localStorage恢复登录状态
    const saved = localStorage.getItem('kmaster_user');
    if (saved) {
        try {
            state.user = JSON.parse(saved);
            enterLobby();
            history.replaceState({ view: 'view-lobby' }, '');
        } catch (e) {
            localStorage.removeItem('kmaster_user');
            history.replaceState({ view: 'view-login' }, '');
        }
    } else {
        history.replaceState({ view: 'view-login' }, '');
    }
});
