import http from "node:http";
import WebSocket from "ws";

const PORT = Number(process.env.PORT || 3001);
const SYMBOL = "btcusdt";

const state = {
  symbol: "BTC/USDT",
  bid: null,
  ask: null,
  last: null,
  spreadPct: null,
  buyVolume: 0,
  sellVolume: 0,
  trades: 0,
  lastTradeAt: null,
  connected: false,
  updatedAt: null,
  error: null
};

function resetFlow() {
  state.buyVolume = 0;
  state.sellVolume = 0;
  state.trades = 0;
}

function connectMarketStream() {
  const ws = new WebSocket(
    `wss://stream.binance.com:9443/stream?streams=${SYMBOL}@bookTicker/${SYMBOL}@trade`
  );

  ws.on("open", () => {
    state.connected = true;
    state.error = null;
  });

  ws.on("message", raw => {
    try {
      const packet = JSON.parse(raw.toString());
      const data = packet.data;

      if (data.e === "bookTicker") {
        state.bid = Number(data.b);
        state.ask = Number(data.a);
        state.last = state.last ?? Number(data.a);
        state.spreadPct = state.bid > 0 ? ((state.ask - state.bid) / state.bid) * 100 : null;
      }

      if (data.e === "trade") {
        const qty = Number(data.q);
        state.last = Number(data.p);
        state.trades += 1;
        if (data.m) state.sellVolume += qty;
        else state.buyVolume += qty;
        state.lastTradeAt = new Date(data.T || Date.now()).toISOString();
      }

      state.updatedAt = new Date().toISOString();
    } catch {
      state.error = "Invalid market stream payload";
    }
  });

  ws.on("close", () => {
    state.connected = false;
    setTimeout(connectMarketStream, 1500);
  });

  ws.on("error", err => {
    state.connected = false;
    state.error = err.message;
    ws.close();
  });
}

function snapshot() {
  const total = state.buyVolume + state.sellVolume;
  return {
    ...state,
    buyPressurePct: total > 0 ? (state.buyVolume / total) * 100 : null,
    flowVolume: total
  };
}

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, marketStream: state.connected }));
  }

  if (req.url === "/api/market/btcusdt") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(snapshot()));
  }

  if (req.url === "/api/market/reset-flow" && req.method === "POST") {
    resetFlow();
    res.writeHead(204);
    return res.end();
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

connectMarketStream();
server.listen(PORT, () => console.log(`FK Signal Hunter API listening on :${PORT}`));
