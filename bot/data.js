/**
 * Data sources.
 *  - synthetic(): deterministic-ish random walk for offline backtests/demo.
 *  - fetchBinanceKlines(): real OHLC candles from Binance public REST API
 *    (no API key needed; read-only public market data).
 */

export function synthetic({ bars = 400, start = 100, seed = 42 } = {}) {
  // simple seeded PRNG (mulberry32) so demo is reproducible
  let s = seed >>> 0;
  const rand = () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const candles = [];
  let price = start;
  let trend = 0;
  const now = Date.now();
  for (let i = 0; i < bars; i++) {
    // occasionally flip a gentle trend so crossovers actually happen
    if (i % 40 === 0) trend = (rand() - 0.5) * 0.6;
    const drift = trend;
    const shock = (rand() - 0.5) * 4;
    const open = price;
    price = Math.max(1, price + drift + shock);
    const high = Math.max(open, price) + rand() * 2;
    const low = Math.min(open, price) - rand() * 2;
    candles.push({
      time: now - (bars - i) * 60_000,
      open, high, low: Math.max(0.5, low), close: price,
    });
  }
  return candles;
}

/**
 * Fetch real candles from Binance public API.
 * symbol e.g. "BTCUSDT", interval e.g. "1h", limit up to 1000.
 */
export async function fetchBinanceKlines({ symbol = 'BTCUSDT', interval = '1h', limit = 500 } = {}) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'banpuen-bot/1.0' } });
  if (!res.ok) {
    throw new Error(`Binance API error ${res.status}: ${await res.text()}`);
  }
  const raw = await res.json();
  // [ openTime, open, high, low, close, volume, closeTime, ... ]
  return raw.map(k => ({
    time: k[0],
    open: +k[1],
    high: +k[2],
    low: +k[3],
    close: +k[4],
    volume: +k[5],
  }));
}

/** Get the latest single price (for paper-trading live tick). */
export async function fetchBinancePrice(symbol = 'BTCUSDT') {
  const url = `https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'banpuen-bot/1.0' } });
  if (!res.ok) throw new Error(`Binance price error ${res.status}`);
  const j = await res.json();
  return +j.price;
}
