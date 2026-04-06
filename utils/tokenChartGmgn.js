/**
 * GMGN.ai token chart screenshots (Playwright) — dark theme, short intervals, recent focus.
 *
 * Navigation:
 *   1. Shared Chromium from tokenChartDexscreener (getChartPlaywrightBrowser).
 *   2. Goto https://gmgn.ai/sol/token/{contractAddress}
 *   3. Optional consent dismiss, wait for chart canvases (same wait helper as Dex).
 *   4. Best-effort candles + short interval + zoom (same interaction helpers as Dex).
 *   5. Best-effort GMGN promo modal: button/close clicks + one conservative DOM pass (promo dialogs only; chart-safe).
 *   6. Screenshot preferred GMGN/TV wrapper in the highest-signal frame, else canvas-parent fallback.
 *
 * Frame order: rank by canvas signal, then prefer blob: frames (TradingView chart document).
 * Wrappers: Dex-style chart containers first (.chart-container…, .chart-widget, .chart-gui-wrapper, …),
 *   then canvas-parent fallback. Min box relaxed for GMGN (~120×80+; larger charts pass easily).
 *
 * Env:
 *   CHART_GMGN_TIMEOUT_MS, CHART_GMGN_STABILIZE_MS, CHART_GMGN_ZOOM_IN_STEPS, CHART_GMGN_AFTER_ZOOM_MS
 *   CHART_GMGN_VIEWPORT_WIDTH / HEIGHT (fallback: X_CHART_WIDTH / X_CHART_HEIGHT)
 *   CHART_GMGN_DEVICE_SCALE (fallback: CHART_DEX_DEVICE_SCALE)
 *   CHART_GMGN_USER_AGENT (fallback: CHART_DEX_USER_AGENT or Chrome UA)
 *
 * Temporary diagnostics: CHART_GMGN_DEBUG=1 — on capture failure, writes debug/gmgn-*.png + gmgn-dom.html
 * (also honors CHART_DEX_DEBUG=1 so one flag can enable both providers’ dumps).
 */

const fs = require('fs/promises');
const path = require('path');
const {
  getChartPlaywrightBrowser,
  resolveSolanaContract,
  numEnv,
  waitForAnyFrameCanvas,
  rankFramesByChartCanvasSignal,
  dismissOptionalOverlays,
  trySelectShortInterval,
  trySelectCandles,
  findCanvasParentFallbackWrapperHandle,
  CANVAS_WAIT_MIN_AREA
} = require('./tokenChartDexscreener');

const DEFAULT_TIMEOUT_MS = 55000;
const DEFAULT_VIEWPORT = { width: 1360, height: 860 };

/** Relaxed vs Dex — GMGN / TV often uses multiple smaller canvases inside ~450×220+ wrappers. */
const GMGN_WRAPPER_MIN_W = 120;
const GMGN_WRAPPER_MIN_H = 80;

function isChartGmgnDebug() {
  return (
    /^1|true|yes$/i.test(String(process.env.CHART_GMGN_DEBUG || '').trim()) ||
    /^1|true|yes$/i.test(String(process.env.CHART_DEX_DEBUG || '').trim())
  );
}

function getGmgnDebugDir() {
  return path.join(__dirname, '..', 'debug');
}

/**
 * Per-frame canvas + chart/kline-like nodes (best-effort).
 * @param {import('playwright').Page} page
 */
