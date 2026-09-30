import WebSocket from "ws";
import { gunzipSync } from "node:zlib";

const EXCHANGE_NAMES = [
  "binance", "coinbase", "upbit", "okx", "bybit",
  "bitget", "gate", "kucoin", "mexc", "htx"
];

const QUOTE_PRIORITY = ["USDT", "USDC", "USD", "KRW"];
const MAX_SYMBOLS_PER_CONNECTION = 80;


function readVarint(buf, index) {
  let value = 0n;
  let shift = 0n;
  let i = index;
  while (i < buf.length) {
    const byte = buf[i++];
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7n;
    if (shift > 70n) throw new Error("protobuf varint too long");
  }
  return [value, i];
}

function readProtoFields(buf) {
  const fields = new Map();
  let i = 0;
  while (i < buf.length) {
    const [key, next] = readVarint(buf, i);
    i = next;
    const fieldNo = Number(key >> 3n);
    const wire = Number(key & 7n);
    let value;
    if (wire === 0) {
      [value, i] = readVarint(buf, i);
      value = Number(value);
    } else if (wire === 2) {
      const [len, afterLen] = readVarint(buf, i);
      i = afterLen;
      const end = i + Number(len);
      if (end > buf.length) throw new Error("protobuf length overflow");
      value = buf.subarray(i, end);
      i = end;
    } else if (wire === 1) {
      i += 8;
    } else if (wire === 5) {
      i += 4;
    } else {
      throw new Error("unsupported protobuf wire type " + wire);
    }
    const list = fields.get(fieldNo) || [];
    list.push(value);
    fields.set(fieldNo, list);
  }
  return fields;
}

function bytesText(value) {
  return Buffer.from(value || []).toString("utf8");
}

function decodeMexcWrapper(data) {
  const fields = readProtoFields(data);
  const channel = bytesText(fields.get(1)?.[0]);
  const symbol = bytesText(fields.get(3)?.[0]);
  const sendTime = Number(fields.get(6)?.[0] || 0);
  const deals = [];
  for (const raw of fields.get(314) || []) {
    const f = readProtoFields(raw);
    for (const item of f.get(1) || []) {
      const x = readProtoFields(item);
      deals.push({
        price: bytesText(x.get(1)?.[0]),
        quantity: bytesText(x.get(2)?.[0]),
        tradeType: Number(x.get(3)?.[0] || 0),
        time: Number(x.get(4)?.[0] || sendTime)
      });
    }
  }
  let book = null;
  const rawBook = fields.get(315)?.[0];
  if (rawBook) {
    const f = readProtoFields(rawBook);
    book = {
      bidPrice: bytesText(f.get(1)?.[0]),
      bidQuantity: bytesText(f.get(2)?.[0]),
      askPrice: bytesText(f.get(3)?.[0]),
      askQuantity: bytesText(f.get(4)?.[0])
    };
  }
  return { channel, symbol, sendTime, deals, book };
}

function cleanBase(symbol) {
  return String(symbol || "").toUpperCase().replace(/[-_/]/g, "").replace(/USDT|USDC|USD|KRW|BTC|EUR$/, "");
}

function normalize({ exchange, symbol, baseAsset, quoteAsset, price, bid, ask, side, qty, ts, source = "trade" }) {
  const p = Number(price);
  const b = Number(bid);
  const a = Number(ask);
  const q = Number(qty);
  return {
    exchange, symbol, baseAsset, quoteAsset,
    price: Number.isFinite(p) ? p : null,
    bid: Number.isFinite(b) ? b : null,
    ask: Number.isFinite(a) ? a : null,
    spreadPct: Number.isFinite(b) && Number.isFinite(a) && b > 0 ? ((a - b) / b) * 100 : null,
    side: side === "buy" || side === "sell" ? side : null,
    qty: Number.isFinite(q) ? q : null,
    quoteQty: Number.isFinite(q) && Number.isFinite(p) ? q * p : null,
    ts: Number(ts) || Date.now(),
    source
  };
}

class CrossExchangeHub {
  constructor({ bases = [], onEvent = () => {} }) {
    this.bases = [...new Set(bases.map(x => String(x).toUpperCase()))];
    this.onEvent = onEvent;
    this.connections = new Map();
    this.latest = new Map();
    this.status = new Map();
  }

  key(exchange, base) {
    return exchange + ":" + base;
  }

  setBases(bases) {
    this.bases = [...new Set(bases.map(x => String(x).toUpperCase()))];
    this.reconnectAll();
  }

