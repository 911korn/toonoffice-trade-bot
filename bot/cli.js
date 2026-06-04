#!/usr/bin/env node
/**
 * Banpuen Trade Bot — CLI
 *
 * Commands:
 *   backtest   Run a backtest over historical (or synthetic) candles.
 *   paper      Live paper-trade: poll the price, apply the strategy, no real money.
 *
 * Examples:
 *   node cli.js backtest --symbol BTCUSDT --interval 1h --limit 500
 *   node cli.js backtest --demo --bars 400
 *   node cli.js paper --symbol BTCUSDT --interval 1m --poll 15
 *
 * All flags are optional; sensible defaults are used.
 */

import { synthetic, fetchBinanceKlines, fetchBinancePrice } from './data.js';
import { smaCrossSignals } from './strategy.js';
import { backtest } from './engine.js';

// ---------- arg parsing ----------
function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        args[key] = true;            // boolean flag
      } else {
        args[key] = next;
        i++;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

const num = (v, d) => (v === undefined || v === true ? d : Number(v));
const str = (v, d) => (v === undefined || v === true ? d : String(v));

// ---------- pretty printing ----------
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', cyan: '\x1b[36m', yellow: '\x1b[33m',
};
const color = (s, c) => `${c}${s}${C.reset}`;
const pct = (n) => (n >= 0 ? color(`+${n}%`, C.green) : color(`${n}%`, C.red));

function printReport(res, cfg) {
  console.log('');
  console.log(color('═══ Backtest Report ═══', C.bold + C.cyan));
  console.log(`Strategy        : SMA(${cfg.fast}/${cfg.slow}) + RSI(${cfg.rsiPeriod})`);
  console.log(`Initial cash    : $${res.initialCash.toLocaleString()}`);
  console.log(`Final equity    : $${res.finalEquity.toLocaleString()}`);
  console.log(`Total return    : ${pct(res.totalReturnPct)}`);
  console.log(`Trades (closed) : ${res.numTrades}`);
  console.log(`Win rate        : ${res.winRatePct}%`);
  console.log(`Profit factor   : ${res.profitFactor}`);
  console.log(`Max drawdown    : ${color(res.maxDrawdownPct + '%', C.yellow)}`);
  console.log('');

  if (res.trades.length) {
    console.log(color('Recent trades:', C.bold));
    const recent = res.trades.slice(-10);
    for (const t of recent) {
      const when = new Date(t.time).toISOString().replace('T', ' ').slice(0, 16);
      const side = t.type === 'BUY' ? color('BUY ', C.green) : color('SELL', C.red);
      const extra = t.type === 'SELL'
        ? `  pnl ${t.pnl >= 0 ? color(t.pnl.toFixed(2), C.green) : color(t.pnl.toFixed(2), C.red)} (${t.pnlPct.toFixed(1)}%) [${t.reason}]`
        : `  [${t.reason}]`;
      console.log(`  ${when}  ${side} @ ${t.price.toFixed(2)}${extra}`);
    }
    console.log('');
  }
}

// ---------- commands ----------
async function loadCandles(args) {
  if (args.demo || str(args.symbol, '') === 'DEMO') {
    const bars = num(args.bars, 400);
    console.log(color(`Using synthetic data (${bars} bars).`, C.dim));
    return synthetic({ bars });
  }
  const symbol = str(args.symbol, 'BTCUSDT');
  const interval = str(args.interval, '1h');
  const limit = num(args.limit, 500);
  console.log(color(`Fetching ${symbol} ${interval} (${limit} candles) from Binance…`, C.dim));
  try {
    return await fetchBinanceKlines({ symbol, interval, limit });
  } catch (e) {
    console.error(color(`⚠ Could not reach Binance (${e.message}). Falling back to synthetic data.`, C.yellow));
    return synthetic({ bars: limit });
  }
}

function strategyCfg(args) {
  return {
    fast: num(args.fast, 10),
    slow: num(args.slow, 30),
    rsiPeriod: num(args.rsiPeriod, 14),
    rsiOverbought: num(args.rsiOverbought, 70),
    rsiOversold: num(args.rsiOversold, 30),
  };
}

function engineCfg(args) {
  return {
    initialCash: num(args.cash, 10000),
    feePct: num(args.fee, 0.001),
    riskPerTrade: num(args.risk, 1.0),
    stopLossPct: num(args.stop, 0),
    takeProfitPct: num(args.tp, 0),
  };
}

async function cmdBacktest(args) {
  const candles = await loadCandles(args);
  if (candles.length < 35) {
    console.error(color('Not enough candles to run the strategy.', C.red));
    process.exit(1);
  }
  const closes = candles.map(c => c.close);
  const sCfg = strategyCfg(args);
  const { signals } = smaCrossSignals(closes, sCfg);
  const res = backtest(candles, signals, engineCfg(args));
  printReport(res, sCfg);

  // Buy & hold comparison
  const bh = ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100;
  console.log(`${color('Buy & hold:', C.dim)} ${pct(Math.round(bh * 100) / 100)}`);
  console.log('');
}

async function cmdPaper(args) {
  const symbol = str(args.symbol, 'BTCUSDT');
  const interval = str(args.interval, '1m');
  const pollSec = num(args.poll, 15);
  const maxTicks = num(args.ticks, Infinity); // for tests/automation
  const sCfg = strategyCfg(args);
  const eCfg = engineCfg(args);

  console.log(color('═══ Paper Trading (no real money) ═══', C.bold + C.cyan));
  console.log(`Symbol ${symbol} | interval ${interval} | poll ${pollSec}s`);
  console.log(color('Press Ctrl-C to stop.', C.dim));
  console.log('');

  // seed with history so indicators are warm
  let candles;
  try {
    candles = await fetchBinanceKlines({ symbol, interval, limit: 200 });
  } catch (e) {
    console.error(color(`Could not fetch history: ${e.message}`, C.red));
    process.exit(1);
  }

  let cash = eCfg.initialCash;
  let position = 0;
  let entryPrice = 0;
  let ticks = 0;

  const step = async () => {
    let price;
    try {
      price = await fetchBinancePrice(symbol);
    } catch (e) {
      console.error(color(`tick error: ${e.message}`, C.yellow));
      return;
    }
    // update the rolling window with the live price as the latest close
    candles = [...candles.slice(-199), { time: Date.now(), open: price, high: price, low: price, close: price }];
    const closes = candles.map(c => c.close);
    const { signals } = smaCrossSignals(closes, sCfg);
    const sig = signals[signals.length - 1];

    const when = new Date().toISOString().replace('T', ' ').slice(11, 19);
    let action = 'HOLD';
    if (sig === 'BUY' && position === 0) {
      const spend = cash * eCfg.riskPerTrade;
      const fee = spend * eCfg.feePct;
      position = (spend - fee) / price;
      entryPrice = price;
      cash -= spend;
      action = color('BUY ', C.green);
    } else if (sig === 'SELL' && position > 0) {
      const gross = position * price;
      const fee = gross * eCfg.feePct;
      cash += gross - fee;
      const pnl = (gross - fee) - position * entryPrice;
      action = `${color('SELL', C.red)} pnl ${pnl >= 0 ? color(pnl.toFixed(2), C.green) : color(pnl.toFixed(2), C.red)}`;
      position = 0;
      entryPrice = 0;
    }
    const equity = cash + position * price;
    console.log(`${when}  ${symbol} $${price.toFixed(2)}  sig=${sig.padEnd(4)}  ${action}  equity=$${equity.toFixed(2)}`);

    ticks++;
    if (ticks >= maxTicks) {
      console.log(color('\nReached tick limit, stopping.', C.dim));
      process.exit(0);
    }
  };

  await step();
  setInterval(step, pollSec * 1000);
}

// ---------- main ----------
function help() {
  console.log(`
${C.bold}Banpuen Trade Bot${C.reset}

Usage:
  node cli.js backtest [options]
  node cli.js paper    [options]

Common options:
  --symbol <S>       market symbol (default BTCUSDT; use DEMO/--demo for synthetic)
  --interval <I>     candle interval: 1m,5m,15m,1h,4h,1d (default 1h)
  --limit <N>        number of candles to fetch (default 500)
  --demo             use offline synthetic data
  --bars <N>         bars for synthetic data (default 400)

Strategy options:
  --fast <N>         fast SMA period (default 10)
  --slow <N>         slow SMA period (default 30)
  --rsiPeriod <N>    RSI period (default 14)
  --rsiOverbought <N> default 70
  --rsiOversold <N>  default 30

Engine options:
  --cash <N>         initial cash (default 10000)
  --fee <F>          fee fraction per trade (default 0.001 = 0.1%)
  --risk <F>         fraction of cash deployed per buy (default 1.0)
  --stop <F>         stop-loss fraction, e.g. 0.05 (default off)
  --tp <F>           take-profit fraction, e.g. 0.1 (default off)

Paper options:
  --poll <S>         seconds between price polls (default 15)
  --ticks <N>        stop after N ticks (default unlimited)
`);
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const cmd = args._[0];

  try {
    switch (cmd) {
      case 'backtest': await cmdBacktest(args); break;
      case 'paper':    await cmdPaper(args); break;
      case undefined:
      case 'help':
      case '--help':
      case '-h':       help(); break;
      default:
        console.error(color(`Unknown command: ${cmd}`, C.red));
        help();
        process.exit(1);
    }
  } catch (e) {
    console.error(color(`Error: ${e.stack || e.message}`, C.red));
    process.exit(1);
  }
}

main();
