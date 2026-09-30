# FK Signal Hunter

> Personal real-time market intelligence, signal detection and automated trading system.

**FK Signal Hunter**, kripto piyasalarında gerçek zamanlı verileri analiz ederek yüksek kaliteli işlem fırsatlarını tespit etmek için geliştirilen kişisel bir trading sistemidir.

Sistem; fiyat hareketini tek başına tahmin etmeye çalışmak yerine **order book, gerçekleşen işlemler, alış/satış baskısı, hacim anomalileri, likidite, spread, komisyon ve slippage** gibi verileri birlikte değerlendirir.

Amaç, mümkün olduğunca düşük işlem maliyetiyle, yalnızca yeterli istatistiksel avantaj oluştuğunda işlem gerçekleştiren bir sistem geliştirmektir.

---

## 🎯 Ana Hedef

Başlangıç sermayesi:

**1.000 TL**

Sisteme başlangıçtan sonra ek sermaye koymadan, elde edilen getiriyi kontrollü şekilde yeniden kullanarak sermayeyi büyütmek hedeflenmektedir.

> Bu bir garanti edilmiş kazanç sistemi değildir. Amaç pozitif beklenen değere sahip, ölçülebilir ve test edilebilir bir strateji geliştirmektir.

Sistem **all-in işlem yapmaz**.

Her işlemde sermayenin yalnızca belirlenen bir bölümü kullanılır ve risk yönetimi işlem motorunun zorunlu bir parçasıdır.

---

# 🧠 Sistem Nasıl Çalışır?

FK Signal Hunter temel olarak şu akışı kullanır:

```text
Exchange WebSocket APIs
          │
          ▼
   Market Data Engine
          │
          ├── Price
          ├── Trades
          ├── Order Book
          ├── Volume
          ├── Spread
          └── Liquidity
          │
          ▼
     Signal Engine
          │
          ├── Buy/Sell Pressure
          ├── Order Book Imbalance
          ├── Volume Anomaly
          ├── Trade Flow
          ├── Order Persistence
          ├── Momentum
          └── Cross-Market Confirmation
          │
          ▼
      Fee Analyzer
          │
          ├── Maker Fee
          ├── Taker Fee
          ├── Spread
          └── Slippage
          │
          ▼
      Risk Engine
          │
          ├── Position Size
          ├── Stop Loss
          ├── Take Profit
          ├── Max Daily Loss
          └── Max Open Positions
          │
          ▼
    Paper Trading Engine
          │
          ▼
     Performance Engine
          │
          ▼
      Web Dashboard
```

---

# 💰 Fee-First Strategy

Sistemin en önemli özelliklerinden biri işlem maliyetlerini mümkün olduğunca düşürmektir.

Bir işlem yalnızca fiyat hareketine göre değerlendirilmez.

Gerçek net sonuç:

```text
Gross Profit
- Trading Fee
- Spread Cost
- Slippage
= Net Profit
```

Sistem mümkün olduğunda:

* düşük komisyonlu marketleri
* maker/taker ücretlerini
* kampanyalı veya sıfır-komisyonlu işlem çiftlerini
* spread seviyesini
* order book derinliğini
* beklenen slippage'ı

karşılaştıracaktır.

### Önemli

"0% fee" tek başına yeterli değildir.

Örneğin:

```text
Fee        = 0.00%
Spread     = 0.08%
Slippage   = 0.05%
```

ise gerçek işlem maliyeti hâlâ vardır.

Bu nedenle sistem **effective trading cost** hesaplayacaktır.

---

# 📡 Market Data

İlk aşamada spot piyasalar hedeflenmektedir.

Öncelikli işlem çifti:

```text
BTC/USDT
```

Daha sonra likiditesi uygun diğer pariteler eklenebilir.

Sistem gerçek zamanlı olarak:

* Bid
* Ask
* Spread
* Order Book
* Executed Trades
* Trade Volume
* Buy Volume
* Sell Volume
* Price Momentum
* Volume Momentum
* Liquidity
* Order Book Imbalance

verilerini toplayacaktır.

---

# 🔎 Signal Engine

Signal Engine farklı piyasa sinyallerini birleştirerek **0–100 arasında bir Signal Score** oluşturacaktır.

Örnek:

```text
Volume Anomaly             +20
Market Buy Pressure        +20
Order Book Imbalance       +15
Sell Absorption             +15
Order Persistence           +10
Short-Term Momentum         +10
Cross-Market Confirmation   +5
Spread Quality              +5
--------------------------------
Total                       100
```

Bu değerler başlangıç parametreleridir.

Gerçek ağırlıklar backtest ve paper trading sonuçlarına göre optimize edilecektir.

Örnek:

```text
Signal Score: 87/100

Volume:              6.4x
Buy Pressure:        71%
Order Imbalance:     +38%
Momentum:            +0.42%
Spread:              0.01%
Liquidity:            HIGH
```

