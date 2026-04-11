/**
 * GeckoTerminal chart capture.
 * Persistent Playwright Chromium + context; new page per capture.
 */

const path = require('path');
const fs = require('fs').promises;
const { chromium } = require('playwright');

let context = null;

async function getBrowser() {
  if (!context) {
    const profileDir = path.join(process.cwd(), 'browser-profile');
    context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      viewport: { width: 1400, height: 900 },
      colorScheme: 'dark',
      locale: 'en-US',
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ]
    });
  }
  return { context };
}

/** Prefer larger visible nodes (main chart vs tiny sparkline). */
const MIN_W = 120;
const MIN_H = 80;

const SELECTORS = [
  'canvas',
  'div[class*="chart"]',
  'div[class*="tv-chart"]',
  'svg'
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

/** Full-page HTML + PNG in cwd for headless inspection (always attempt both). */
async function saveDebugPageSnapshot(page) {
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

function buildGeckoUrl(contractAddress, pairAddress) {
  const ca = String(contractAddress || '').trim();
  const pair = String(pairAddress || '').trim();
  if (pair) {
    return `https://www.geckoterminal.com/solana/pools/${pair}`;
  }
  if (ca) {
    return `https://www.geckoterminal.com/solana/tokens/${ca}`;
  }
  return null;
}

/**
 * @param {{ contractAddress?: string, pairAddress?: string }} params
 * @returns {Promise<Buffer|null>}
 */
async function captureGeckoChart({ contractAddress, pairAddress } = {}) {
  const url = buildGeckoUrl(contractAddress, pairAddress);
  if (!url) return null;

  const ca = String(contractAddress || '').trim();
  const pair = String(pairAddress || '').trim();
  const logKey = pair || ca;

  let page;
  try {
    const { context: ctx } = await getBrowser();
    page = await ctx.newPage();

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (_) {
      console.log('[ChartCapture] navigation failed for', logKey);
      await page.close().catch(() => null);
      return null;
    }

    await page.waitForTimeout(4000);

    await saveDebugPageSnapshot(page);

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
 * @param {string} [pairAddress]
 */
async function debugCapture(contractAddress, pairAddress) {
  const outPath = path.join(process.cwd(), 'debug_chart.png');
  try {
    const buf = await captureGeckoChart({ contractAddress, pairAddress });
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
  captureGeckoChart,
  debugCapture
};