async function collectGmgnDebugDiagnostics(page) {
  const frames = page.frames();
  let iframeElementCount = 0;
  try {
    iframeElementCount = await page.locator('iframe').count();
  } catch {
    iframeElementCount = -1;
  }

  const perFrame = [];
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const meta = {
      index: i,
      name: frame.name() || '',
      url: (frame.url() || '').slice(0, 240)
    };
    try {
      const data = await frame.evaluate(() => {
        const all = [...document.querySelectorAll('canvas')];
        const canvases = all.map((c, idx) => {
          const r = c.getBoundingClientRect();
          return {
            idx,
            w: Math.round(r.width),
            h: Math.round(r.height),
            area: Math.round(r.width * r.height),
            top: Math.round(r.top),
            left: Math.round(r.left),
            id: c.id || '',
            cls: String(c.className || '').slice(0, 140)
          };
        });
        const wrapperSelectors = [
          '[class*="chart"]',
          '[class*="Chart"]',
          '[id*="chart"]',
          '[id*="Chart"]',
          '[class*="kline"]',
          '[class*="Kline"]',
          '[class*="tradingview"]',
          '[class*="TradingView"]',
          '[class*="token-chart"]',
          '[class*="TokenChart"]',
          '[class*="gmgn"]'
        ];
        const seen = new Set();
        const chartLike = [];
        for (const sel of wrapperSelectors) {
          for (const el of document.querySelectorAll(sel)) {
            if (seen.has(el)) continue;
            seen.add(el);
            const r = el.getBoundingClientRect();
            chartLike.push({
              tag: el.tagName,
              id: String(el.id || '').slice(0, 80),
              cls: String(el.className || '').slice(0, 120),
              w: Math.round(r.width),
              h: Math.round(r.height)
            });
            if (chartLike.length >= 24) break;
          }
          if (chartLike.length >= 24) break;
        }
        return {
          canvasCount: all.length,
          canvases,
          chartLike
        };
      });
      perFrame.push({ ...meta, ...data });
    } catch (err) {
      perFrame.push({
        ...meta,
        error: err?.message || String(err)
      });
    }
  }

  return {
    title: await page.title().catch(() => ''),
    finalUrl: page.url(),
    frameCount: frames.length,
    iframeElementCount,
    perFrame
  };
}

async function writeGmgnDebugArtifacts(page, reason) {
  const dir = getGmgnDebugDir();
  await fs.mkdir(dir, { recursive: true });

  const fullPng = path.join(dir, 'gmgn-full.png');
  const viewPng = path.join(dir, 'gmgn-view.png');
  const domPath = path.join(dir, 'gmgn-dom.html');

  await page.screenshot({ path: fullPng, fullPage: true, type: 'png' }).catch(err => {
    console.warn('[TokenChartGmgn][debug] full-page screenshot failed:', err.message);
  });
  await page.screenshot({ path: viewPng, fullPage: false, type: 'png' }).catch(err => {
    console.warn('[TokenChartGmgn][debug] viewport screenshot failed:', err.message);
  });

  const maxDom = 1_500_000;
  let html = await page.content().catch(() => '<!-- page.content() failed -->');
  let truncated = false;
  if (html.length > maxDom) {
    truncated = true;
    html =
      `<!-- CHART_GMGN_DEBUG: HTML truncated to ${maxDom} chars (was ${html.length}). reason: ${reason} -->\n` +
      html.slice(0, maxDom);
  } else {
    html = `<!-- CHART_GMGN_DEBUG: reason=${reason} full_length=${html.length} -->\n${html}`;
  }
  await fs.writeFile(domPath, html, 'utf8');

  if (truncated) {
    console.warn(`[TokenChartGmgn][debug] gmgn-dom.html truncated (${maxDom} chars)`);
  }
}

/**
 * @param {import('playwright').Page} page
 * @param {string} reason
 */
async function runGmgnChartDebugOnFailure(page, reason) {
  if (!page) return;

  let diag;
  try {
    diag = await collectGmgnDebugDiagnostics(page);
  } catch (err) {
    console.warn('[TokenChartGmgn][debug] diagnostics failed:', err?.message || err);
    diag = null;
  }

  console.warn('[TokenChartGmgn][debug] capture failure —', reason);
  if (diag) {
    console.warn('[TokenChartGmgn][debug] title:', diag.title);
    console.warn('[TokenChartGmgn][debug] finalUrl:', diag.finalUrl);
    console.warn(
      '[TokenChartGmgn][debug] frames:',
      diag.frameCount,
      'iframe elements (main DOM):',
      diag.iframeElementCount
    );
    for (const f of diag.perFrame) {
      const canvasLine =
        f.error != null
          ? `error: ${f.error}`
          : `canvasCount=${f.canvasCount}`;
      console.warn(`[TokenChartGmgn][debug] frame[${f.index}] ${canvasLine} url=${f.url?.slice(0, 120) || ''}`);
      if (f.canvases && f.canvases.length) {
        const top = f.canvases
          .slice()
          .sort((a, b) => b.area - a.area)
          .slice(0, 5);
        console.warn('[TokenChartGmgn][debug]   top visible canvases:', JSON.stringify(top));
      }
      if (f.chartLike && f.chartLike.length) {
        console.warn('[TokenChartGmgn][debug]   chart-like wrappers:', JSON.stringify(f.chartLike.slice(0, 10)));
      }
    }
  }

  const rel = path.relative(process.cwd(), getGmgnDebugDir()) || 'debug';
  console.warn(`[TokenChartGmgn][debug] writing gmgn-full.png, gmgn-view.png, gmgn-dom.html to ${rel}/`);

  await writeGmgnDebugArtifacts(page, reason);
}

