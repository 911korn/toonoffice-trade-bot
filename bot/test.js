/**
 * Lightweight test suite — no test framework, just assertions.
 * Run with: node test.js
 */
import { sma, ema, rsi } from './indicators.js';
import { smaCrossSignals } from './strategy.js';
import { backtest } from './engine.js';
import { synthetic } from './data.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
  } else {
    failed++;
    console.log(`  \x1b[31m✗ ${msg}\x1b[0m`);
  }
}

function approx(a, b, eps = 1e-6) {
  return Math.abs(a - b) <= eps;
}

console.log('\nindicators: sma');
{
  const out = sma([1, 2, 3, 4, 5], 3);
  assert(out[0] === null && out[1] === null, 'pads start with null');
  assert(approx(out[2], 2), 'sma[2] = (1+2+3)/3 = 2');
  assert(approx(out[3], 3), 'sma[3] = (2+3+4)/3 = 3');
  assert(approx(out[4], 4), 'sma[4] = (3+4+5)/3 = 4');
}

console.log('indicators: ema');
{
  const out = ema([1, 2, 3, 4, 5, 6, 7, 8], 4);
  assert(out[2] === null, 'ema null before period');
  assert(approx(out[3], 2.5), 'ema seed = SMA of first 4 = 2.5');
  assert(out[4] > out[3], 'ema increases on rising series');
}

console.log('indicators: rsi');
{
  // strictly rising series -> RSI should be 100 (no losses)
  const rising = Array.from({ length: 20 }, (_, i) => i + 1);
  const out = rsi(rising, 14);
  assert(out[13] === null, 'rsi null before period+1');
  assert(approx(out[14], 100), 'rsi = 100 for monotonic rise');

  // strictly falling series -> RSI should be ~0
  const falling = Array.from({ length: 20 }, (_, i) => 20 - i);
  const outF = rsi(falling, 14);
  assert(approx(outF[14], 0), 'rsi = 0 for monotonic fall');
}

console.log('strategy: signals');
{
  const closes = synthetic({ bars: 200 }).map(c => c.close);
  const { signals, fastMa, slowMa } = smaCrossSignals(closes, { fast: 5, slow: 20 });
  assert(signals.length === closes.length, 'signals aligned to closes');
  assert(signals.every(s => ['BUY', 'SELL', 'HOLD'].includes(s)), 'only valid signal values');
  assert(fastMa.length === closes.length && slowMa.length === closes.length, 'MAs aligned');
  assert(signals.some(s => s === 'BUY') || signals.some(s => s === 'SELL'), 'produces at least one trade signal');
}

console.log('engine: backtest');
{
  const candles = synthetic({ bars: 300 });
  const closes = candles.map(c => c.close);
  const { signals } = smaCrossSignals(closes, { fast: 5, slow: 20 });
  const res = backtest(candles, signals, { initialCash: 10000 });
  assert(approx(res.initialCash, 10000), 'initial cash preserved');
  assert(typeof res.finalEquity === 'number' && res.finalEquity > 0, 'final equity is positive number');
  assert(res.winRatePct >= 0 && res.winRatePct <= 100, 'win rate within 0..100');
  assert(res.maxDrawdownPct >= 0, 'drawdown non-negative');
  assert(res.equityCurve.length === candles.length, 'equity curve per bar');
}

console.log('engine: stop-loss triggers');
{
  // a price series that drops sharply after a buy
  const candles = [
    { time: 1, open: 100, high: 100, low: 100, close: 100 },
    { time: 2, open: 100, high: 100, low: 100, close: 100 },
    { time: 3, open: 100, high: 100, low: 100, close: 80 }, // -20%
  ];
  // force a BUY on bar 1, then let stop-loss handle the rest
  const signals = ['BUY', 'HOLD', 'HOLD'];
  const res = backtest(candles, signals, { initialCash: 1000, stopLossPct: 0.05, feePct: 0 });
  const stopTrade = res.trades.find(t => t.reason === 'STOP_LOSS');
  assert(!!stopTrade, 'stop-loss sell executed');
  assert(res.finalEquity < 1000, 'equity reduced after stop-loss');
}

console.log(`\n${failed === 0 ? '\x1b[32m' : '\x1b[31m'}${passed} passed, ${failed} failed\x1b[0m\n`);
process.exit(failed === 0 ? 0 : 1);
