# Banpuen Trade Bot

A zero-dependency trading bot (Node 18+) with **backtesting** and **paper trading**.
Strategy: **SMA crossover** with an **RSI filter**. Long-only, single position,
with fees, stop-loss and take-profit risk management.

> ⚠️ Paper trading only — it never places real orders. It uses Binance public
> market data (no API key needed) and simulates fills with a virtual balance.

## Install / run

No dependencies to install. Requires Node ≥ 18 (uses built-in `fetch`).

```bash
cd bot

# Run the test suite
npm test

# Offline demo backtest (synthetic data, no network)
npm run demo

# Backtest real market data from Binance
node cli.js backtest --symbol BTCUSDT --interval 1h --limit 500

# Tune the strategy
node cli.js backtest --symbol ETHUSDT --interval 4h --fast 12 --slow 26 --stop 0.05 --tp 0.1

# Paper-trade live (no real money). Ctrl-C to stop.
node cli.js paper --symbol BTCUSDT --interval 1m --poll 15
```

## How it works

- **`indicators.js`** — pure functions: `sma`, `ema`, `rsi` (Wilder's smoothing).
- **`strategy.js`** — `smaCrossSignals()`: BUY on fast-above-slow crossover when
  RSI isn't overbought; SELL on the opposite crossover or RSI overbought.
- **`engine.js`** — `backtest()`: simulates trades with fees, stop-loss,
  take-profit; reports return, win rate, profit factor, max drawdown.
- **`data.js`** — `synthetic()` for offline demos and `fetchBinanceKlines()` /
  `fetchBinancePrice()` for real public market data.
- **`cli.js`** — command-line interface (`backtest` / `paper` / `help`).

## Options

Run `node cli.js help` for the full list of flags (symbol, interval, limit,
SMA/RSI periods, initial cash, fee, risk fraction, stop-loss, take-profit, poll).

## Disclaimer

For educational use only. Not financial advice. Past backtest performance does
not guarantee future results.