/**
 * TradingView / DexScreener-style wrappers observed on GMGN token chart (order matters).
 * Optional minW/minH per row; else GMGN_WRAPPER_MIN_*.
 * @type {{ key: string, sel: string, minW?: number, minH?: number }[]}
 */
const GMGN_WRAPPER_SELECTOR_ORDER = [
  { key: '.chart-container.top-full-width-chart.active', sel: '.chart-container.top-full-width-chart.active' },
  { key: '.chart-container-border', sel: '.chart-container-border' },
  { key: '.chart-widget', sel: '.chart-widget' },
  { key: '.chart-gui-wrapper', sel: '.chart-gui-wrapper' },
  { key: '.chart-markup-table', sel: '.chart-markup-table' },
  { key: '#tv-chart-container', sel: '#tv-chart-container' },
  { key: '#tv_chart_container', sel: '#tv_chart_container' },
  { key: '[class*="kline-chart"]', sel: '[class*="kline-chart"]' },
  { key: '[class*="KlineChart"]', sel: '[class*="KlineChart"]' }
];

function isBlobChartFrame(frame) {
  return String(frame.url() || '').startsWith('blob:');
}

/**
 * Rank frames by canvas signal, then prefer blob: (embedded TV chart) — not Playwright default order.
 * @param {import('playwright').Page} page
 * @returns {Promise<{ index: number, frame: import('playwright').Frame, maxA: number, sumA: number, canvasCount: number }[]>}
 */
async function rankGmgnFramesForCapture(page) {
  const base = await rankFramesByChartCanvasSignal(page);
  const enriched = [];

  for (const row of base) {
    let canvasCount = 0;
    try {
      canvasCount = await row.frame.evaluate(() => document.querySelectorAll('canvas').length);
    } catch {
      canvasCount = 0;
    }
    enriched.push({ ...row, canvasCount });
  }

  enriched.sort((a, b) => {
    const blobA = isBlobChartFrame(a.frame) ? 1 : 0;
    const blobB = isBlobChartFrame(b.frame) ? 1 : 0;
    if (blobB !== blobA) return blobB - blobA;
    if (b.maxA !== a.maxA) return b.maxA - a.maxA;
    if (b.sumA !== a.sumA) return b.sumA - a.sumA;
    return b.canvasCount - a.canvasCount;
  });

  return enriched;
}

function frameQualifiesForGmgnCapture(row) {
  const { maxA, sumA, canvasCount, frame } = row;
  if (isBlobChartFrame(frame) && canvasCount >= 1) return true;
  if (canvasCount >= 3 && sumA >= 4000) return true;
  if (maxA >= 4000 || sumA >= 6000) return true;
  if (canvasCount >= 1 && sumA >= 3000) return true;
  return false;
}

function isReasonableScreenshotPng(png) {
  return (
    Buffer.isBuffer(png) &&
    png.length >= 32 &&
    png.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
  );
}

/** Visible button labels for GMGN promo / upgrade / onboarding modals. */
const GMGN_DISMISS_BUTTON_RES = [
  /^close$/i,
  /^next$/i,
  /^skip$/i,
  /^got it!*$/i,
  /^continue$/i,
  /^maybe later$/i,
  /^not now$/i,
  /^dismiss$/i,
  /^no thanks$/i,
  /^upgrade later$/i,
  /^i understand$/i
];

/**
 * @param {import('playwright').Page | import('playwright').Frame} ctx
 * @param {import('playwright').Page} page — for waits
 */
async function tryDismissGmgnButtonsInContext(ctx, page) {
  let hit = false;
  for (const re of GMGN_DISMISS_BUTTON_RES) {
    try {
      const loc = ctx.getByRole('button', { name: re }).first();
      if (await loc.isVisible({ timeout: 220 }).catch(() => false)) {
        await loc.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(400);
        hit = true;
      }
    } catch {
      /* next */
    }
  }
  const linkLabels = ['Close', 'Skip', 'Next', 'Continue', 'Got it'];
  for (const text of linkLabels) {
    try {
      const loc = ctx.getByRole('link', { name: new RegExp(`^\\s*${text}\\s*$`, 'i') }).first();
      if (await loc.isVisible({ timeout: 160 }).catch(() => false)) {
        await loc.click({ timeout: 1500 }).catch(() => {});
        await page.waitForTimeout(400);
        hit = true;
      }
    } catch {
      /* next */
    }
  }
  return hit;
}

