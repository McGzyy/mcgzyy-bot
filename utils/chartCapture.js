/**
 * TradingView-first chart capture with DexScreener fallback (TV-powered chart UI).
 * Single shared Playwright browser + browser context; new page per capture.
 *
 * Optional later: !chart <CA>, milestone charts — import captureTradingViewChart.
 */

const { chromium } = require('playwright');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

let browserInstance = null;
let contextInstance = null;

async function getSharedContext() {
  if (!browserInstance) {
    browserInstance = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  }
  if (!contextInstance) {
    contextInstance = await browserInstance.newContext({
      viewport: { width: 1280, height: 800 },
      colorScheme: 'dark',
      locale: 'en-US'
    });
  }
  return contextInstance;
}

async function tryScreenshotTradingViewWidget(page) {
  await sleep(5000);

  const frames = page.frames();
  for (const frame of frames) {
    try {
      if (!frame.url().includes('tradingview.com')) continue;
      const canvas = await frame.$('canvas');
      if (canvas) {
        const buf = await canvas.screenshot({ type: 'png' });
        if (buf && buf.length > 500) return buf;
      }
    } catch (_) {
      /* continue */
    }
  }

  const topCanvas = await page.$('canvas');
  if (topCanvas) {
    const buf = await topCanvas.screenshot({ type: 'png' });
    if (buf && buf.length > 500) return buf;
  }

  const buf = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1280, height: 720 } });
  return buf && buf.length > 500 ? buf : null;
}

async function captureFromTradingViewEmbed(symbol) {
  const sym = String(symbol || '').trim();
  if (!sym) return null;

  const encoded = encodeURIComponent(sym);
  const url =
    `https://www.tradingview.com/embed-widget/advanced-chart/?autosize=1` +
    `&theme=dark&style=1&interval=60&locale=en&hide_top_toolbar=0&symbol=${encoded}`;

  let page;
  try {
    const context = await getSharedContext();
    page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 55000 });
    return await tryScreenshotTradingViewWidget(page);
  } catch (_) {
    return null;
  } finally {
    try {
      if (page) await page.close();
    } catch (_) {
      /* ignore */
    }
  }
}

async function captureFromDexScreener(contractAddress, pairAddress) {
  const ca = String(contractAddress || '').trim();
  if (!ca) return null;

  const path = (pairAddress && String(pairAddress).trim()) || ca;
  const url = `https://dexscreener.com/solana/${path}`;

  let page;
  try {
    const context = await getSharedContext();
    page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(4500);

    const canvas = await page.$('canvas');
    if (canvas) {
      const buf = await canvas.screenshot({ type: 'png' });
      if (buf && buf.length > 500) return buf;
    }

    const buf = await page.screenshot({
      type: 'png',
      clip: { x: 0, y: 72, width: 1280, height: 600 }
    });
    return buf && buf.length > 500 ? buf : null;
  } catch (_) {
    return null;
  } finally {
    try {
      if (page) await page.close();
    } catch (_) {
      /* ignore */
    }
  }
}

/**
 * @param {string} contractAddress - Solana token mint
 * @param {{ pairAddress?: string, ticker?: string }} [options]
 * @returns {Promise<Buffer|null>}
 */
async function captureTradingViewChart(contractAddress, options = {}) {
  try {
    const ca = String(contractAddress || '').trim();
    if (!ca) return null;

    const pair = options.pairAddress && String(options.pairAddress).trim();
    const rawTicker = options.ticker && String(options.ticker).trim().toUpperCase();
    const ticker = rawTicker ? rawTicker.replace(/[^A-Z0-9]/g, '') : '';

    const tvSymbols = [];
    if (ticker.length >= 2 && ticker.length <= 12) {
      tvSymbols.push(`BINANCE:${ticker}USDT`);
      tvSymbols.push(`MEXC:${ticker}USDT`);
    }

    for (const sym of tvSymbols) {
      const buf = await captureFromTradingViewEmbed(sym);
      if (buf) return buf;
    }

    return await captureFromDexScreener(ca, pair);
  } catch (_) {
    return null;
  }
}

async function shutdownChartBrowser() {
  try {
    if (contextInstance) await contextInstance.close();
  } catch (_) {
    /* ignore */
  }
  contextInstance = null;

  try {
    if (browserInstance) await browserInstance.close();
  } catch (_) {
    /* ignore */
  }
  browserInstance = null;
}

module.exports = {
  captureTradingViewChart,
  shutdownChartBrowser
};
