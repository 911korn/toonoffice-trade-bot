/**
 * Backtest / paper-trading engine.
 * Long-only, single-position, with fees and basic risk management
 * (stop-loss & take-profit on percentage basis).
 */

export function backtest(candles, signals, cfg = {}) {
  const {
    initialCash = 10000,
    feePct = 0.001,        // 0.1% per trade
    riskPerTrade = 1.0,    // fraction of cash to deploy per buy (1.0 = all-in)
    stopLossPct = 0,       // 0 = disabled, e.g. 0.05 = 5%
    takeProfitPct = 0,     // 0 = disabled
  } = cfg;

  let cash = initialCash;
  let position = 0;        // units held
  let entryPrice = 0;
  const trades = [];
  const equityCurve = [];

  const buy = (price, time, reason) => {
    if (position > 0 || cash <= 0) return;
    const spend = cash * riskPerTrade;
    const fee = spend * feePct;
    const units = (spend - fee) / price;
    position = units;
    entryPrice = price;
    cash -= spend;
    trades.push({ type: 'BUY', time, price, units, fee, reason });
  };

  const sell = (price, time, reason) => {
    if (position <= 0) return;
    const gross = position * price;
    const fee = gross * feePct;
    const proceeds = gross - fee;
    const cost = position * entryPrice;
    const pnl = proceeds - cost;
    cash += proceeds;
    trades.push({
      type: 'SELL', time, price, units: position, fee, reason,
      pnl, pnlPct: cost ? (pnl / cost) * 100 : 0,
    });
    position = 0;
    entryPrice = 0;
  };

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const price = c.close;
    const time = c.time;

    // risk management checks while holding
    if (position > 0) {
      if (stopLossPct > 0 && price <= entryPrice * (1 - stopLossPct)) {
        sell(price, time, 'STOP_LOSS');
      } else if (takeProfitPct > 0 && price >= entryPrice * (1 + takeProfitPct)) {
        sell(price, time, 'TAKE_PROFIT');
      }
    }

    const sig = signals[i];
    if (sig === 'BUY') buy(price, time, 'SIGNAL');
    else if (sig === 'SELL') sell(price, time, 'SIGNAL');

    const equity = cash + position * price;
    equityCurve.push({ time, equity, price });
  }

  // liquidate at the end for reporting
  const last = candles[candles.length - 1];
  if (position > 0 && last) sell(last.close, last.time, 'EOD');

  return summarize(trades, equityCurve, initialCash, cash);
}

function summarize(trades, equityCurve, initialCash, finalCash) {
  const sells = trades.filter(t => t.type === 'SELL');
  const wins = sells.filter(t => t.pnl > 0);
  const losses = sells.filter(t => t.pnl <= 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));

  // max drawdown from equity curve
  let peak = -Infinity, maxDD = 0;
  for (const e of equityCurve) {
    if (e.equity > peak) peak = e.equity;
    const dd = peak > 0 ? (peak - e.equity) / peak : 0;
    if (dd > maxDD) maxDD = dd;
  }

  const finalEquity = equityCurve.length
    ? equityCurve[equityCurve.length - 1].equity
    : finalCash;
  const totalReturnPct = ((finalEquity - initialCash) / initialCash) * 100;

  return {
    initialCash,
    finalEquity: round(finalEquity),
    totalReturnPct: round(totalReturnPct),
    trades,
    numTrades: sells.length,
    winRatePct: sells.length ? round((wins.length / sells.length) * 100) : 0,
    profitFactor: grossLoss ? round(grossProfit / grossLoss) : (grossProfit > 0 ? Infinity : 0),
    maxDrawdownPct: round(maxDD * 100),
    equityCurve,
  };
}

const round = (n) => Math.round(n * 100) / 100;