/**
 * @param {import('playwright').Page | import('playwright').Frame} ctx
 * @param {import('playwright').Page} page
 */
async function tryDismissGmgnCloseIconsInContext(ctx, page) {
  const locators = [
    ctx.locator('[role="dialog"] button[aria-label*="close" i]').first(),
    ctx.locator('[role="dialog"] button[aria-label*="dismiss" i]').first(),
    ctx.locator('[role="dialog"] button:has-text("×")').first(),
    ctx.locator('[role="dialog"] button:has-text("✕")').first()
  ];
  let hit = false;
  for (const loc of locators) {
    try {
      if (await loc.isVisible({ timeout: 180 }).catch(() => false)) {
        await loc.click({ timeout: 1500 }).catch(() => {});
        await page.waitForTimeout(400);
        hit = true;
        break;
      }
    } catch {
      /* next */
    }
  }
  return hit;
}

/**
 * Main document only: hide at most a few highly specific GMGN promotional [role=dialog] roots.
 * Skips anything touching the chart tree or overlapping canvases materially.
 * @returns {number}
 */
function hideGmgnStrictPromoDialogsOnlyEvaluate() {
  const CHART_SEL = [
    '.chart-container',
    '.chart-container-border',
    '.chart-widget',
    '.chart-gui-wrapper',
    '.chart-markup-table',
    '#tv-chart-container',
    '#tv_chart_container'
  ];

  function rectIsect(a, b) {
    const x1 = Math.max(a.left, b.left);
    const y1 = Math.max(a.top, b.top);
    const x2 = Math.min(a.right, b.right);
    const y2 = Math.min(a.bottom, b.bottom);
    if (x2 <= x1 || y2 <= y1) return 0;
    return (x2 - x1) * (y2 - y1);
  }

  function chartTouchOrOverlap(el) {
    if (!el || !el.closest) return true;
    for (const sel of CHART_SEL) {
      const roots = document.querySelectorAll(sel);
      for (const root of roots) {
        if (!root) continue;
        if (root.contains(el) || el.contains(root)) return true;
        const er = el.getBoundingClientRect();
        const rr = root.getBoundingClientRect();
        const ia = rectIsect(er, rr);
        const minA = Math.min(er.width * er.height, rr.width * rr.height) || 1;
        if (ia / minA > 0.12) return true;
      }
    }
    const canvases = document.querySelectorAll('canvas');
    const er = el.getBoundingClientRect();
    for (const c of canvases) {
      const cr = c.getBoundingClientRect();
      if (cr.width <= 0 || cr.height <= 0) continue;
      const ia = rectIsect(er, cr);
      const minA = Math.min(er.width * er.height, cr.width * cr.height) || 1;
      if (ia / minA > 0.08) return true;
    }
    return false;
  }

  function isStrictGmgnPromoDialog(el) {
    const role = el.getAttribute('role');
    if (role !== 'dialog' && role !== 'alertdialog') return false;
    const hay = `${el.className || ''} ${el.id || ''}`.toLowerCase();
    if (!hay.includes('gmgn') && !hay.includes('gmg-')) return false;
    if (!/(upgrade|promo|onboard|subscription|premium|vip|trial|membership|paywall)/.test(hay)) return false;
    return true;
  }

  function isDirectBackdropSibling(dialog) {
    const p = dialog.parentElement;
    if (!p) return null;
    const kids = [...p.children];
    for (const sib of kids) {
      if (sib === dialog) continue;
      const sh = `${sib.className || ''} ${sib.id || ''}`.toLowerCase();
      const st = window.getComputedStyle(sib);
      if (st.position !== 'fixed' && st.position !== 'absolute') continue;
      if (!/(backdrop|overlay|mask|scrim)/.test(sh) && sib.getAttribute('role') !== 'presentation')
        continue;
      const r = sib.getBoundingClientRect();
      if (r.width < window.innerWidth * 0.35) continue;
      if (chartTouchOrOverlap(sib)) return null;
      return sib;
    }
    return null;
  }

  let hidden = 0;
  const maxHide = 3;
  const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');

  dialogs.forEach(dialog => {
    if (hidden >= maxHide) return;
    if (!isStrictGmgnPromoDialog(dialog)) return;
    if (chartTouchOrOverlap(dialog)) return;

    const dr = dialog.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cx = dr.left + dr.width / 2;
    const cy = dr.top + dr.height / 2;
    const centered =
      dr.width >= 180 &&
      dr.height >= 120 &&
      Math.abs(cx - vw / 2) < vw * 0.38 &&
      Math.abs(cy - vh / 2) < vh * 0.42;
    if (!centered) return;

    const backdrop = isDirectBackdropSibling(dialog);
    if (backdrop && hidden < maxHide) {
      backdrop.style.setProperty('display', 'none', 'important');
      backdrop.style.setProperty('pointer-events', 'none', 'important');
      backdrop.setAttribute('data-gmgn-overlay-suppressed', '1');
      hidden++;
    }

    if (hidden >= maxHide) return;
    dialog.style.setProperty('display', 'none', 'important');
    dialog.style.setProperty('pointer-events', 'none', 'important');
    dialog.setAttribute('data-gmgn-overlay-suppressed', '1');
    hidden++;
  });

  return hidden;
}

