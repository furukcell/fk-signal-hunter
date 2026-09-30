# FK Signal Hunter Backend

The backend is currently **read-only market intelligence**. It does not place real orders.

## Current scanner

The scanner builds a dynamic universe of up to **100 large-cap crypto assets**:

1. CoinGecko provides the market-cap ranking.
2. Binance exchange metadata determines which assets have an active USDT spot market.
3. The scanner intersects the two lists and keeps up to 100 tradable assets.
4. Stablecoin-only assets are excluded from the trading universe.
5. The universe refreshes every 5 minutes.

For the selected universe:

- best bid / ask
- executed trades
- 24h volume
- spread
- buy/sell pressure
- rolling 60-second flow

are collected continuously.

The top 20 market-cap candidates additionally receive a 20-level order-book stream for imbalance analysis. This keeps the first version manageable while still giving deeper order-book information to the most important assets.

## API

- `GET /health`
- `GET /api/market/scanner`
- `GET /api/market/btcusdt`
- `POST /api/market/reset-flow`

## Initial signal engine

The first rule-based score combines:

1. Executed buy/sell pressure
2. Top-20 order-book imbalance when available
3. Bid/ask spread quality
4. 24h quote-volume context

The score is currently informational:

- **82+** -> WATCH
- **70-81** -> MONITOR
- **below 70** -> WAIT

These thresholds are starting parameters, not validated trading rules. They must be backtested and paper-tested before any real-money use.

## Important limitation

Order-book walls can be cancelled or spoofed. Therefore book imbalance is never treated as a standalone buy signal. Executed trade flow and later persistence/replenishment measurements will be added before the strategy is considered mature.

Exchange credentials are intentionally not required at this stage.
## Firebase statistics storage

Firebase is optional. If no Firebase credentials are set, the backend runs normally without Firebase writes.

When enabled, only important events are persisted:

- actionable signal snapshots (`signals`)
- completed paper trades (`paperTrades`)
- compact daily aggregates (`dailyStats`)

Raw exchange trade/order-book events are **not** written to Firebase. High-frequency market calculations remain in the backend.

### Recommended secret setup

For GitHub Actions or another deployment environment, store the complete Firebase service-account JSON as a secret named:

`FIREBASE_SERVICE_ACCOUNT_JSON`

The backend parses that JSON directly. The service-account file itself must **never** be committed to the repository.

For local development, you can instead set `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY` in `backend/.env`.

A signal is recorded once when it becomes actionable (with a 5-minute per-symbol persistence guard), then its observed price outcome is stored at 1m, 5m, 15m and 30m checkpoints. Daily signal and paper-trading aggregates are flushed periodically rather than on every market event.