Bot yalnızca belirlenen minimum skorun üzerindeki sinyalleri değerlendirecektir.

---

# ⚠️ Fake Order Protection

Order book'taki büyük bir alış emri tek başına alım sinyali olarak kabul edilmeyecektir.

Çünkü büyük emirler iptal edilebilir veya piyasayı yanıltabilir.

Sistem mümkün olduğunca:

* gerçekleşen işlemleri
* emirlerin ne kadar süre kaldığını
* emirlerin tekrar oluşturulmasını
* satışların alış tarafında absorbe edilmesini
* gerçek market buy/sell akışını

birlikte değerlendirecektir.

---

# 📊 Paper Trading

Gerçek para ile işlem yapmadan önce sistem paper trading modunda çalışacaktır.

Paper Trading:

```text
LIVE MARKET DATA
       ↓
SIGNAL
       ↓
VIRTUAL BUY
       ↓
VIRTUAL SELL
       ↓
P&L
       ↓
STATISTICS
```

Paper trading sırasında:

* entry
* exit
* signal score
* position size
* fee
* spread
* slippage
* gross P&L
* net P&L
* reason for entry
* reason for exit

kaydedilecektir.

---

# 📈 Performance Metrics

Sistem yalnızca toplam kâra bakmayacaktır.

Takip edilecek temel metrikler:

* Total P&L
* Net P&L
* Win Rate
* Average Win
* Average Loss
* Profit Factor
* Expectancy
* Maximum Drawdown
* Average Trade
* Number of Trades
* Commission Paid
* Slippage
* Average Holding Time
* Signal Score Performance

Ayrıca farklı signal score aralıkları ayrı ayrı analiz edilecektir.

Örneğin:

```text
Score 70–75
Score 75–80
Score 80–85
Score 85–90
Score 90–100
```

Böylece hangi sinyal seviyelerinin gerçekten anlamlı olduğu test edilecektir.

---

# 🛡️ Risk Management

Sistem hiçbir zaman otomatik olarak tüm bakiyeyi tek işleme yatırmayacaktır.

Temel risk kontrolleri:

```text
Maximum Position Size
Maximum Open Positions
Maximum Daily Loss
Stop Loss
Take Profit
Minimum Liquidity
Maximum Spread
Maximum Slippage
```

Örnek başlangıç değerleri:

```text
Position Size:       10–20%
Max Open Positions:  1–2
Daily Loss Limit:    ~1.5%
Stop Loss:           strategy dependent
Take Profit:         strategy dependent
```

Bu değerler sabit kabul edilmeyecek ve test sonuçlarına göre değiştirilecektir.

---

# 🖥️ Web Dashboard

Sistem mobil uygulama yerine öncelikle web dashboard olarak geliştirilecektir.

## Dashboard

Gösterilecek temel bilgiler:

```text
Balance
Available Balance
Open Positions
Today's P&L
Total P&L
Win Rate
Profit Factor
Expectancy
Max Drawdown
Bot Status
```

## Live Signals

```text
BTC/USDT
Signal Score: 87
Buy Pressure: 71%
Volume: 6.4x
Spread: 0.01%
Liquidity: HIGH
```

Her sinyalin neden oluştuğu görülebilecektir.

## Trade History

```text
Pair
Entry
Exit
Position Size
Signal Score
Fee
Slippage
Gross P&L
Net P&L
Duration
Result
```

## Performance

Dashboard üzerinde:

* Equity Curve
* Daily P&L
* Weekly P&L
* Monthly P&L
* Win/Loss distribution
* Drawdown
* Signal performance
* Coin performance

görüntülenecektir.

## Bot Controls

```text
START BOT
PAUSE BOT
STOP BOT
CLOSE ALL
```

Acil durumda:

```text
EMERGENCY STOP
```

kullanılabilecektir.

---

# 🔔 Notifications

İlerleyen aşamada Telegram bildirimleri eklenecektir.

Örnek:

```text
🚨 NEW SIGNAL

BTC/USDT

Score: 89/100
Buy Pressure: 74%
Volume: 7.1x
Spread: 0.01%

Potential Entry: 104,250
TP: 106,335
SL: 103,415

Status: PAPER TRADE
```

---

# 🏗️ Project Architecture

Önerilen yapı:

```text
fk-signal-hunter/
│
├── backend/
│   ├── api/
│   ├── data/
│   ├── exchanges/
│   ├── signals/
│   ├── strategy/
│   ├── risk/
│   ├── execution/
│   ├── paper/
│   └── database/
│
├── frontend/
│   ├── dashboard/
│   ├── signals/
│   ├── trades/
│   ├── performance/
│   └── settings/
│
├── tests/
│
├── docs/
│
├── config/
│
├── .env.example
├── .gitignore
├── docker-compose.yml
└── README.md
```

---