/**
 * @param {import('playwright').Frame} frame
 * @returns {Promise<boolean>}
 */
async function tryHideGmgnStrictPromoDialogsInFrame(frame) {
  try {
    const n = await frame.evaluate(hideGmgnStrictPromoDialogsOnlyEvaluate);
    return typeof n === 'number' && n > 0;
  } catch {
    return false;
  }
}

/**
 * Main page only: button/link dismiss, optional strict promo-dialog DOM hide. No child-frame DOM surgery.
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>} true if a click landed or a dialog was hidden
 */
async function cleanupGmgnPromoOverlaysBeforeCapture(page) {
  let did = false;

  did = (await tryDismissGmgnButtonsInContext(page, page)) || did;
  did = (await tryDismissGmgnCloseIconsInContext(page, page)) || did;

  if (did) {
    await page.waitForTimeout(550);
  } else {
    await page.waitForTimeout(200);
  }

  did = (await tryHideGmgnStrictPromoDialogsInFrame(page.mainFrame())) || did;

  if (did) {
    await page.waitForTimeout(450);
  }

  return did;
}

function gmgnTokenUrl(contractAddress) {
  const chain = String(process.env.CHART_GMGN_CHAIN || 'sol').trim().toLowerCase() || 'sol';
  return `https://gmgn.ai/${chain}/token/${contractAddress}`;
}

async function findPreferredGmgnWrapperInFrame(frame) {
  for (const entry of GMGN_WRAPPER_SELECTOR_ORDER) {
    const { key, sel } = entry;
    const minW = entry.minW ?? GMGN_WRAPPER_MIN_W;
    const minH = entry.minH ?? GMGN_WRAPPER_MIN_H;
    try {
      const loc = frame.locator(sel).first();
      if ((await loc.count()) === 0) continue;
      const visible = await loc.isVisible().catch(() => false);
      if (!visible) continue;
      const box = await loc.boundingBox();
      if (!box || box.width < minW || box.height < minH) continue;
      const handle = await loc.elementHandle();
      if (handle) return { handle, selector: key };
    } catch {
      /* next */
    }
  }
  return null;
}

async function resolveGmgnChartWrapperInFrame(frame) {
  const preferred = await findPreferredGmgnWrapperInFrame(frame);
  if (preferred) return preferred;

  const fallback = await findCanvasParentFallbackWrapperHandle(frame);
  if (fallback) return { handle: fallback, selector: 'canvas-parent-fallback' };

  return null;
}

async function findGmgnChartWrapperElementHandle(frame) {
  const r = await resolveGmgnChartWrapperInFrame(frame);
  return r ? r.handle : null;
}

async function clickGmgnChartToFocus(page) {
  const ranked = await rankGmgnFramesForCapture(page);
  for (const row of ranked) {
    if (!frameQualifiesForGmgnCapture(row)) continue;
    const { frame } = row;
    const el = await findGmgnChartWrapperElementHandle(frame);
    if (!el) continue;
    try {
      await el.click({ position: { x: 64, y: 120 }, timeout: 2500 }).catch(() => {});
      return;
    } finally {
      await el.dispose();
    }
  }
}