  start() {
    this.stop();
    for (const exchange of EXCHANGE_NAMES) this.connectExchange(exchange);
  }

  stop() {
    for (const ws of this.connections.values()) {
      try { ws.close(); } catch {}
    }
    this.connections.clear();
    for (const exchange of EXCHANGE_NAMES) this.status.set(exchange, "offline");
  }

  reconnectAll() {
    this.stop();
    setTimeout(() => this.start(), 250);
  }

  snapshot() {
    const rows = [];
    for (const base of this.bases) {
      const venues = {};
      for (const exchange of EXCHANGE_NAMES) {
        const value = this.latest.get(this.key(exchange, base));
        if (value) venues[exchange] = value;
      }
      rows.push({ baseAsset: base, exchanges: venues });
    }
    return rows;
  }

  emit(event) {
    if (!event?.baseAsset || !event.exchange) return;
    const key = this.key(event.exchange, event.baseAsset);
    const prev = this.latest.get(key) || {};
    const next = { ...prev, ...event, updatedAt: Date.now() };
    this.latest.set(key, next);
    this.onEvent(next);
  }

  mark(exchange, state) {
    this.status.set(exchange, state);
  }

  getStatus() {
    return Object.fromEntries(EXCHANGE_NAMES.map(x => [x, this.status.get(x) || "offline"]));
  }

  async connectExchange(exchange) {
    try {
      const fn = this["connect_" + exchange];
      if (!fn) throw new Error("adapter missing");
      await fn.call(this);
    } catch (error) {
      this.mark(exchange, "error");
      setTimeout(() => this.connectExchange(exchange), 5000);
    }
  }

  attach(exchange, ws, onMessage, heartbeatMs = 0) {
    this.connections.set(exchange, ws);
    this.mark(exchange, "connecting");
    let heartbeat;
    ws.on("open", () => {
      this.mark(statusName, "live");
      if (heartbeatMs) heartbeat = setInterval(() => {
        try { if (ws.readyState === WebSocket.OPEN) ws.ping(); } catch {}
      }, heartbeatMs);
    });
    ws.on("message", data => {
      try { onMessage(data); } catch {}
    });
    ws.on("close", () => {
      if (heartbeat) clearInterval(heartbeat);
      this.mark(statusName, "offline");
      this.connections.delete(connectionKey);
      setTimeout(() => this.connectExchange(exchange), 3000);
    });
    ws.on("error", () => this.mark(statusName, "error"));
  }

  async connect_binance() {
    const symbols = this.bases.map(x => x.toLowerCase() + "usdt");
    const streams = [];
    for (const s of symbols) {
      streams.push(s + "@trade", s + "@bookTicker");
    }
    for (let i = 0; i < streams.length; i += 160) {
      const chunk = streams.slice(i, i + 160);
      const ws = new WebSocket("wss://stream.binance.com:443/stream?streams=" + chunk.join("/"));
      this.attach("binance", ws, data => {
        const msg = JSON.parse(data.toString()).data;
        if (!msg) return;
        const symbol = String(msg.s || "");
        const base = symbol.endsWith("USDT") ? symbol.slice(0, -4) : "";
        if (!base) return;
        if (msg.e === "trade") {
          this.emit(normalize({
            exchange: "binance", symbol, baseAsset: base, quoteAsset: "USDT",
            price: msg.p, qty: msg.q, side: msg.m ? "sell" : "buy", ts: msg.T
          }));
        } else if (msg.e === "bookTicker") {
          this.emit(normalize({
            exchange: "binance", symbol, baseAsset: base, quoteAsset: "USDT",
            price: msg.b, bid: msg.b, ask: msg.a, ts: msg.E, source: "book"
          }));
        }
      });
    }
  }

  async connect_okx() {
    const args = [];
    for (const base of this.bases) {
      args.push({ channel: "trades", instId: base + "-USDT" });
      args.push({ channel: "tickers", instId: base + "-USDT" });
    }
    for (let i = 0; i < args.length; i += 120) {
      const ws = new WebSocket("wss://ws.okx.com:8443/ws/v5/public");
      const chunk = args.slice(i, i + 120);
      ws.on("open", () => ws.send(JSON.stringify({ op: "subscribe", args: chunk })));
      this.attach("okx", ws, data => {
        const msg = JSON.parse(data.toString());
        if (!msg.data?.length) return;
        const d = msg.data[0];
        const instId = d.instId || "";
        const base = instId.endsWith("-USDT") ? instId.slice(0, -5) : "";
        if (!base) return;
        if (msg.arg?.channel === "trades") {
          this.emit(normalize({
            exchange: "okx", symbol: instId, baseAsset: base, quoteAsset: "USDT",
            price: d.px, qty: d.sz, side: d.side, ts: d.ts
          }));
        } else if (msg.arg?.channel === "tickers") {
          this.emit(normalize({
            exchange: "okx", symbol: instId, baseAsset: base, quoteAsset: "USDT",
            price: d.last, bid: d.bidPx, ask: d.askPx, ts: d.ts, source: "book"
          }));
        }
      }, 18000);
    }
  }

