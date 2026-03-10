# K线大师 📈

> 一款基于真实 A 股数据的模拟交易游戏，练就你的盘感与判断力。

## 功能特色

- **K 线模拟交易** — 随机抽取真实 A 股走势，30 个交易日内自由买卖
- **技术指标** — 支持 MACD、KDJ、BOLL、TRIX 四种副图指标一键切换
- **财报快照** — 展示当期 ROE、净利率、毛利率、营收/利润增速等核心财务数据
- **AI 新闻摘要** — 自动抓取公司公告，经 AI（DeepSeek）精炼为一句话摘要
- **排行榜** — 全局收益率排名，争夺最强操盘手
- **历史记录** — 回顾每一局的走势和买卖点（红色 B 买 / 蓝色 S 卖）
- **PK 对比** — 同一场景不同玩家走势叠加对比
- **深色主题** — 精心设计的深色 UI，A 股红涨绿跌配色
- **手机适配** — 移动端优先设计，随时随地开一局

## 截图预览

| 交易主界面 | 资讯抽屉 |
|:---:|:---:|
| K 线图 + 技术指标 + 买卖操作 | 财报快照 + 公告动态 |

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Python / Flask / SQLite |
| 前端 | 原生 HTML + CSS + JavaScript |
| 图表 | ECharts 5.5 |
| 数据源 | [AKShare](https://github.com/akfamily/akshare)（A 股行情 + 财报 + 公告） |
| AI 摘要 | DeepSeek（通过 LiteLLM 代理） |

## 快速开始

### 1. 克隆仓库

```bash
git clone https://github.com/duxingx1a/k-simulator.git
cd k-simulator
```

### 2. 安装依赖

```bash
pip install flask akshare
```

### 3. 初始化数据（首次运行）

如果仓库中已包含 `game.db`，可跳过此步。否则运行：

```bash
python init_data.py
```

这会从 AKShare 拉取 25 只 A 股的历史行情，生成 75 个游戏场景。

### 4. 补充财报 & 新闻数据（可选）

```bash
python add_financial_data.py   # 下载季度财报指标
python add_news_data.py        # 下载公告 + AI 摘要（需要 LiteLLM API）
```

### 5. 启动服务

```bash
python app.py
```

打开 http://localhost:5000 即可游玩。

## 项目结构

```
k-simulator/
├── app.py                  # Flask 后端（API + 路由）
├── stock_data.py           # A 股数据管理器
├── init_data.py            # 初始化场景数据脚本
├── add_financial_data.py   # 财报数据下载脚本
├── add_news_data.py        # 新闻/公告下载 + AI 摘要脚本
├── add_sector_data.py      # 板块数据下载脚本
├── add_sector_index.py     # 板块指数数据脚本
├── game.db                 # SQLite 数据库（场景 + 用户 + 游戏 + 财报 + 新闻）
├── requirements.txt        # Python 依赖
├── templates/
│   └── index.html          # 单页应用 HTML
└── static/
    ├── css/style.css       # 全局样式（深色主题）
    └── js/
        ├── app.js          # 前端逻辑（图表 + 交互 + 指标计算）
        └── echarts.min.js  # ECharts 图表库
```

## 游戏玩法

1. 输入昵称进入游戏大厅
2. 点击「开始挑战」随机分配一只股票的历史走势
3. 每天可选择：**买入** / **卖出** / **下一天**
4. 支持切换 K 线图 / 净值图 / 叠加模式
5. 查看 MACD、KDJ、TRIX 等技术指标辅助判断
6. 展开「资讯」查看财报数据和公司公告
7. 30 天后结算，收益率计入排行榜

## License

MIT
