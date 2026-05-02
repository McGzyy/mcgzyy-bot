'use strict';
const { renderCandlestickChart } = require('../utils/candlestickChart');
const now = Date.now();
const candles = [];
for (let i = 0; i < 15; i++) {
  candles.push({
    time: now - (15 - i) * 300000,
    open: 83.8,
    high: 84,
    low: 83.7,
    close: 83.9,
    volume: 1e5
  });
}
renderCandlestickChart(candles, { width: 640, height: 360, title: 's' })
  .then(b => {
    console.log('bytes', b && b.length);
    process.exit(b && b.length > 500 ? 0 : 2);
  })
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