  async connect_bybit() {
    const args = [];
    for (const base of this.bases) {
      args.push("publicTrade." + base + "USDT");
      args.push("tickers." + base + "USDT");
    }
    const ws = new WebSocket("wss://stream.bybit.com/v5/public/spot");
    ws.on("open", () => ws.send(JSON.stringify({ op: "subscribe", args })));
    this.attach("bybit", ws, data => {
      const msg = JSON.parse(data.toString());
      const topic = msg.topic || "";
      const parts = topic.split(".");
      const symbol = parts[parts.length - 1] || "";
      const base = symbol.endsWith("USDT") ? symbol.slice(0, -4) : "";
      if (!base || !msg.data) return;
      const d = Array.isArray(msg.data) ? msg.data[0] : msg.data;
      if (topic.startsWith("publicTrade.")) {
        this.emit(normalize({
          exchange: "bybit", symbol, baseAsset: base, quoteAsset: "USDT",
          price: d.p, qty: d.v, side: String(d.S || "").toLowerCase(), ts: d.T
        }));
      } else if (topic.startsWith("tickers.")) {
        this.emit(normalize({
          exchange: "bybit", symbol, baseAsset: base, quoteAsset: "USDT",
          price: d.lastPrice, bid: d.bid1Price, ask: d.ask1Price, ts: msg.ts, source: "book"
        }));
      }
    }, 18000);
  }

  async connect_bitget() {
    const args = [];
    for (const base of this.bases) {
      args.push({ instType: "SPOT", channel: "trade", instId: base + "USDT" });
      args.push({ instType: "SPOT", channel: "ticker", instId: base + "USDT" });
    }
    for (let i = 0; i < args.length; i += 80) {
      const ws = new WebSocket("wss://ws.bitget.com/v2/ws/public");
      const chunk = args.slice(i, i + 80);
      ws.on("open", () => ws.send(JSON.stringify({ op: "subscribe", args: chunk })));
      this.attach("bitget", ws, data => {
        const msg = JSON.parse(data.toString());
        const arg = msg.arg || {};
        const instId = arg.instId || "";
        const base = instId.endsWith("USDT") ? instId.slice(0, -4) : "";
        if (!base || !msg.data?.length) return;
        const d = msg.data[0];
        if (arg.channel === "trade") {
          this.emit(normalize({
            exchange: "bitget", symbol: instId, baseAsset: base, quoteAsset: "USDT",
            price: d.price, qty: d.size, side: String(d.side || "").toLowerCase(), ts: d.ts
          }));
        } else if (arg.channel === "ticker") {
          this.emit(normalize({
            exchange: "bitget", symbol: instId, baseAsset: base, quoteAsset: "USDT",
            price: d.lastPr, bid: d.bidPr, ask: d.askPr, ts: d.ts, source: "book"
          }));
        }
      }, 25000);
    }
  }

  async connect_gate() {
    const args = [];
    for (const base of this.bases) {
      args.push({ channel: "spot.trades", payload: [base + "_USDT"], event: "subscribe" });
      args.push({ channel: "spot.book_ticker", payload: [base + "_USDT"], event: "subscribe" });
    }
    const ws = new WebSocket("wss://api.gateio.ws/ws/v4/");
    ws.on("open", () => {
      for (const x of args) ws.send(JSON.stringify({ time: Math.floor(Date.now()/1000), ...x }));
    });
    this.attach("gate", ws, data => {
      const msg = JSON.parse(data.toString());
      const result = msg.result;
      const pair = Array.isArray(result) ? result[0]?.currency_pair : result?.currency_pair;
      const base = String(pair || "").endsWith("_USDT") ? String(pair).slice(0, -5) : "";
      if (!base) return;
      const d = Array.isArray(result) ? result[0] : result;
      if (msg.channel === "spot.trades") {
        this.emit(normalize({
          exchange: "gate", symbol: pair, baseAsset: base, quoteAsset: "USDT",
          price: d.price, qty: d.amount, side: String(d.side || "").toLowerCase(), ts: Number(d.create_time_ms || msg.time_ms)
        }));
      } else if (msg.channel === "spot.book_ticker") {
        this.emit(normalize({
          exchange: "gate", symbol: pair, baseAsset: base, quoteAsset: "USDT",
          price: d.last, bid: d.bid, ask: d.ask, ts: Number(msg.time_ms || Date.now()), source: "book"
        }));
      }
    }, 20000);
  }

