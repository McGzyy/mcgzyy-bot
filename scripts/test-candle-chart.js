'use strict';

/** Quick OHLCV + PNG sanity check (run from repo root: node scripts/test-candle-chart.js [poolAddress]) */

const pair =
  process.argv[2] ||
  'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE'; // SOL/USDC-ish sample pool

async function main() {
  const { fetchOhlcv } = require('../utils/ohlcvFetcher');
  const { renderCandlestickChart } = require('../utils/candlestickChart');

  const bars = await fetchOhlcv({
    chain: 'solana',
    pairAddress: pair,
    interval: '5m',
    limit: 48
  });

  console.log('bars', Array.isArray(bars) ? bars.length : bars);
  if (!Array.isArray(bars) || bars.length < 2) {
    process.exit(1);
  }
  const first = bars[0];
  const last = bars[bars.length - 1];
  console.log('first', first);
  console.log('last', last);

  const buf = await renderCandlestickChart(bars, {
    title: 'test',
    width: 640,
    height: 360
  });
  console.log('png bytes', buf ? buf.length : null);
  process.exit(buf && buf.length > 500 ? 0 : 2);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
