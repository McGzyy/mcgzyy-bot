/**
 * GMGN token chart capture (Step 1 — standalone).
 * Persistent Playwright Chromium + context; new page per capture.
 */

const path = require('path');
const fs = require('fs').promises;
const { chromium } = require('playwright');

let browser = null;
let context = null;

async function getBrowser() {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    context = await browser.newContext({
      viewport: { width: 1400, height: 900 },
      colorScheme: 'dark',
      locale: 'en-US'
    });
  }
  return { browser, context };
}

/** Prefer larger visible nodes (main chart vs tiny sparkline). */
const MIN_W = 120;
const MIN_H = 80;

const SELECTORS = [
  'div[class*="kline"]',
  'canvas',
  'div[class*="chart"]',
  'div[class*="tv-chart"]'
];

async function screenshotLargestMatch(page, selector) {
  try {
    const loc = page.locator(selector);
    const count = await loc.count();
    if (!count) return null;

    const candidates = [];
    for (let i = 0; i < count; i++) {
      const el = loc.nth(i);
      const visible = await el.isVisible().catch(() => false);
      if (!visible) continue;
      const box = await el.boundingBox().catch(() => null);
      if (!box || box.width < MIN_W || box.height < MIN_H) continue;
      candidates.push({ el, area: box.width * box.height });
    }

    candidates.sort((a, b) => b.area - a.area);

    for (const { el } of candidates) {
      try {
        const buf = await el.screenshot({ type: 'png' });
        if (buf && Buffer.isBuffer(buf) && buf.length > 800) return buf;
      } catch (_) {
        /* try next */
      }
    }
  } catch (_) {
    return null;
  }
  return null;
}

/** Full-page HTML + PNG in cwd for headless GMGN inspection (always attempt both). */
async function saveGmgnDebugPageSnapshot(page) {
  const cwd = process.cwd();
  const pngPath = path.join(cwd, 'debug_page.png');
  const htmlPath = path.join(cwd, 'debug_page.html');
  const tag = '[ChartCapture]';

  try {
    const pngBuf = await page.screenshot({ fullPage: true, type: 'png' });
    await fs.writeFile(pngPath, pngBuf);
    console.log(`${tag} wrote ${pngPath} (${pngBuf.length} bytes)`);
  } catch (err) {
    console.log(`${tag} failed debug_page.png:`, err?.message || err);
  }

  try {
    const html = await page.content();
    await fs.writeFile(htmlPath, html, 'utf8');
    console.log(`${tag} wrote ${htmlPath} (${html.length} chars)`);
  } catch (err) {
    console.log(`${tag} failed debug_page.html:`, err?.message || err);
  }
}

/**
 * @param {string} contractAddress
 * @returns {Promise<Buffer|null>}
 */
async function captureGMGNChart(contractAddress) {
  const ca = String(contractAddress || '').trim();
  if (!ca) return null;

  let page;
  try {
    const { context: ctx } = await getBrowser();
    page = await ctx.newPage();

    const url = `https://gmgn.ai/sol/token/${ca}`;

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (_) {
      console.log('[ChartCapture] navigation failed for', contractAddress);
      await page.close().catch(() => null);
      return null;
    }

    await page.waitForTimeout(4000);

    await saveGmgnDebugPageSnapshot(page);

    for (const sel of SELECTORS) {
      try {
        await page.waitForSelector(sel, { state: 'visible', timeout: 20000 });
      } catch (_) {
        continue;
      }

      const buf = await screenshotLargestMatch(page, sel);
      if (buf) {
        await page.close().catch(() => null);
        return buf;
      }
    }

    console.log('No chart element found');
    await page.close().catch(() => null);
    return null;
  } catch (_) {
    try {
      if (page) await page.close();
    } catch (__) {
      /* ignore */
    }
    return null;
  }
}

/**
 * Saves ./debug_chart.png (cwd) and logs result.
 * @param {string} contractAddress
 */
async function debugCapture(contractAddress) {
  const outPath = path.join(process.cwd(), 'debug_chart.png');
  try {
    const buf = await captureGMGNChart(contractAddress);
    if (buf) {
      await fs.writeFile(outPath, buf);
      console.log(`[chartCapture] debug OK → ${outPath} (${buf.length} bytes)`);
    } else {
      console.log('[chartCapture] debug FAILED (null buffer)');
    }
  } catch (err) {
    console.log('[chartCapture] debug FAILED:', err?.message || err);
  }
}

module.exports = {
  captureGMGNChart,
  debugCapture
};
