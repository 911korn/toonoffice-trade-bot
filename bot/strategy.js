import { sma, rsi } from './indicators.js';

/**
 * SMA crossover strategy with an RSI filter.
 *
 * Signal rules (long-only):
 *   BUY  when fast SMA crosses ABOVE slow SMA, and RSI is not overbought.
 *   SELL when fast SMA crosses BELOW slow SMA, OR RSI is overbought.
 *
 * @param {number[]} closes - array of closing prices
 * @param {object} cfg
 * @returns {Array<'BUY'|'SELL'|'HOLD'>} signal per bar (aligned to closes)
 */
export function smaCrossSignals(closes, cfg = {}) {
  const {
    fast = 10,
    slow = 30,
    rsiPeriod = 14,
    rsiOverbought = 70,
    rsiOversold = 30,
  } = cfg;

  const fastMa = sma(closes, fast);
  const slowMa = sma(closes, slow);
  const rsiArr = rsi(closes, rsiPeriod);

  const signals = new Array(closes.length).fill('HOLD');

  for (let i = 1; i < closes.length; i++) {
    const f0 = fastMa[i - 1], s0 = slowMa[i - 1];
    const f1 = fastMa[i], s1 = slowMa[i];
    if (f0 == null || s0 == null || f1 == null || s1 == null) continue;

    const crossedUp = f0 <= s0 && f1 > s1;
    const crossedDown = f0 >= s0 && f1 < s1;
    const r = rsiArr[i];

    if (crossedUp && (r == null || r < rsiOverbought)) {
      signals[i] = 'BUY';
    } else if (crossedDown || (r != null && r > rsiOverbought)) {
      signals[i] = 'SELL';
    } else if (r != null && r < rsiOversold && f1 > s1) {
      // momentum continuation buy when oversold but trend is up
      signals[i] = 'BUY';
    }
  }

  return { signals, fastMa, slowMa, rsiArr };
}