async function nudgeGmgnZoomRecentWindow(page) {
  const steps = Math.min(
    24,
    Math.max(0, Math.floor(numEnv('CHART_GMGN_ZOOM_IN_STEPS', numEnv('CHART_DEX_ZOOM_IN_STEPS', 10))))
  );
  await clickGmgnChartToFocus(page);
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press('+').catch(() => {});
    await page.waitForTimeout(70);
  }
  await page.waitForTimeout(numEnv('CHART_GMGN_AFTER_ZOOM_MS', numEnv('CHART_DEX_AFTER_ZOOM_MS', 600)));
}

async function screenshotGmgnChartWrapperPng(page) {
  const ranked = await rankGmgnFramesForCapture(page);

  for (const row of ranked) {
    if (!frameQualifiesForGmgnCapture(row)) continue;

    const { frame, index } = row;
    const resolved = await resolveGmgnChartWrapperInFrame(frame);
    if (!resolved) continue;

    const { handle, selector } = resolved;
    try {
      const png = await handle.screenshot({ type: 'png', timeout: 20000 });
      if (isReasonableScreenshotPng(png)) {
        console.info(`[TokenChartGmgn] chart capture: frame[${index}] wrapper=${selector}`);
        return png;
      }
    } catch {
      /* next frame */
    } finally {
      await handle.dispose();
    }
  }
  return null;
}

/**
 * @param {object} trackedCall
 * @returns {Promise<Buffer|null>}
 */
async function fetchGmgnChartPng(trackedCall) {
  const contractAddress = resolveSolanaContract(trackedCall);
  if (!contractAddress) return null;

  const timeoutMs = numEnv('CHART_GMGN_TIMEOUT_MS', DEFAULT_TIMEOUT_MS);
  const url = gmgnTokenUrl(contractAddress);
  const vw = numEnv('CHART_GMGN_VIEWPORT_WIDTH', numEnv('X_CHART_WIDTH', DEFAULT_VIEWPORT.width));
  const vh = numEnv('CHART_GMGN_VIEWPORT_HEIGHT', numEnv('X_CHART_HEIGHT', DEFAULT_VIEWPORT.height));
  const dpr = Math.min(
    3,
    Math.max(1, numEnv('CHART_GMGN_DEVICE_SCALE', numEnv('CHART_DEX_DEVICE_SCALE', 2)))
  );

  let context = null;
  let page = null;

  try {
    const browser = await getChartPlaywrightBrowser();
    context = await browser.newContext({
      viewport: { width: vw, height: vh },
      deviceScaleFactor: dpr,
      colorScheme: 'dark',
      userAgent:
        process.env.CHART_GMGN_USER_AGENT ||
        process.env.CHART_DEX_USER_AGENT ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      locale: 'en-US'
    });

    page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });

    await dismissOptionalOverlays(page);

    await waitForAnyFrameCanvas(page, CANVAS_WAIT_MIN_AREA, Math.min(timeoutMs, 45000));

    await trySelectCandles(page);
    await trySelectShortInterval(page);
    await nudgeGmgnZoomRecentWindow(page);

    await page.waitForTimeout(numEnv('CHART_GMGN_STABILIZE_MS', numEnv('CHART_DEX_STABILIZE_MS', 1200)));

    const gmgnOverlayHandled = await cleanupGmgnPromoOverlaysBeforeCapture(page);

    if (gmgnOverlayHandled) {
      console.info('[TokenChartGmgn] dismissed overlay before chart capture');
    }

    const png = await screenshotGmgnChartWrapperPng(page);
    if (!png) {
      console.warn('[TokenChartGmgn] No chart canvas/wrapper found after load');
      if (isChartGmgnDebug()) await runGmgnChartDebugOnFailure(page, 'no_chart_wrapper');
      return null;
    }
    return png;
  } catch (err) {
    console.warn('[TokenChartGmgn] Capture failed:', err.message || String(err));
    if (isChartGmgnDebug()) await runGmgnChartDebugOnFailure(page, `exception: ${err.message || String(err)}`);
    return null;
  } finally {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
  }
}

module.exports = {
  fetchGmgnChartPng,
  gmgnTokenUrl
};