# 🔐 Security

API anahtarları kesinlikle repository içerisinde tutulmayacaktır.

`.env` kullanılacaktır.

Örnek:

```env
EXCHANGE_API_KEY=
EXCHANGE_API_SECRET=
DATABASE_URL=
TELEGRAM_BOT_TOKEN=
```

Exchange API izinleri mümkün olduğunca:

```text
READ
TRADE
```

ile sınırlandırılacaktır.

**WITHDRAW / TRANSFER izinleri kullanılmayacaktır.**

API anahtarları GitHub'a kesinlikle gönderilmeyecektir.

---

# 🧪 Testing Strategy

Gerçek para ile işlem yapılmadan önce:

### Phase 1

Live market data.

### Phase 2

Signal detection.

### Phase 3

Paper trading.

### Phase 4

Backtesting.

### Phase 5

500+ paper trades.

### Phase 6

Walk-forward testing.

### Phase 7

Küçük sermaye ile kontrollü gerçek işlem.

Gerçek para aşamasına ancak sistem:

* komisyon sonrası pozitif expectancy
* kabul edilebilir drawdown
* yeterli işlem sayısı
* farklı piyasa koşullarında tutarlı sonuç

gösterirse geçecektir.

---

# 🚀 Development Roadmap

## Phase 1 — Foundation
- [x] Repository setup
- [x] Backend API
- [x] Frontend dashboard
- [x] Environment configuration
- [x] Paper-trading dashboard

## Phase 2 — Market Data
- [x] Multi-exchange WebSocket hub
- [x] Top-100 market universe
- [x] Bid/Ask
- [x] Order Book
- [x] Executed Trades
- [x] Buy/Sell Flow
- [x] Volume anomaly
- [x] Spread
- [x] Exchange feed health
- [x] Automatic reconnect / heartbeat handling

## Phase 3 — Signal Engine
- [x] Buy/Sell pressure
- [x] Volume anomaly
- [x] Order-book imbalance
- [x] Large liquidity detection
- [x] Order persistence / pull / replenishment
- [x] Trade flow
- [x] Short-term momentum
- [x] Absorption detection
- [x] Cross-exchange confirmation
- [x] Signal Score
- [x] Fee-aware opportunity estimation

## Phase 4 — Cost & Execution Model
- [x] Exchange fee profiles
- [x] Spread-aware entry/exit
- [x] Slippage model
- [x] Order-book depth fills
- [x] Net P&L accounting
- [x] Entry/exit fee accounting

## Phase 5 — Paper Trading
- [x] Virtual wallet
- [x] Virtual positions
- [x] TP/SL
- [x] Position limits
- [x] Daily loss limit
- [x] Cooldown
- [x] Trade history
- [x] P&L
- [x] Drawdown tracking
- [x] Signal → Entry metrics

## Phase 6 — Historical Validation
- [x] Historical data collector
- [x] Historical data loader
- [x] Backtesting engine
- [x] Walk-forward testing
- [x] Out-of-sample metrics
- [ ] Collect enough live paper-trading history
- [ ] Validate strategy on 500–1000+ paper trades

## Phase 7 — Dashboard
- [x] Live market dashboard
- [x] Signal radar
- [x] Paper trade history
- [x] Performance metrics
- [x] Risk / feed-health dashboard
- [x] Walk-forward results
- [x] Live signal diagnostics
- [x] Frontend build validation in CI
- [ ] Equity curve visualization
- [ ] Extended signal / coin analytics

## Phase 8 — Optional Live Trading
- [ ] Exchange API credentials
- [ ] Real order execution
- [ ] Position protection
- [ ] Emergency stop
- [ ] Notifications
- [ ] Small controlled live-money validation

**Current state:** The paper-trading system and dashboard are implemented. The next milestone is live-data verification and accumulating statistically meaningful paper-trading results. Real-money trading is deliberately disabled.

# ⚡ Core Principle

FK Signal Hunter'ın temel prensibi:

> **Daha fazla işlem yapmak değil, maliyeti düşük ve istatistiksel avantajı yüksek işlemleri seçmek.**

Botun işlem yapması zorunlu değildir.

```text
NO SIGNAL
    ↓
NO TRADE
```

Bazı günler hiç işlem yapılmaması, kötü bir işlem yapmaktan daha iyidir.

---

# ⚠️ Disclaimer

FK Signal Hunter kişisel bir yazılım projesidir.

Geçmiş performans gelecekteki sonuçları garanti etmez.

Hiçbir sinyal veya strateji risksiz ya da garantili kâr sağlayan bir sistem olarak kabul edilmemelidir.

Gerçek para ile işlem yapılmadan önce kapsamlı backtest ve paper trading yapılmalıdır.

---

## Project

**FK Signal Hunter**

Personal Market Intelligence & Automated Trading System.

**Status:** 🧪 Paper Trading / Validation