  async connect_coinbase() {
    const products = [];
    for (const base of this.bases) {
      products.push(base + "-USDT");
      products.push(base + "-USD");
    }
    const ws = new WebSocket("wss://advanced-trade-ws.coinbase.com");
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "subscribe", product_ids: products, channel: "ticker",  }));
      ws.send(JSON.stringify({ type: "subscribe", product_ids: products, channel: "market_trades", api_key: "" }));
    });
    this.attach("coinbase", ws, data => {
      const msg = JSON.parse(data.toString());
      const events = msg.events || [];
      for (const event of events) {
        for (const t of event.tickers || event.trades || []) {
          const product = t.product_id || "";
          const quote = product.endsWith("-USDT") ? "USDT" : product.endsWith("-USD") ? "USD" : "";
          const base = quote ? product.slice(0, -(quote.length + 1)) : "";
          if (!base) continue;
          if (msg.channel === "market_trades") {
            this.emit(normalize({
              exchange: "coinbase", symbol: product, baseAsset: base, quoteAsset: quote,
              price: t.price, qty: t.size, side: String(t.side || "").toLowerCase(), ts: t.time
            }));
          } else {
            this.emit(normalize({
              exchange: "coinbase", symbol: product, baseAsset: base, quoteAsset: quote,
              price: t.price, bid: t.best_bid, ask: t.best_ask, ts: t.time, source: "book"
            }));
          }
        }
      }
    }, 20000);
  }

  async connect_upbit() {
    const codes = this.bases.map(x => "KRW-" + x);
    const ws = new WebSocket("wss://api.upbit.com/websocket/v1");
    ws.on("open", () => ws.send(JSON.stringify([
      { ticket: "fk-signal-hunter" },
      { type: "trade", codes },
      { type: "orderbook", codes },
      { format: "DEFAULT" }
    ])));
    this.attach("upbit", ws, data => {
      const msg = JSON.parse(data.toString());
      const code = msg.code || "";
      const base = code.startsWith("KRW-") ? code.slice(4) : "";
      if (!base) return;
      if (msg.type === "trade") {
        this.emit(normalize({
          exchange: "upbit", symbol: code, baseAsset: base, quoteAsset: "KRW",
          price: msg.trade_price, qty: msg.trade_volume,
          side: msg.ask_bid === "ASK" ? "sell" : "buy", ts: msg.trade_timestamp
        }));
      } else if (msg.type === "orderbook") {
        const unit = msg.orderbook_units?.[0];
        this.emit(normalize({
          exchange: "upbit", symbol: code, baseAsset: base, quoteAsset: "KRW",
          price: msg.total_ask_size && msg.total_bid_size ? unit?.ask_price : null,
          bid: unit?.bid_price, ask: unit?.ask_price, ts: msg.timestamp, source: "book"
        }));
      }
    }, 20000);
  }

  async connect_kucoin() {
    const res = await fetch("https://api.kucoin.com/api/v1/bullet-public");
    if (!res.ok) throw new Error("KuCoin token unavailable");
    const json = await res.json();
    const server = json.data?.instanceServers?.[0];
    const token = json.data?.token;
    if (!server || !token) throw new Error("KuCoin websocket configuration unavailable");
    const endpoint = server.endpoint + "?token=" + encodeURIComponent(token) + "&connectId=fk-signal-hunter";
    const ws = new WebSocket(endpoint);
    ws.on("open", () => {
      for (const base of this.bases) {
        ws.send(JSON.stringify({ id: Date.now().toString(), type: "subscribe", topic: "/market/match:" + base + "-USDT", response: true }));
        ws.send(JSON.stringify({ id: Date.now().toString(), type: "subscribe", topic: "/market/ticker:" + base + "-USDT", response: true }));
      }
    });
    this.attach("kucoin", ws, data => {
      const msg = JSON.parse(data.toString());
      const topic = msg.topic || "";
      const match = topic.match(/:(.+)$/);
      const symbol = match?.[1] || "";
      const base = symbol.endsWith("-USDT") ? symbol.slice(0, -5) : "";
      if (!base || !msg.data) return;
      if (topic.startsWith("/market/match:")) {
        this.emit(normalize({
          exchange: "kucoin", symbol, baseAsset: base, quoteAsset: "USDT",
          price: msg.data.price, qty: msg.data.size,
          side: String(msg.data.side || "").toLowerCase(), ts: msg.data.time
        }));
      } else if (topic.startsWith("/market/ticker:")) {
        this.emit(normalize({
          exchange: "kucoin", symbol, baseAsset: base, quoteAsset: "USDT",
          price: msg.data.price, bid: msg.data.bestBid, ask: msg.data.bestAsk, ts: msg.data.time, source: "book"
        }));
      }
    }, 15000);
  }

  async connect_mexc() {
    const channels = [];
    for (const base of this.bases) {
      channels.push("spot@public.aggre.deals.v3.api.pb@100ms@" + base + "USDT");
      channels.push("spot@public.aggre.bookTicker.v3.api.pb@100ms@" + base + "USDT");
    }
    for (let i = 0; i < channels.length; i += 30) {
      const chunk = channels.slice(i, i + 30);
      const ws = new WebSocket("wss://wbs-api.mexc.com/ws");
      ws.on("open", () => {
        ws.send(JSON.stringify({ method: "SUBSCRIPTION", params: chunk }));
      });
      this.attach("mexc-" + i, ws, data => {
        if (typeof data === "string") {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.code || msg.msg || msg.type === "PONG") return;
          } catch {}
          return;
        }
        const decoded = decodeMexcWrapper(Buffer.from(data));
        const symbol = decoded.symbol || "";
        const base = symbol.endsWith("USDT") ? symbol.slice(0, -4) : "";
        if (!base) return;
        for (const deal of decoded.deals) {
          this.emit(normalize({
            exchange: "mexc", symbol, baseAsset: base, quoteAsset: "USDT",
            price: deal.price, qty: deal.quantity,
            side: deal.tradeType === 1 ? "buy" : deal.tradeType === 2 ? "sell" : null,
            ts: deal.time
          }));
        }
        if (decoded.book) {
          this.emit(normalize({
            exchange: "mexc", symbol, baseAsset: base, quoteAsset: "USDT",
            price: decoded.book.bidPrice,
            bid: decoded.book.bidPrice, ask: decoded.book.askPrice,
            ts: decoded.sendTime, source: "book"
          }));
        }
      }, 20000);
    }
  }

  async connect_htx() {
    const ws = new WebSocket("wss://api.huobi.pro/ws");
    ws.on("open", () => {
      for (const base of this.bases) {
        const s = (base + "usdt").toLowerCase();
        ws.send(JSON.stringify({ sub: "market." + s + ".trade.detail", id: s + "-t" }));
        ws.send(JSON.stringify({ sub: "market." + s + ".bbo", id: s + "-b" }));
      }
    });
    this.attach("htx", ws, data => {
      const zlib = data;
      if (Buffer.isBuffer(zlib)) {
        try {
          const text = gunzipSync(zlib).toString("utf8");
          const msg = JSON.parse(text);
          if (msg.ping) { ws.send(JSON.stringify({ pong: msg.ping })); return; }
          const ch = msg.ch || "";
          const match = ch.match(/market\.([a-z0-9]+)\.(trade\.detail|bbo)/);
          const symbol = match?.[1]?.toUpperCase() || "";
          const base = symbol.endsWith("USDT") ? symbol.slice(0, -4) : "";
          if (!base || !msg.tick) return;
          if (match[2] === "trade.detail") {
            const t = msg.tick.data?.[0];
            if (t) this.emit(normalize({
              exchange: "htx", symbol, baseAsset: base, quoteAsset: "USDT",
              price: t.price, qty: t.amount, side: String(t.direction || "").toLowerCase(), ts: t.ts
            }));
          } else {
            this.emit(normalize({
              exchange: "htx", symbol, baseAsset: base, quoteAsset: "USDT",
              price: msg.tick.close, bid: msg.tick.bid, ask: msg.tick.ask, ts: msg.ts, source: "book"
            }));
          }
        } catch {}
      }
    }, 20000);
  }
}


export { CrossExchangeHub, EXCHANGE_NAMES };
