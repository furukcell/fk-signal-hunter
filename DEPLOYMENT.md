# Production Deployment

## Requirements

- Linux VPS with Docker Engine + Docker Compose plugin
- Public server IP
- Domain is optional; IP can be used initially
- Firebase service-account JSON available as a server-side environment secret
- Binance/CoinGecko public API access

## 1. Clone

```bash
git clone https://github.com/furukcell/fk-signal-hunter.git
cd fk-signal-hunter
```

## 2. Backend environment

Create `backend/.env`.

At minimum:

```env
PORT=3001
FIREBASE_SERVICE_ACCOUNT_JSON={"project_id":"...","client_email":"...","private_key":"..."}
```

Do not commit `backend/.env`.

## 3. Start production stack

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Check containers:

```bash
docker compose -f docker-compose.prod.yml ps
```

Check backend:

```bash
curl http://127.0.0.1:3001/health
```

Check data health:

```bash
curl http://127.0.0.1:3001/api/data-health
```

The dashboard is exposed on port 80.

## 4. Logs

```bash
docker compose -f docker-compose.prod.yml logs -f backend
```

## 5. Updating

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

## Production checks

Before considering the deployment healthy:

- Backend container is healthy.
- Dashboard loads.
- Universe contains up to 100 assets.
- Exchange status is checked for all 10 adapters.
- At least 3 fresh exchanges cover a market before it becomes actionable.
- Firebase write errors remain zero.
- Paper mode remains enabled.
- No real exchange API trading keys are required.
- Historical JSONL data is persisted through the mounted volume.

## Important

This system is paper trading only. The production deployment must not be configured with withdrawal permissions or real-money trading credentials.
