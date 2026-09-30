# FK Signal Hunter Backend

The backend is currently **read-only market intelligence**. It does not place real orders.

## Current market pipeline

`BTC/USDT` public market streams:

- best bid / ask
- top 20 bid / ask levels
- executed trades
- 60-second rolling executed-flow window

The backend exposes:

- `GET /health`
- `GET /api/market/btcusdt`
- `POST /api/market/reset-flow`

## Initial signal engine

The first rule-based score combines:

1. Executed buy/sell pressure
2. Top-20 order-book imbalance
3. Bid/ask spread quality

The score is currently informational:

- **82+** → WATCH
- **70–81** → MONITOR
- **below 70** → WAIT

These thresholds are starting parameters, not validated trading rules. They must be backtested and paper-tested before any real-money use.

## Important limitation

Order-book walls can be cancelled or spoofed. Therefore book imbalance is never treated as a standalone buy signal. Executed trade flow and later persistence/replenishment measurements will be added before the strategy is considered mature.

Exchange credentials are intentionally not required at this stage.
