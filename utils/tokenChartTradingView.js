/**
 * GeckoTerminal pool chart screenshots (Playwright) — TradingView-like / Padre-style chart surface.
 * Not pure TradingView symbol mode: loads https://www.geckoterminal.com/{network}/pools/{pool}
 *
 * Pool resolution:
 *   1) trackedCall.pairAddress (or token.pairAddress) when valid Solana address
 *   2) GeckoTerminal API: GET /networks/{network}/tokens/{mint}/pools — best reserve_in_usd
 *
 * Env:
 *   CHART_TV_TIMEOUT_MS (fallback CHART_GMGN_TIMEOUT_MS / CHART_DEX)
 *   CHART_TV_STABILIZE_MS
 *   CHART_TV_VIEWPORT_WIDTH / HEIGHT (fallback X_CHART_WIDTH / X_CHART_HEIGHT)
 *   CHART_TV_DEVICE_SCALE (fallback CHART_DEX_DEVICE_SCALE)
 *   CHART_TV_USER_AGENT (fallback CHART_DEX_USER_AGENT)
 *   CHART_TV_NETWORK — default solana
 *   CHART_TV_INTERVAL_ORDER — comma list (default 15s,5s,1s,30s,1m,15m,1h,4h,1d)
 *   CHART_TV_TOOLBAR_BAND_PX — pixels below top chart canvas to scan for interval row (default 200)
 *   CHART_TV_METRIC_BAND_EXTRA_PX — extra band height/width for Price/MCAP toolbar vs intervals (default 100)
 *   CHART_TV_METRIC_SETTLE_MS — wait after MCAP click before final stabilize/screenshot (default 700)
 *   CHART_TV_METRIC_VERIFY_MS — post-click MCAP verify poll (default 2400)
 *   CHART_TV_METRIC_SECOND_PASS_EXTRA_PX — extra toolbar band for second MCAP toggle pass (default 56, 0 disables)
 *   CHART_TV_INTERVAL_TOOLBAR_WAIT_MS / CHART_TV_INTERVAL_TOOLBAR_POLL_MS — toolbar readiness poll (wait default ~2200ms; ready when any interval token appears)
 *   CHART_TV_INTERVAL_VERIFY_MS — post-click verify poll (like CHART_DEX_INTERVAL_VERIFY_MS)
 *   CHART_TV_DEBUG=1 — on failure: debug/tv-*.png + tv-dom.html (also if CHART_DEX_DEBUG=1)
 *
 * Post-interval/metric framing (subtle wheel-out on largest chart canvas for more visible history):
 *   CHART_TV_FRAMING_ASSIST_ENABLED — default 1
 *   CHART_TV_FRAMING_1S_WHEEL_OUT — default 0 (1s skips framing to avoid zoom hint overlay)
 *   CHART_TV_FRAMING_5S_WHEEL_OUT / CHART_TV_FRAMING_15S_WHEEL_OUT / CHART_TV_FRAMING_OTHER_WHEEL_OUT — capped to max 1 wheel step (defaults 0)
 *   CHART_TV_FRAMING_WHEEL_DELTA / CHART_TV_FRAMING_WHEEL_SIGN / CHART_TV_FRAMING_WHEEL_DELAY_MS — tuning
 *
 * Strict capture / fast-fail (untrusted Gecko state returns null for Dex fallback):
 *   CHART_TV_CAPTURE_BUDGET_MS — max wall time for Gecko chart work after page open (default 32000)
 *   CHART_TV_CAPTURE_POST_TOOLBAR_RESERVE_MS — reserve left for interval+metric+shot after toolbar wait (default 15000)
 */

const fs = require('fs/promises');
const path = require('path');
const axios = require('axios');
const {
  getChartPlaywrightBrowser,
  resolveSolanaContract,
  numEnv,
  dismissOptionalOverlays,
  waitForAnyFrameCanvas,
  rankFramesByChartCanvasSignal,
  findCanvasParentFallbackWrapperHandle,
  CANVAS_WAIT_MIN_AREA
} = require('./tokenChartDexscreener');

const GECKO_API = 'https://api.geckoterminal.com/api/v2';
const DEFAULT_TIMEOUT_MS = 55000;
const DEFAULT_VIEWPORT = { width: 1360, height: 860 };

const GECKO_WRAPPER_MIN_W = 200;
const GECKO_WRAPPER_MIN_H = 160;

/** Prefer TV-style / chart roots Gecko may share with other embeds. */
const GECKO_WRAPPER_SELECTOR_ORDER = [
  { key: '.chart-markup-table', sel: '.chart-markup-table' },
  { key: '.chart-widget', sel: '.chart-widget' },
  { key: '#tv-chart-container', sel: '#tv-chart-container' },
  { key: '.chart-container-border', sel: '.chart-container-border' },
  { key: '[class*="tv-lightweight-charts"]', sel: '[class*="tv-lightweight-charts"]' },
  { key: '[class*="chart-container"]', sel: '[class*="chart-container"]' },
  { key: 'main [class*="Chart"]', sel: 'main [class*="Chart"]' }
];

const DEFAULT_INTERVAL_ORDER = ['15s', '5s', '1s', '30s', '1m', '15m', '1h', '4h', '1d'];

function escapeIntervalLabelForRegex(label) {
  return String(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tvToolbarBandPx() {
  return Math.min(320, Math.max(72, Math.floor(numEnv('CHART_TV_TOOLBAR_BAND_PX', 200))));
}

/** Wider band than intervals for Price / MCAP row (same chart top anchor). */
function tvMetricToolbarBandPx() {
  const extra = Math.min(200, Math.max(0, Math.floor(numEnv('CHART_TV_METRIC_BAND_EXTRA_PX', 100))));
  return Math.min(420, tvToolbarBandPx() + extra);
}

function tvMetricTopSlackPx() {
  return Math.min(120, Math.max(24, Math.floor(numEnv('CHART_TV_METRIC_TOP_SLACK_PX', 72))));
}

/** Acceptable DOM tokens for a preferred label (Gecko may show "D" for daily). */
function geckoIntervalMatchTokens(wantLabel) {
  const w = String(wantLabel).trim().toLowerCase();
  if (w === '1d') return ['1d', 'd'];
  return [w];
}

function isChartTvDebug() {
  return (
    /^1|true|yes$/i.test(String(process.env.CHART_TV_DEBUG || '').trim()) ||
    /^1|true|yes$/i.test(String(process.env.CHART_DEX_DEBUG || '').trim())
  );
}

/** @param {number|null|undefined} deadline */
function tvRemainingMs(deadline) {
  if (deadline == null || !Number.isFinite(deadline)) return 1e9;
  return Math.max(0, Math.floor(deadline - Date.now()));
}

function isDetachedFrameError(err) {
  const m = String(err?.message || err || '');
  return /detached|Target closed|Execution context was destroyed|Frame has been detached/i.test(m);
}

/**
 * @param {object} s
 * @returns {{ ok: boolean, reason?: string }}
 */
function isTrustedGeckoChartState(s) {
  if (s.detachedUnrecoverable) return { ok: false, reason: 'detached' };
  if (!s.chartCanvasFound) return { ok: false, reason: 'chart_canvas' };
  if (!s.intervalConfirmed) return { ok: false, reason: 'interval_unconfirmed' };
  return { ok: true };
}

/**
 * @param {object} intervalRes
 * @param {object} metricRes
 * @param {boolean} chartCanvasFound
 * @param {string|null} [inferredMetric]
 */
function logGeckoCaptureAbort(intervalRes, metricRes, chartCanvasFound, trustReason, inferredMetric) {
  const inf = inferredMetric == null ? 'null' : String(inferredMetric);
  console.info(
    `[TokenChartTV] readiness gate failed: intervalConfirmed=${intervalRes.intervalConfirmed} chartCanvasFound=${chartCanvasFound} metricConfirmed=${metricRes.metricConfirmed} inferredMetric=${inf} (metric is non-blocking)`
  );
  const detached = intervalRes.detachedUnrecoverable || metricRes.detachedUnrecoverable;
  if (detached || trustReason === 'detached') {
    console.warn('[TokenChartTV] aborting Gecko capture: detached frame unrecoverable');
  } else if (trustReason === 'interval_unconfirmed' || !intervalRes.intervalConfirmed) {
    console.warn('[TokenChartTV] aborting Gecko capture: interval not confirmed');
  } else if (trustReason === 'chart_canvas' || !chartCanvasFound) {
    console.warn('[TokenChartTV] aborting Gecko capture: chart canvas not found');
  }
  console.warn('[TokenChartTV] Gecko capture aborted — returning null for provider fallback');
}

function getTvDebugDir() {
  return path.join(__dirname, '..', 'debug');
}

function isReasonablePng(buf) {
  return (
    Buffer.isBuffer(buf) &&
    buf.length >= 32 &&
    buf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
  );
}

function isValidSolanaAddress(s) {
  return typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s.trim());
}

/**
 * @param {object} trackedCall
 * @returns {string|null}
 */
function getPairAddressFromTrackedCall(trackedCall) {
  const raw = trackedCall?.pairAddress ?? trackedCall?.token?.pairAddress;
  if (!raw || typeof raw !== 'string') return null;
  const t = raw.trim();
  return isValidSolanaAddress(t) ? t : null;
}

function getTvIntervalOrder() {
  const raw = String(process.env.CHART_TV_INTERVAL_ORDER || '').trim();
  if (raw) {
    return raw
      .split(/[\s,]+/)
      .map(s => s.trim())
      .filter(Boolean);
  }
  return DEFAULT_INTERVAL_ORDER.slice();
}

function geckoPoolPageUrl(network, poolAddress) {
  const net = String(network || 'solana').trim().toLowerCase() || 'solana';
  return `https://www.geckoterminal.com/${net}/pools/${encodeURIComponent(poolAddress)}`;
}

/**
 * @param {string} mint
 * @param {string} network
 * @returns {Promise<string|null>}
 */
async function fetchBestPoolAddressFromGecko(mint, network) {
  const net = String(network || 'solana').trim().toLowerCase() || 'solana';
  const url = `${GECKO_API}/networks/${net}/tokens/${encodeURIComponent(mint)}/pools`;
  try {
    const res = await axios.get(url, {
      timeout: 18000,
      headers: {
        Accept: 'application/json',
        'User-Agent':
          process.env.CHART_TV_GECKO_UA ||
          'Mozilla/5.0 (compatible; CryptoScanner/1.0; +https://example.local) axios'
      },
      validateStatus: s => s === 200
    });
    const rows = res.data?.data;
    if (!Array.isArray(rows) || rows.length === 0) return null;

    const scored = rows
      .map(p => {
        let addr = p?.attributes?.address || null;
        if (!addr && typeof p?.id === 'string') {
          const parts = p.id.split('_');
          addr = parts.length >= 2 ? parts.slice(-1)[0] : p.id.replace(/^solana_/, '');
        }
        const liq = Number(p?.attributes?.reserve_in_usd);
        return {
          address: addr,
          reserve: Number.isFinite(liq) ? liq : 0
        };
      })
      .filter(x => x.address && isValidSolanaAddress(x.address));

    if (!scored.length) return null;
    scored.sort((a, b) => b.reserve - a.reserve);
    return scored[0].address;
  } catch (err) {
    console.info('[TokenChartTV] Gecko pool API failed:', err?.message || String(err));
    return null;
  }
}

/**
 * @param {object} trackedCall
 * @param {string} mint
 * @param {string} network
 * @returns {Promise<{ poolAddress: string, source: 'pairAddress'|'gecko_api' }|null>}
 */
async function resolvePoolForChart(trackedCall, mint, network) {
  const fromCall = getPairAddressFromTrackedCall(trackedCall);
  if (fromCall) {
    console.info('[TokenChartTV] pool source=pairAddress', fromCall.slice(0, 8) + '…');
    return { poolAddress: fromCall, source: 'pairAddress' };
  }
  const fromApi = await fetchBestPoolAddressFromGecko(mint, network);
  if (fromApi) {
    console.info('[TokenChartTV] pool source=gecko_api', fromApi.slice(0, 8) + '…');
    return { poolAddress: fromApi, source: 'gecko_api' };
  }
  console.info('[TokenChartTV] no pool resolved (no pairAddress, Gecko empty/failed)');
  return null;
}

function frameQualifiesForGeckoCapture(row) {
  const { maxA, sumA } = row;
  if (maxA >= 8000 || sumA >= 8000) return true;
  if (maxA >= 5000 || sumA >= 6000) return true;
  return false;
}

async function findPreferredGeckoWrapperInFrame(frame) {
  for (const entry of GECKO_WRAPPER_SELECTOR_ORDER) {
    const { key, sel } = entry;
    const minW = entry.minW ?? GECKO_WRAPPER_MIN_W;
    const minH = entry.minH ?? GECKO_WRAPPER_MIN_H;
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

async function resolveGeckoChartWrapperInFrame(frame) {
  const preferred = await findPreferredGeckoWrapperInFrame(frame);
  if (preferred) return preferred;
  const fallback = await findCanvasParentFallbackWrapperHandle(frame);
  if (fallback) return { handle: fallback, selector: 'canvas-parent-fallback' };
  return null;
}

/**
 * Last resort: largest canvas with non-null boundingBox in frame.
 * @param {import('playwright').Frame} frame
 * @returns {Promise<Buffer|null>}
 */
async function screenshotLargestCanvasInFrameTv(frame) {
  const canvases = frame.locator('canvas');
  let count = 0;
  try {
    count = await canvases.count();
  } catch {
    return null;
  }
  let bestIdx = -1;
  let bestArea = 0;
  for (let i = 0; i < count; i++) {
    const loc = canvases.nth(i);
    let b = null;
    try {
      b = await loc.boundingBox();
    } catch {
      b = null;
    }
    if (!b) continue;
    const area = b.width * b.height;
    if (area < 12000) continue;
    if (area > bestArea) {
      bestArea = area;
      bestIdx = i;
    }
  }
  if (bestIdx < 0) return null;
  try {
    const png = await canvases.nth(bestIdx).screenshot({ type: 'png', timeout: 20000 });
    if (isReasonablePng(png)) {
      console.info('[TokenChartTV] capture: raw canvas fallback area=' + Math.round(bestArea));
      return png;
    }
  } catch {
    /* */
  }
  return null;
}

/**
 * @returns {Promise<{ png: Buffer|null, selector: string|null, frameIndex: number|string|null }>}
 */
async function screenshotGeckoChartRegionDetailed(page) {
  const ranked = await rankFramesByChartCanvasSignal(page);

  for (const row of ranked) {
    if (!frameQualifiesForGeckoCapture(row)) continue;
    const { frame, index } = row;
    const resolved = await resolveGeckoChartWrapperInFrame(frame);
    if (!resolved) continue;

    const { handle, selector } = resolved;
    console.info(`[TokenChartTV] capture target selected frame[${index}]: ${selector}`);
    try {
      let box = null;
      try {
        box = await handle.boundingBox();
      } catch {
        box = null;
      }
      if (!box) {
        await handle.dispose().catch(() => {});
        const canvasPng = await screenshotLargestCanvasInFrameTv(frame);
        if (isReasonablePng(canvasPng)) {
          console.info(`[TokenChartTV] chart capture OK frame[${index}] wrapper=raw-canvas (no wrapper box)`);
          return { png: canvasPng, selector: 'raw-canvas', frameIndex: index };
        }
        continue;
      }

      const png = await handle.screenshot({ type: 'png', timeout: 20000 });
      if (isReasonablePng(png)) {
        console.info(`[TokenChartTV] chart capture OK frame[${index}] wrapper=${selector}`);
        return { png, selector, frameIndex: index };
      }
    } catch (err) {
      console.info(`[TokenChartTV] wrapper screenshot failed frame[${index}] ${selector}:`, err?.message || err);
      const canvasPng = await screenshotLargestCanvasInFrameTv(frame);
      if (isReasonablePng(canvasPng)) {
        console.info(`[TokenChartTV] chart capture OK frame[${index}] wrapper=raw-canvas (after wrapper error)`);
        return { png: canvasPng, selector: 'raw-canvas', frameIndex: index };
      }
    } finally {
      await handle.dispose().catch(() => {});
    }
  }

  for (const row of ranked) {
    if (!frameQualifiesForGeckoCapture(row)) continue;
    const png = await screenshotLargestCanvasInFrameTv(row.frame);
    if (isReasonablePng(png)) {
      console.info(`[TokenChartTV] capture target selected frame[${row.index}]: raw-canvas-fallback`);
      return { png, selector: 'raw-canvas-fallback', frameIndex: row.index };
    }
  }

  return { png: null, selector: null, frameIndex: null };
}

async function screenshotGeckoChartRegion(page) {
  const r = await screenshotGeckoChartRegionDetailed(page);
  return r.png;
}

/**
 * Last-chance capture when budget is low or primary path returned null.
 * @param {import('playwright').Page} page
 * @param {{ skipRepeatDetailed?: boolean }} [opts]
 * @returns {Promise<Buffer|null>}
 */
async function emergencyFinalGeckoCapture(page, opts = {}) {
  console.warn('[TokenChartTV] capture budget low — attempting emergency final capture');

  if (!opts.skipRepeatDetailed) {
    const r = await screenshotGeckoChartRegionDetailed(page);
    if (r.png && isReasonablePng(r.png)) {
      console.info(
        `[TokenChartTV] emergency capture success: selector=${r.selector ?? 'unknown'} frame[${r.frameIndex ?? 'n/a'}]`
      );
      return r.png;
    }
  }

  const main = page.mainFrame();
  for (const entry of GECKO_WRAPPER_SELECTOR_ORDER) {
    try {
      const loc = main.locator(entry.sel).first();
      if ((await loc.count()) === 0) continue;
      const visible = await loc.isVisible().catch(() => false);
      if (!visible) continue;
      const box = await loc.boundingBox();
      if (!box || box.width < GECKO_WRAPPER_MIN_W || box.height < GECKO_WRAPPER_MIN_H) continue;
      console.info(`[TokenChartTV] capture target selected frame[main]: ${entry.key}`);
      const png = await loc.screenshot({ type: 'png', timeout: 15000 });
      if (isReasonablePng(png)) {
        console.info(`[TokenChartTV] emergency capture success: selector=${entry.key}`);
        return png;
      }
    } catch {
      /* next */
    }
  }

  for (const frame of page.frames()) {
    try {
      const png = await screenshotLargestCanvasInFrameTv(frame);
      if (isReasonablePng(png)) {
        console.info('[TokenChartTV] emergency capture success: selector=raw-canvas-any-frame');
        return png;
      }
    } catch {
      /* */
    }
  }

  try {
    const png = await page.screenshot({ fullPage: false, type: 'png', timeout: 15000 });
    if (isReasonablePng(png)) {
      console.info('[TokenChartTV] emergency capture success: selector=viewport');
      return png;
    }
  } catch {
    /* */
  }

  return null;
}

/**
 * @param {import('playwright').Frame} frame
 * @param {number} fidx
 * @param {number} bandPx
 */
async function logGeckoToolbarIntervalCandidates(frame, fidx, bandPx) {
  const payload = await frame
    .evaluate(bp => {
      function norm(s) {
        return (s || '').replace(/\s+/g, ' ').trim();
      }
      function looksLikeIntervalText(t) {
        const tn = norm(t);
        if (!tn || tn.length > 14) return false;
        if (!/[sSmMhHdD]/i.test(tn)) return false;
        if (/^\d/.test(tn)) return true;
        if (/^d$/i.test(tn)) return true;
        return false;
      }
      function tokenFromText(full) {
        let t = norm(full).replace(/(\d)\s+([sSmMhHdD])/gi, '$1$2');
        const first = (t.split(/\s+/)[0] || '').toLowerCase();
        return first;
      }

      const rects = [...document.querySelectorAll('canvas')].map(c => c.getBoundingClientRect());
      const valid = rects.filter(r => r.width > 40 && r.height > 30 && r.top >= 0 && r.top < 9000);
      if (!valid.length) return { labels: [], candidates: [], reason: 'no_canvas' };
      const topEdge = Math.min(...valid.map(r => r.top));
      const toolbarMaxY = topEdge + bp;

      const sel =
        'button, a, [role="button"], [role="tab"], [role="menuitem"], div[role="button"], span[role="button"], span, div';
      const seen = new Set();
      const labels = [];
      const candidates = [];

      for (const el of document.querySelectorAll(sel)) {
        if (!(el instanceof HTMLElement)) continue;
        const r = el.getBoundingClientRect();
        if (r.bottom < -400 || r.top > (window.innerHeight || 0) + 400) continue;
        if (r.top > toolbarMaxY) continue;
        if (r.bottom < topEdge - 160) continue;

        const raw = norm(el.textContent);
        if (!looksLikeIntervalText(raw)) continue;
        const token = tokenFromText(raw);
        if (!token || seen.has(token)) continue;
        seen.add(token);
        labels.push(token);
        candidates.push({
          tag: el.tagName,
          text: raw.slice(0, 16),
          token,
          w: Math.round(r.width * 10) / 10,
          h: Math.round(r.height * 10) / 10,
          top: Math.round(r.top),
          ariaPressed: el.getAttribute('aria-pressed'),
          ariaSelected: el.getAttribute('aria-selected'),
          cls: (typeof el.className === 'string' ? el.className : '').slice(0, 80)
        });
        if (labels.length > 32) break;
      }
      return { labels, candidates, topEdge: Math.round(topEdge), toolbarMaxY: Math.round(toolbarMaxY) };
    }, bandPx)
    .catch(() => ({ labels: [], candidates: [], reason: 'evaluate_error' }));

  const { labels, candidates, topEdge, toolbarMaxY, reason } = payload;
  console.info(
    `[TokenChartTV] interval candidates frame[${fidx}] bandPx=${bandPx} topEdge≈${topEdge ?? 'n/a'} toolbarMaxY≈${toolbarMaxY ?? 'n/a'} count=${candidates.length} tokens=[${(labels || []).join(', ')}]${reason ? ` (${reason})` : ''}`
  );
  if (candidates.length) {
    console.info(`[TokenChartTV] interval candidate details frame[${fidx}]: ${JSON.stringify(candidates)}`);
  }
}

/**
 * Dex-style: native el.click() then synthetic pointer/mouse if needed.
 * @param {import('playwright').Frame} frame
 * @param {string} label
 * @param {number} bandPx
 */
async function domClickGeckoToolbarIntervalInFrame(frame, label, bandPx) {
  const wants = geckoIntervalMatchTokens(label);
  const result = await frame
    .evaluate(
      ({ wantList, bp }) => {
        function norm(s) {
          return (s || '').replace(/\s+/g, ' ').trim();
        }
        function tokenFromText(full) {
          let t = norm(full).replace(/(\d)\s+([sSmMhHdD])/gi, '$1$2');
          return (t.split(/\s+/)[0] || '').toLowerCase();
        }

        const rects = [...document.querySelectorAll('canvas')].map(c => c.getBoundingClientRect());
        const valid = rects.filter(r => r.width > 40 && r.height > 30 && r.top >= 0 && r.top < 9000);
        if (!valid.length) return { ok: false, reason: 'no_canvas' };
        const topEdge = Math.min(...valid.map(r => r.top));
        const toolbarMaxY = topEdge + bp;

        const sel =
          'button, a, [role="button"], [role="tab"], [role="menuitem"], div[role="button"], span[role="button"], span, div';
        const nodes = [...document.querySelectorAll(sel)];
        const wantSet = new Set(wantList.map(w => w.toLowerCase()));

        const matches = [];
        for (const el of nodes) {
          if (!(el instanceof HTMLElement)) continue;
          const r = el.getBoundingClientRect();
          if (r.top > toolbarMaxY) continue;
          if (r.bottom < topEdge - 160) continue;
          const full = norm(el.textContent);
          const token = tokenFromText(full);
          if (!wantSet.has(token)) continue;
          matches.push({ el, r, full, token });
        }

        if (!matches.length) return { ok: false, reason: 'no_text_match', wants: wantList };

        const typeRank = el => {
          const tag = el.tagName;
          const role = (el.getAttribute('role') || '').toLowerCase();
          if (tag === 'BUTTON') return 0;
          if (role === 'tab' || role === 'menuitem') return 1;
          if (tag === 'A') return 2;
          if (role === 'button') return 3;
          return 5;
        };

        matches.sort((a, b) => {
          const ra = typeRank(a.el);
          const rb = typeRank(b.el);
          if (ra !== rb) return ra - rb;
          const aa = Math.max(1, a.r.width) * Math.max(1, a.r.height);
          const ba = Math.max(1, b.r.width) * Math.max(1, b.r.height);
          return aa - ba;
        });

        let { el: rawEl, r, full, token } = matches[0];
        let el = rawEl;
        for (let up = 0; up < 6 && el; up++) {
          const br = el.getBoundingClientRect();
          if (br.width >= 2 && br.height >= 2) break;
          el = el.parentElement;
        }
        if (!(el instanceof HTMLElement)) return { ok: false, reason: 'no_target' };

        const box = el.getBoundingClientRect();
        const cx = box.left + Math.max(2, Math.min(box.width / 2, 32));
        const cy = box.top + Math.max(2, Math.min(box.height / 2, 16));
        const view = window;
        let domClickOk = false;
        try {
          el.click();
          domClickOk = true;
        } catch {
          domClickOk = false;
        }

        let usedSynthetic = false;
        if (!domClickOk || box.width < 1 || box.height < 1) {
          usedSynthetic = true;
          const base = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view };
          try {
            el.dispatchEvent(
              new PointerEvent('pointerdown', {
                ...base,
                pointerId: 1,
                pointerType: 'mouse',
                isPrimary: true,
                buttons: 1
              })
            );
          } catch {
            /* */
          }
          el.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons: 1 }));
          try {
            el.dispatchEvent(
              new PointerEvent('pointerup', {
                ...base,
                pointerId: 1,
                pointerType: 'mouse',
                isPrimary: true,
                buttons: 0
              })
            );
          } catch {
            /* */
          }
          el.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 0 }));
          el.dispatchEvent(new MouseEvent('click', base));
        }

        return {
          ok: true,
          matchedText: full || token,
          matchedToken: token,
          domClickOk,
          usedSynthetic,
          targetTag: el.tagName
        };
      },
      { wantList: wants, bp: bandPx }
    )
    .catch(err => ({ ok: false, reason: String(err?.message || err) }));

  return result;
}

async function readGeckoIntervalSelectionSignals(frame, label, bandPx) {
  const wants = geckoIntervalMatchTokens(label);
  return frame
    .evaluate(
      ({ wantList, bp }) => {
        function norm(s) {
          return (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
        }
        function tokenFromText(full) {
          let t = norm(full).replace(/(\d)\s+([sSmMhHdD])/gi, '$1$2');
          return (t.split(/\s+/)[0] || '').toLowerCase();
        }
        const wantSet = new Set(wantList.map(w => w.toLowerCase()));

        const rects = [...document.querySelectorAll('canvas')].map(c => c.getBoundingClientRect());
        const valid = rects.filter(r => r.width > 40 && r.height > 30 && r.top >= 0 && r.top < 9000);
        if (!valid.length) return { found: false, reason: 'no_canvas' };
        const topEdge = Math.min(...valid.map(r => r.top));
        const toolbarMaxY = topEdge + bp;
        const sel =
          'button, a, [role="button"], [role="tab"], [role="menuitem"], div[role="button"], span[role="button"], span, div';
        let best = null;
        for (const el of document.querySelectorAll(sel)) {
          if (!(el instanceof HTMLElement)) continue;
          const r = el.getBoundingClientRect();
          if (r.top > toolbarMaxY) continue;
          if (r.bottom < topEdge - 160) continue;
          const t = tokenFromText(el.textContent || '');
          if (!wantSet.has(t)) continue;
          const pressed = el.getAttribute('aria-pressed') === 'true';
          const selected = el.getAttribute('aria-selected') === 'true';
          const cls = typeof el.className === 'string' ? el.className : '';
          const classLooksActive = /\b(selected|active|current|isActive|is-active|isSelected|is-selected|Mui-selected)\b/i.test(
            cls
          );
          const dataActive =
            el.getAttribute('data-active') === 'true' || el.getAttribute('data-selected') === 'true';
          const ariaCurrent = el.getAttribute('aria-current') === 'true';
          const score =
            (pressed ? 4 : 0) +
            (selected ? 4 : 0) +
            (classLooksActive ? 2 : 0) +
            (dataActive ? 2 : 0) +
            (ariaCurrent ? 2 : 0);
          const row = {
            tag: el.tagName,
            text: norm(el.textContent || '').slice(0, 16),
            ariaPressed: pressed,
            ariaSelected: selected,
            classLooksActive,
            dataActive,
            ariaCurrent,
            cls: cls.slice(0, 100),
            score
          };
          if (!best || score > best.score) best = row;
        }
        if (!best) return { found: false, reason: 'no_matching_node' };
        return { found: true, ...best };
      },
      { wantList: wants, bp: bandPx }
    )
    .catch(() => ({ found: false, reason: 'evaluate_error' }));
}

async function readLargestCanvasDimsInTvFrame(frame) {
  return frame
    .evaluate(() => {
      let best = 0;
      let w = 0;
      let h = 0;
      for (const c of document.querySelectorAll('canvas')) {
        const r = c.getBoundingClientRect();
        const a = r.width * r.height;
        if (a > best) {
          best = a;
          w = r.width;
          h = r.height;
        }
      }
      return { w: Math.round(w * 10) / 10, h: Math.round(h * 10) / 10, a: Math.round(best) };
    })
    .catch(() => null);
}

async function verifyGeckoIntervalChangeAfterClick(page, frame, fidx, label, canvasBefore, bandPx, opts = {}) {
  const envMax = Math.min(5000, Math.max(600, Math.floor(numEnv('CHART_TV_INTERVAL_VERIFY_MS', 2400))));
  let maxMs = envMax;
  if (opts.maxMs != null && Number.isFinite(opts.maxMs)) {
    maxMs = Math.min(envMax, Math.max(200, Math.floor(opts.maxMs)));
  }
  const start = Date.now();
  let lastSignal = 'none';

  while (Date.now() - start < maxMs) {
    await page.waitForTimeout(160);
    const sig = await readGeckoIntervalSelectionSignals(frame, label, bandPx);
    if (
      sig.found &&
      (sig.ariaPressed || sig.ariaSelected || sig.classLooksActive || sig.dataActive || sig.ariaCurrent)
    ) {
      lastSignal = `toolbar_state score=${sig.score} ariaPressed=${sig.ariaPressed} ariaSelected=${sig.ariaSelected} classActive=${sig.classLooksActive} dataActive=${sig.dataActive} ariaCurrent=${sig.ariaCurrent}`;
      console.info(`[TokenChartTV] interval verify frame[${fidx}] label="${label}" OK: ${lastSignal}`);
      return { ok: true, signal: lastSignal, detail: sig };
    }
    const after = await readLargestCanvasDimsInTvFrame(frame);
    if (
      canvasBefore &&
      after &&
      (after.w !== canvasBefore.w ||
        after.h !== canvasBefore.h ||
        Math.abs((after.a || 0) - (canvasBefore.a || 0)) > 500)
    ) {
      lastSignal = `canvas_resize before=${JSON.stringify(canvasBefore)} after=${JSON.stringify(after)}`;
      console.info(`[TokenChartTV] interval verify frame[${fidx}] label="${label}" OK: ${lastSignal}`);
      return { ok: true, signal: lastSignal };
    }
  }

  const sig = await readGeckoIntervalSelectionSignals(frame, label, bandPx);
  if (sig.found) {
    lastSignal = `toolbar_weak text="${sig.text}" score=${sig.score} (no strong selected attrs)`;
    console.info(`[TokenChartTV] interval verify frame[${fidx}] label="${label}" weak: ${lastSignal}`);
    return { ok: false, signal: lastSignal, detail: sig };
  }
  console.info(`[TokenChartTV] interval verify frame[${fidx}] label="${label}" inconclusive: ${lastSignal}`);
  return { ok: false, signal: lastSignal };
}

/**
 * @param {import('playwright').Page} page
 * @param {{ deadline?: number|null }} [opts]
 * @returns {Promise<{ ready: boolean, lastLabels: string[] }>}
 */
async function waitForGeckoIntervalToolbarReady(page, opts = {}) {
  const deadline = opts.deadline != null ? opts.deadline : null;
  const envTimeout = Math.min(5000, Math.max(1200, Math.floor(numEnv('CHART_TV_INTERVAL_TOOLBAR_WAIT_MS', 2200))));
  let timeoutMs = envTimeout;
  if (deadline != null) {
    const rem = tvRemainingMs(deadline);
    const reserveMs = Math.min(22000, Math.max(10000, Math.floor(numEnv('CHART_TV_CAPTURE_POST_TOOLBAR_RESERVE_MS', 15000))));
    timeoutMs = Math.min(envTimeout, Math.max(2500, rem - reserveMs));
  }
  const pollMs = Math.min(600, Math.max(180, Math.floor(numEnv('CHART_TV_INTERVAL_TOOLBAR_POLL_MS', 250))));
  const bandPx = tvToolbarBandPx();

  console.info(
    `[TokenChartTV] waiting for interval toolbar (any token, timeoutMs=${timeoutMs}, bandPx=${bandPx})`
  );

  const start = Date.now();
  let lastLabels = [];

  while (Date.now() - start < timeoutMs && (deadline == null || Date.now() < deadline)) {
    const ranked = await rankFramesByChartCanvasSignal(page);
    for (const row of ranked) {
      if (row.maxA < 4000 && row.sumA < 5000) continue;
      const { frame, index: fidx } = row;

      const probe = await frame
        .evaluate(
          ({ bp }) => {
            function norm(s) {
              return (s || '').replace(/\s+/g, ' ').trim();
            }
            function tokenFromText(full) {
              let t = norm(full).replace(/(\d)\s+([sSmMhHdD])/gi, '$1$2');
              return (t.split(/\s+/)[0] || '').toLowerCase();
            }

            const rects = [...document.querySelectorAll('canvas')].map(c => c.getBoundingClientRect());
            const valid = rects.filter(r => r.width > 40 && r.height > 30 && r.top >= 0 && r.top < 9000);
            if (!valid.length) return { ready: false, labels: [] };

            const topEdge = Math.min(...valid.map(r => r.top));
            const toolbarMaxY = topEdge + bp;
            const sel =
              'button, a, [role="button"], [role="tab"], [role="menuitem"], div[role="button"], span[role="button"], span, div';

            const seen = new Set();
            const labels = [];

            for (const el of document.querySelectorAll(sel)) {
              if (!(el instanceof HTMLElement)) continue;
              const r = el.getBoundingClientRect();
              if (r.bottom < -400 || r.top > (window.innerHeight || 0) + 400) continue;
              if (r.top > toolbarMaxY) continue;
              if (r.bottom < topEdge - 160) continue;

              const raw = norm(el.textContent);
              if (!raw || raw.length > 14) continue;
              if (!/[sSmMhHdD]/i.test(raw)) continue;
              if (!/^\d/.test(raw) && !/^d$/i.test(raw.split(/\s+/)[0])) continue;

              const token = tokenFromText(raw);
              if (!token) continue;

              if (seen.has(token)) continue;
              seen.add(token);
              labels.push(token);
            }

            labels.sort();
            return { ready: labels.length > 0, labels };
          },
          { bp: bandPx }
        )
        .catch(() => ({ ready: false, labels: [] }));

      lastLabels = probe.labels || [];
      if (probe.ready) {
        console.info(`[TokenChartTV] interval toolbar ready frame[${fidx}] labels=[${lastLabels.join(', ')}]`);
        return { ready: true, lastLabels };
      }
    }

    await page.waitForTimeout(pollMs);
  }

  console.warn(
    `[TokenChartTV] interval toolbar NOT ready after ${timeoutMs}ms lastLabels=[${(lastLabels || []).join(', ')}]`
  );
  return { ready: false, lastLabels: lastLabels || [] };
}

/**
 * Union of interval tokens visible in the chart toolbar band across ranked frames (lowercase).
 * @param {import('playwright').Page} page
 * @param {number} bandPx
 * @returns {Promise<Set<string>>}
 */
async function collectGeckoIntervalTokensUnion(page, bandPx) {
  const ranked = await rankFramesByChartCanvasSignal(page);
  const union = new Set();
  for (const row of ranked) {
    if (row.maxA < 4000 && row.sumA < 5000) continue;
    const { frame } = row;
    const labels = await frame
      .evaluate(
        (bp) => {
          function norm(s) {
            return (s || '').replace(/\s+/g, ' ').trim();
          }
          function tokenFromText(full) {
            let t = norm(full).replace(/(\d)\s+([sSmMhHdD])/gi, '$1$2');
            return (t.split(/\s+/)[0] || '').toLowerCase();
          }
          const rects = [...document.querySelectorAll('canvas')].map(c => c.getBoundingClientRect());
          const valid = rects.filter(r => r.width > 40 && r.height > 30 && r.top >= 0 && r.top < 9000);
          if (!valid.length) return [];

          const topEdge = Math.min(...valid.map(r => r.top));
          const toolbarMaxY = topEdge + bp;
          const sel =
            'button, a, [role="button"], [role="tab"], [role="menuitem"], div[role="button"], span[role="button"], span, div';

          const seen = new Set();
          const out = [];
          for (const el of document.querySelectorAll(sel)) {
            if (!(el instanceof HTMLElement)) continue;
            const r = el.getBoundingClientRect();
            if (r.bottom < -400 || r.top > (window.innerHeight || 0) + 400) continue;
            if (r.top > toolbarMaxY) continue;
            if (r.bottom < topEdge - 160) continue;

            const raw = norm(el.textContent);
            if (!raw || raw.length > 14) continue;
            if (!/[sSmMhHdD]/i.test(raw)) continue;
            if (!/^\d/.test(raw) && !/^d$/i.test(raw.split(/\s+/)[0])) continue;

            const token = tokenFromText(raw);
            if (!token) continue;
            if (seen.has(token)) continue;
            seen.add(token);
            out.push(token);
          }
          return out;
        },
        bandPx
      )
      .catch(() => []);
    for (const t of labels || []) union.add(String(t).toLowerCase());
  }
  return union;
}

/**
 * Strict interval selection: toolbar must be ready; no main-frame “pick any matching token” fallback.
 * Success only when verification confirms the intended label.
 * @param {import('playwright').Page} page
 * @param {{ deadline?: number|null }} [opts]
 */
async function trySelectGeckoIntervals(page, opts = {}) {
  const deadline = opts.deadline != null ? opts.deadline : null;
  const order = getTvIntervalOrder();
  const bandPx = tvToolbarBandPx();
  console.info(`[TokenChartTV] interval selection start order=${order.join(',')} bandPx=${bandPx}`);

  const toolbarProbe = await waitForGeckoIntervalToolbarReady(page, { deadline });
  if (!toolbarProbe.ready) {
    console.warn(
      '[TokenChartTV] interval toolbar not found after wait — aborting interval selection (no main-frame fallback)'
    );
    return {
      toolbarFound: false,
      selectedInterval: null,
      selectedBy: null,
      intervalConfirmed: false,
      detachedUnrecoverable: false
    };
  }

  const availableTokens = await collectGeckoIntervalTokensUnion(page, bandPx);
  console.info(
    `[TokenChartTV] interval toolbar tokens union count=${availableTokens.size} tokens=[${[...availableTokens].sort().join(', ')}]`
  );

  let selectedInterval = null;
  /** @type {'dom'|'playwright'|null} */
  let selectedBy = null;
  let intervalConfirmed = false;
  let detachedUnrecoverable = false;

  /**
   * @param {number} rankPass
   * @param {import('playwright').Frame} frame
   * @param {number|string} fidx
   * @param {string} label
   * @returns {Promise<{ kind: 'ok'|'fail'|'detached_retry'|'detached_fatal'; signal?: string; by?: 'dom'|'playwright'; failReason?: string }>}
   */
  async function attemptIntervalLabelOnFrame(rankPass, frame, fidx, label) {
    const rem = tvRemainingMs(deadline);
    const verifyCap = Math.max(250, Math.min(2400, Math.max(200, rem - 120)));
    const clickTimeout = Math.min(2500, Math.max(250, rem));
    const clickTimeoutShort = Math.min(1800, Math.max(250, rem));
    const wants = geckoIntervalMatchTokens(label);

    let canvasBefore = null;
    try {
      canvasBefore = await readLargestCanvasDimsInTvFrame(frame);
    } catch (e) {
      if (isDetachedFrameError(e) && rankPass === 0) return { kind: 'detached_retry' };
      if (isDetachedFrameError(e) && rankPass === 1) return { kind: 'detached_fatal' };
      throw e;
    }

    let lastFail = 'canvas_read_failed';

    console.info(
      `[TokenChartTV] interval dom attempt label="${label}" matchTokens=[${wants.join(',')}] frame[${fidx}]`
    );
    let dom = { ok: false, reason: 'skipped' };
    try {
      dom = await domClickGeckoToolbarIntervalInFrame(frame, label, bandPx);
    } catch (e) {
      if (isDetachedFrameError(e) && rankPass === 0) return { kind: 'detached_retry' };
      if (isDetachedFrameError(e) && rankPass === 1) return { kind: 'detached_fatal' };
      lastFail = `dom_error:${String(e?.message || e).slice(0, 120)}`;
      dom = { ok: false, reason: lastFail };
    }

    if (dom.ok) {
      console.info(
        `[TokenChartTV] interval dom result label="${label}" frame[${fidx}] matchedText="${dom.matchedText}" matchedToken="${dom.matchedToken}" nativeClick=${dom.domClickOk} syntheticEvents=${dom.usedSynthetic} targetTag=${dom.targetTag}`
      );
      const ver = await verifyGeckoIntervalChangeAfterClick(page, frame, fidx, label, canvasBefore, bandPx, {
        maxMs: verifyCap
      });
      console.info(
        `[TokenChartTV] interval post-click verify label="${label}" frame[${fidx}] confirmed=${ver.ok} signal=${ver.signal}`
      );
      if (ver.ok) return { kind: 'ok', signal: ver.signal, by: 'dom' };
      lastFail = 'dom_click_verify_rejected';
      console.info(`[TokenChartTV] interval dom verify rejected label="${label}" frame[${fidx}] — trying next method`);
    } else {
      lastFail = `dom:${dom.reason || 'unknown'}`;
      console.info(`[TokenChartTV] interval dom miss label="${label}" frame[${fidx}] reason=${dom.reason || 'unknown'}`);
    }

    const esc = escapeIntervalLabelForRegex(label);
    console.info(`[TokenChartTV] interval playwright force attempt label="${label}" frame[${fidx}]`);
    try {
      const loc = frame.getByRole('button', { name: new RegExp(`^\\s*${esc}\\s*$`, 'i') }).first();
      await loc.click({ timeout: clickTimeout, force: true });
      console.info(
        `[TokenChartTV] interval playwright force OK label="${label}" frame[${fidx}] nativeClick=playwright_force syntheticEvents=false`
      );
      const ver = await verifyGeckoIntervalChangeAfterClick(page, frame, fidx, label, canvasBefore, bandPx, {
        maxMs: verifyCap
      });
      console.info(
        `[TokenChartTV] interval post-click verify label="${label}" frame[${fidx}] confirmed=${ver.ok} signal=${ver.signal}`
      );
      if (ver.ok) return { kind: 'ok', signal: ver.signal, by: 'playwright' };
      lastFail = 'playwright_force_verify_rejected';
      console.info(`[TokenChartTV] interval playwright force verify rejected label="${label}" frame[${fidx}]`);
    } catch (err) {
      if (isDetachedFrameError(err) && rankPass === 0) return { kind: 'detached_retry' };
      if (isDetachedFrameError(err) && rankPass === 1) return { kind: 'detached_fatal' };
      lastFail = `playwright_force:${String(err?.message || err).slice(0, 120)}`;
      console.info(
        `[TokenChartTV] interval playwright force miss label="${label}" frame[${fidx}] ${err?.message || err}`
      );
    }

    try {
      const exactLoc = frame.getByText(label, { exact: true }).first();
      await exactLoc.click({ timeout: clickTimeoutShort, force: true });
      console.info(
        `[TokenChartTV] interval playwright getByText OK label="${label}" frame[${fidx}] nativeClick=playwright_force syntheticEvents=false`
      );
      const ver = await verifyGeckoIntervalChangeAfterClick(page, frame, fidx, label, canvasBefore, bandPx, {
        maxMs: verifyCap
      });
      console.info(
        `[TokenChartTV] interval post-click verify label="${label}" frame[${fidx}] confirmed=${ver.ok} signal=${ver.signal}`
      );
      if (ver.ok) return { kind: 'ok', signal: ver.signal, by: 'playwright' };
      lastFail = 'getByText_verify_rejected';
      console.info(`[TokenChartTV] interval playwright getByText verify rejected label="${label}" frame[${fidx}]`);
    } catch (err) {
      if (isDetachedFrameError(err) && rankPass === 0) return { kind: 'detached_retry' };
      if (isDetachedFrameError(err) && rankPass === 1) return { kind: 'detached_fatal' };
      lastFail = `getByText:${String(err?.message || err).slice(0, 120)}`;
      console.info(
        `[TokenChartTV] interval playwright getByText miss label="${label}" frame[${fidx}] ${err?.message || err}`
      );
    }

    return { kind: 'fail', failReason: lastFail };
  }

  outer: for (let rankPass = 0; rankPass < 2; rankPass++) {
    const ranked = await rankFramesByChartCanvasSignal(page);

    for (const row of ranked) {
      if (row.maxA < 4000 && row.sumA < 5000) continue;
      const { frame, index: fidx } = row;
      try {
        await logGeckoToolbarIntervalCandidates(frame, fidx, bandPx);
      } catch (e) {
        if (isDetachedFrameError(e) && rankPass === 0) {
          console.warn('[TokenChartTV] detached frame during interval toolbar probe — reacquiring once');
          await page.waitForTimeout(250);
          continue outer;
        }
        if (isDetachedFrameError(e) && rankPass === 1) {
          detachedUnrecoverable = true;
          break outer;
        }
        throw e;
      }
    }

    for (const label of order) {
      if (availableTokens.size > 0) {
        const matchToks = geckoIntervalMatchTokens(label).map(t => String(t).toLowerCase());
        const hasAny = matchToks.some(t => availableTokens.has(t));
        if (!hasAny) {
          console.info(`[TokenChartTV] interval skip label="${label}" reason=not_in_toolbar`);
          continue;
        }
      }
      console.info(`[TokenChartTV] interval candidate attempt start label="${label}"`);
      let lastReason = 'no_eligible_chart_frame';

      for (const row of ranked) {
        if (row.maxA < 4000 && row.sumA < 5000) continue;
        const { frame, index: fidx } = row;

        const r = await attemptIntervalLabelOnFrame(rankPass, frame, fidx, label);
        if (r.kind === 'detached_retry') {
          console.warn('[TokenChartTV] detached frame during interval attempt — reacquiring once');
          await page.waitForTimeout(250);
          continue outer;
        }
        if (r.kind === 'detached_fatal') {
          detachedUnrecoverable = true;
          break outer;
        }
        if (r.kind === 'ok') {
          selectedInterval = label;
          selectedBy = r.by || 'playwright';
          intervalConfirmed = true;
          console.info(
            `[TokenChartTV] interval candidate success label="${label}" signal=${r.signal != null ? r.signal : 'n/a'}`
          );
          await page.waitForTimeout(Math.min(450, Math.max(0, tvRemainingMs(deadline))));
          break outer;
        }
        lastReason = r.failReason || 'attempt_failed';
      }

      if (!selectedInterval) {
        console.info(`[TokenChartTV] interval candidate failed label="${label}" reason=${lastReason}`);
      }
    }
  }

  if (!selectedInterval) {
    console.warn(`[TokenChartTV] interval selection exhausted — no verified interval for order=${order.join(',')}`);
  }

  return {
    toolbarFound: true,
    selectedInterval,
    selectedBy,
    intervalConfirmed,
    detachedUnrecoverable
  };
}

/** ---------- Gecko chart metric: Price vs MCAP (toolbar band) ---------- */

function metricEvaluatePayload(bandMetricPx, topSlackPx) {
  return { bandMetric: bandMetricPx, topSlack: topSlackPx };
}

/**
 * @param {import('playwright').Frame} frame
 * @param {number} fidx
 * @param {number} bandMetricPx
 * @param {number} topSlackPx
 */
async function logGeckoMetricToolbarCandidates(frame, fidx, bandMetricPx, topSlackPx) {
  const payload = await frame
    .evaluate(
      ({ bandMetric, topSlack }) => {
        function norm(s) {
          return (s || '').replace(/\s+/g, ' ').trim();
        }
        function isMcapText(t) {
          const x = norm(t).toLowerCase();
          return x === 'mcap' || x === 'm cap' || x === 'market cap' || x === 'marketcap';
        }
        function isPriceOnlyText(t) {
          const x = norm(t).toLowerCase();
          return x === 'price' || x === 'usd' || x === 'price (usd)' || x === 'price(usd)';
        }
        function looksMetricRelated(t) {
          const x = norm(t);
          if (!x || x.length > 36) return false;
          if (/mcap|market\s*cap|marketcap/i.test(x)) return true;
          if (isPriceOnlyText(x)) return true;
          if (/price/i.test(x) && /mcap|market/i.test(x)) return true;
          return false;
        }

        const rects = [...document.querySelectorAll('canvas')].map(c => c.getBoundingClientRect());
        const valid = rects.filter(r => r.width > 40 && r.height > 30 && r.top >= 0 && r.top < 9000);
        if (!valid.length) return { candidates: [], reason: 'no_canvas' };

        const topEdge = Math.min(...valid.map(r => r.top));
        const minY = topEdge - topSlack;
        const maxY = topEdge + bandMetric;

        const sel =
          'button, a, [role="button"], [role="tab"], [role="menuitem"], div[role="button"], span[role="button"], span, div';
        const candidates = [];

        for (const el of document.querySelectorAll(sel)) {
          if (!(el instanceof HTMLElement)) continue;
          const r = el.getBoundingClientRect();
          if (r.top < minY || r.top > maxY) continue;
          if (r.bottom < topEdge - 220) continue;
          if (r.width > 480 && r.height > 140) continue;

          const raw = norm(el.textContent);
          if (!looksMetricRelated(raw)) continue;

          let kind = 'other';
          if (isMcapText(raw)) kind = 'mcap';
          else if (isPriceOnlyText(raw) && raw.length < 18) kind = 'price';
          else if (/price/i.test(raw) && /mcap|market/i.test(raw)) kind = 'mixed';

          candidates.push({
            tag: el.tagName,
            text: raw.slice(0, 36),
            kind,
            w: Math.round(r.width * 10) / 10,
            h: Math.round(r.height * 10) / 10,
            top: Math.round(r.top),
            ariaPressed: el.getAttribute('aria-pressed'),
            ariaSelected: el.getAttribute('aria-selected'),
            cls: (typeof el.className === 'string' ? el.className : '').slice(0, 80)
          });
          if (candidates.length > 40) break;
        }

        return {
          candidates,
          topEdge: Math.round(topEdge),
          minY: Math.round(minY),
          maxY: Math.round(maxY)
        };
      },
      metricEvaluatePayload(bandMetricPx, topSlackPx)
    )
    .catch(() => ({ candidates: [], reason: 'evaluate_error' }));

  const { candidates, topEdge, minY, maxY, reason } = payload;
  console.info(
    `[TokenChartTV] metric candidates frame[${fidx}] topEdge≈${topEdge ?? 'n/a'} band=[${minY ?? '?'}-${maxY ?? '?'}] count=${candidates.length}${reason ? ` (${reason})` : ''}`
  );
  if (candidates.length) {
    console.info(`[TokenChartTV] metric candidate details frame[${fidx}]: ${JSON.stringify(candidates)}`);
  }
}

/**
 * @param {import('playwright').Frame} frame
 * @param {number} fidx
 * @param {string} wanted
 * @param {number} bandMetricPx
 * @param {number} topSlackPx
 */
async function domClickGeckoMetricMcapInFrame(frame, fidx, wanted, bandMetricPx, topSlackPx) {
  const w = String(wanted || 'mcap').toLowerCase();
  if (w !== 'mcap') return { ok: false, reason: 'only_mcap_supported' };

  const result = await frame
    .evaluate(
      ({ bandMetric, topSlack }) => {
        function norm(s) {
          return (s || '').replace(/\s+/g, ' ').trim();
        }
        function isMcapLabel(s) {
          const t = norm(s).toLowerCase();
          return t === 'mcap' || t === 'm cap' || t === 'market cap' || t === 'marketcap';
        }
        function isPriceOnlyLabel(s) {
          const t = norm(s).toLowerCase();
          return t === 'price' || t === 'usd' || t === 'price (usd)' || t === 'price(usd)';
        }

        const rects = [...document.querySelectorAll('canvas')].map(c => c.getBoundingClientRect());
        const valid = rects.filter(r => r.width > 40 && r.height > 30 && r.top >= 0 && r.top < 9000);
        if (!valid.length) return { ok: false, reason: 'no_canvas' };

        const topEdge = Math.min(...valid.map(r => r.top));
        const minY = topEdge - topSlack;
        const maxY = topEdge + bandMetric;

        const sel =
          'button, a, [role="button"], [role="tab"], [role="menuitem"], div[role="button"], span[role="button"], span, div';
        const nodes = [...document.querySelectorAll(sel)];

        const typeRank = el => {
          const tag = el.tagName;
          const role = (el.getAttribute('role') || '').toLowerCase();
          if (tag === 'BUTTON') return 0;
          if (role === 'tab' || role === 'menuitem') return 1;
          if (tag === 'A') return 2;
          if (role === 'button') return 3;
          return 5;
        };

        const picks = [];

        for (const el of nodes) {
          if (!(el instanceof HTMLElement)) continue;
          const r = el.getBoundingClientRect();
          if (r.top < minY || r.top > maxY) continue;
          if (r.bottom < topEdge - 220) continue;
          if (r.width > 480 && r.height > 140) continue;

          const rawAll = norm(el.textContent);
          const isToggleCluster =
            /price/i.test(rawAll) && /mcap|market\s*cap|marketcap/i.test(rawAll) && rawAll.length < 44;

          if (isToggleCluster) {
            const innerSel = 'span, button, a, [role="tab"], [role="button"], div, label';
            for (const kid of el.querySelectorAll(innerSel)) {
              if (!(kid instanceof HTMLElement)) continue;
              if (!el.contains(kid) || kid === el) continue;
              const ktRaw = (kid.textContent || '').replace(/\s+/g, ' ').trim();
              const kt = norm(ktRaw);
              if (!kt || kt.length > 22) continue;
              const kr = kid.getBoundingClientRect();
              if (kr.width < 2 || kr.height < 2) continue;
              if (/^mcap$/i.test(ktRaw) || isMcapLabel(ktRaw) || /^market\s*cap$/i.test(ktRaw)) {
                picks.push({ el: kid, r: kr, full: ktRaw, token: 'mcap', pri: -1 });
              }
            }
            continue;
          }

          if (isPriceOnlyLabel(rawAll) && el.querySelectorAll('button, [role="button"], span, div').length <= 1) {
            continue;
          }

          if (isMcapLabel(rawAll)) {
            picks.push({ el, r, full: rawAll, token: 'mcap', pri: 0 });
            continue;
          }

          const innerSel = 'button, a, [role="button"], [role="tab"], span, div';
          for (const kid of el.querySelectorAll(innerSel)) {
            if (!(kid instanceof HTMLElement)) continue;
            if (kid === el) continue;
            if (!el.contains(kid)) continue;
            const kr = kid.getBoundingClientRect();
            if (kr.width < 2 || kr.height < 2) continue;
            const kt = norm(kid.textContent);
            if (!isMcapLabel(kt)) continue;
            picks.push({ el: kid, r: kr, full: kt, token: 'mcap', pri: 1 });
            break;
          }

          if (/price/i.test(rawAll) && /mcap|market\s*cap|marketcap/i.test(rawAll) && rawAll.length < 32) {
            const segs = rawAll.split(/\s*[/·]\s*/);
            if (segs.length >= 2) {
              const right = norm(segs[segs.length - 1]);
              if (isMcapLabel(right)) {
                picks.push({ el, r, full: rawAll, token: 'mcap', pri: 2 });
              }
            }
          }
        }

        if (!picks.length) {
          for (const el of nodes) {
            if (!(el instanceof HTMLElement)) continue;
            const r = el.getBoundingClientRect();
            if (r.top < minY || r.top > maxY) continue;
            if (r.bottom < topEdge - 220) continue;
            const rawAll = norm(el.textContent);
            if (!/price/i.test(rawAll) || !/mcap|market/i.test(rawAll)) continue;
            if (rawAll.length > 44 || r.width < 28 || r.height < 8) continue;
            const cx = r.left + r.width * 0.78;
            const cy = r.top + r.height / 2;
            const view = window;
            const base = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view };
            try {
              el.dispatchEvent(
                new PointerEvent('pointerdown', {
                  ...base,
                  pointerId: 1,
                  pointerType: 'mouse',
                  isPrimary: true,
                  buttons: 1
                })
              );
            } catch {
              /* */
            }
            el.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons: 1 }));
            try {
              el.dispatchEvent(
                new PointerEvent('pointerup', {
                  ...base,
                  pointerId: 1,
                  pointerType: 'mouse',
                  isPrimary: true,
                  buttons: 0
                })
              );
            } catch {
              /* */
            }
            el.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 0 }));
            el.dispatchEvent(new MouseEvent('click', base));
            return {
              ok: true,
              matchedText: el.textContent.replace(/\s+/g, ' ').trim().slice(0, 40),
              matchedToken: 'mcap',
              domClickOk: false,
              usedSynthetic: true,
              targetTag: el.tagName + '+clusterTap'
            };
          }
        }

        if (!picks.length) return { ok: false, reason: 'no_mcap_target' };

        picks.sort((a, b) => {
          if (a.pri !== b.pri) return a.pri - b.pri;
          const ra = typeRank(a.el);
          const rb = typeRank(b.el);
          if (ra !== rb) return ra - rb;
          const aa = Math.max(1, a.r.width) * Math.max(1, a.r.height);
          const ba = Math.max(1, b.r.width) * Math.max(1, b.r.height);
          return aa - ba;
        });

        let { el: rawEl, r, full, token } = picks[0];
        let el = rawEl;
        for (let up = 0; up < 6 && el; up++) {
          const br = el.getBoundingClientRect();
          if (br.width >= 2 && br.height >= 2) break;
          el = el.parentElement;
        }
        if (!(el instanceof HTMLElement)) return { ok: false, reason: 'no_target' };

        const box = el.getBoundingClientRect();
        const cx = box.left + Math.max(2, Math.min(box.width / 2, 36));
        const cy = box.top + Math.max(2, Math.min(box.height / 2, 18));
        const view = window;
        let domClickOk = false;
        try {
          el.click();
          domClickOk = true;
        } catch {
          domClickOk = false;
        }

        let usedSynthetic = false;
        if (!domClickOk || box.width < 1 || box.height < 1) {
          usedSynthetic = true;
          const base = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view };
          try {
            el.dispatchEvent(
              new PointerEvent('pointerdown', {
                ...base,
                pointerId: 1,
                pointerType: 'mouse',
                isPrimary: true,
                buttons: 1
              })
            );
          } catch {
            /* */
          }
          el.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons: 1 }));
          try {
            el.dispatchEvent(
              new PointerEvent('pointerup', {
                ...base,
                pointerId: 1,
                pointerType: 'mouse',
                isPrimary: true,
                buttons: 0
              })
            );
          } catch {
            /* */
          }
          el.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 0 }));
          el.dispatchEvent(new MouseEvent('click', base));
        }

        return {
          ok: true,
          matchedText: full || token,
          matchedToken: token,
          domClickOk,
          usedSynthetic,
          targetTag: el.tagName
        };
      },
      metricEvaluatePayload(bandMetricPx, topSlackPx)
    )
    .catch(err => ({ ok: false, reason: String(err?.message || err) }));

  return result;
}

async function readGeckoMetricSelectionSignals(frame, bandMetricPx, topSlackPx) {
  return frame
    .evaluate(
      ({ bandMetric, topSlack }) => {
        function norm(s) {
          return (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
        }
        function isMcapLabel(s) {
          const t = norm(s);
          return t === 'mcap' || t === 'm cap' || t === 'market cap' || t === 'marketcap';
        }
        function isPriceOnlyLabel(s) {
          const t = norm(s);
          return t === 'price' || t === 'usd' || t === 'price (usd)' || t === 'price(usd)';
        }
        function ariaScore(el) {
          const pressed = el.getAttribute('aria-pressed') === 'true';
          const selected = el.getAttribute('aria-selected') === 'true';
          const cls = typeof el.className === 'string' ? el.className : '';
          const classLooksActive = /\b(selected|active|current|isActive|is-active|isSelected|is-selected|Mui-selected)\b/i.test(
            cls
          );
          const dataActive =
            el.getAttribute('data-active') === 'true' || el.getAttribute('data-selected') === 'true';
          const ariaCurrent = el.getAttribute('aria-current') === 'true';
          return (
            (pressed ? 5 : 0) +
            (selected ? 5 : 0) +
            (classLooksActive ? 3 : 0) +
            (dataActive ? 3 : 0) +
            (ariaCurrent ? 3 : 0)
          );
        }

        let titleMarketCap = false;
        if (/\(\s*Market\s*Cap\s*\)/i.test(document.title || '')) titleMarketCap = true;
        if (!titleMarketCap) {
          for (const h of document.querySelectorAll(
            '[class*="title"], [class*="header"], [class*="symbol"], [data-symbol], .js-symbol-link'
          )) {
            if (!(h instanceof HTMLElement)) continue;
            const t = (h.textContent || '').replace(/\s+/g, ' ').trim();
            if (/\(\s*Market\s*Cap\s*\)/i.test(t)) {
              titleMarketCap = true;
              break;
            }
          }
        }

        const rects = [...document.querySelectorAll('canvas')].map(c => c.getBoundingClientRect());
        const valid = rects.filter(r => r.width > 40 && r.height > 30 && r.top >= 0 && r.top < 9000);
        if (!valid.length) {
          return {
            found: false,
            reason: 'no_canvas',
            titleMarketCap,
            mcapActive: titleMarketCap,
            mcapScore: -1,
            priceScore: -1,
            mcapText: '',
            priceText: ''
          };
        }

        const topEdge = Math.min(...valid.map(r => r.top));
        const minY = topEdge - topSlack;
        const maxY = topEdge + bandMetric;

        const sel =
          'button, a, [role="button"], [role="tab"], [role="menuitem"], div[role="button"], span[role="button"], span, div';

        let bestMcap = { score: -1, text: '', tag: '' };
        let bestPrice = { score: -1, text: '', tag: '' };

        for (const el of document.querySelectorAll(sel)) {
          if (!(el instanceof HTMLElement)) continue;
          const r = el.getBoundingClientRect();
          if (r.top < minY || r.top > maxY) continue;
          if (r.bottom < topEdge - 220) continue;

          const display = (el.textContent || '').replace(/\s+/g, ' ').trim();
          const raw = norm(display);
          if (!raw) continue;

          const isToggleCluster =
            /price/i.test(display) &&
            /mcap|market\s*cap|marketcap/i.test(display) &&
            display.length < 44;

          if (isToggleCluster) {
            const innerSel = 'span, button, a, [role="tab"], [role="button"], div, label';
            for (const kid of el.querySelectorAll(innerSel)) {
              if (!(kid instanceof HTMLElement)) continue;
              if (!el.contains(kid) || kid === el) continue;
              const kdRaw = (kid.textContent || '').replace(/\s+/g, ' ').trim();
              const kd = norm(kdRaw);
              if (!kd || kd.length > 22) continue;
              const ksc = ariaScore(kid);
              if (/^mcap$/i.test(kdRaw.trim()) || isMcapLabel(kdRaw) || /^market\s*cap$/i.test(kdRaw.trim())) {
                if (ksc > bestMcap.score) {
                  bestMcap = { score: ksc, text: kdRaw.slice(0, 24), tag: kid.tagName };
                }
              }
              if (isPriceOnlyLabel(kdRaw) || /^price$/i.test(kdRaw.trim())) {
                if (ksc > bestPrice.score) {
                  bestPrice = { score: ksc, text: kdRaw.slice(0, 24), tag: kid.tagName };
                }
              }
            }
            continue;
          }

          if (raw.length > 28) continue;

          const sc = ariaScore(el);
          const firstTok = (display.split(/\s+/)[0] || '').toLowerCase();
          const looksMcap =
            isMcapLabel(display) ||
            /^market cap$/i.test(display) ||
            (display.length <= 16 && /^(mcap|m cap|marketcap)$/i.test(display));
          if (looksMcap) {
            if (sc > bestMcap.score) {
              bestMcap = {
                score: sc,
                text: display.slice(0, 24),
                tag: el.tagName
              };
            }
          }
          if (isPriceOnlyLabel(firstTok) || isPriceOnlyLabel(display)) {
            if (sc > bestPrice.score) {
              bestPrice = {
                score: sc,
                text: display.slice(0, 24),
                tag: el.tagName
              };
            }
          }
        }

        const strongToolbar =
          bestMcap.score >= 3 && bestMcap.score > bestPrice.score && bestMcap.text;
        const mcapWinsNoPrice = bestMcap.score >= 2 && bestPrice.score < 0 && bestMcap.text;
        const mcapActive = !!(titleMarketCap || strongToolbar || mcapWinsNoPrice);

        return {
          found: bestMcap.score >= 0 || bestPrice.score >= 0 || titleMarketCap,
          titleMarketCap,
          mcapActive,
          mcapScore: bestMcap.score,
          priceScore: bestPrice.score,
          mcapText: bestMcap.text,
          priceText: bestPrice.text
        };
      },
      metricEvaluatePayload(bandMetricPx, topSlackPx)
    )
    .catch(() => ({ found: false, reason: 'evaluate_error' }));
}

async function verifyGeckoMetricAfterClick(page, frame, fidx, wanted, bandMetricPx, topSlackPx, opts = {}) {
  const envMax = Math.min(5000, Math.max(500, Math.floor(numEnv('CHART_TV_METRIC_VERIFY_MS', 2400))));
  let maxMs = envMax;
  if (opts.maxMs != null && Number.isFinite(opts.maxMs)) {
    maxMs = Math.min(envMax, Math.max(200, Math.floor(opts.maxMs)));
  }
  const start = Date.now();
  let last = 'none';

  while (Date.now() - start < maxMs) {
    await page.waitForTimeout(140);
    const sig = await readGeckoMetricSelectionSignals(frame, bandMetricPx, topSlackPx);
    if (sig.mcapActive || sig.titleMarketCap) {
      last = `toolbar_state titleMarketCap=${!!sig.titleMarketCap} mcapActive=${!!sig.mcapActive} mcapScore=${sig.mcapScore} priceScore=${sig.priceScore} mcapText="${sig.mcapText}"`;
      console.info(`[TokenChartTV] metric verify frame[${fidx}] label="mcap" OK: ${last}`);
      return { ok: true, signal: last, detail: sig };
    }
  }

  const sig = await readGeckoMetricSelectionSignals(frame, bandMetricPx, topSlackPx);
  last = `mcapScore=${sig.mcapScore} priceScore=${sig.priceScore} mcapActive=${sig.mcapActive} titleMarketCap=${!!sig.titleMarketCap}`;
  console.info(`[TokenChartTV] metric verify frame[${fidx}] label="mcap" weak/inconclusive: ${last}`);
  return { ok: false, signal: last, detail: sig };
}

/**
 * Pre-check: MCAP already selected in a chart frame (no click).
 * @param {import('playwright').Page} page
 */
async function readGeckoMcapTrustedOnBestFrame(page) {
  const bandM = tvMetricToolbarBandPx();
  const topSlack = tvMetricTopSlackPx();
  const ranked = await rankFramesByChartCanvasSignal(page);
  for (const row of ranked) {
    if (row.maxA < 4000 && row.sumA < 5000) continue;
    const { frame, index: fidx } = row;
    const sig = await readGeckoMetricSelectionSignals(frame, bandM, topSlack);
    if (sig.mcapActive) return { ok: true, fidx, detail: sig };
  }
  return { ok: false };
}

/**
 * Infer Price vs Market Cap from body, titles, chart chrome, and toolbar-band text (all frames).
 * @param {import('playwright').Page} page
 * @returns {Promise<{ metricInferredFromTitle: boolean, inferredMetric: 'mcap'|'price'|null, matchedText: string|null }>}
 */
async function inferGeckoMetricMode(page) {
  const bandPx = tvToolbarBandPx();
  const bandMetricPx = tvMetricToolbarBandPx();
  const topSlackPx = tvMetricTopSlackPx();
  let blob = '';

  for (const frame of page.frames()) {
    try {
      const chunk = await frame.evaluate(
        ({ bp, bandMetric, topSlack }) => {
          const parts = [];
          if (document.title) parts.push(document.title);
          const body = document.body && (document.body.innerText || '');
          if (body) parts.push(body.slice(0, 32000));

          const roots = document.querySelectorAll(
            '[class*="chart-widget"], [class*="tv-lightweight"], [class*="Chart"], [class*="chart-container"], main, [id*="chart"], [id*="tv-"]'
          );
          for (const root of roots) {
            const t = (root.textContent || '').replace(/\s+/g, ' ').trim();
            if (t && t.length < 14000) parts.push(t);
          }

          const rects = [...document.querySelectorAll('canvas')].map(c => c.getBoundingClientRect());
          const valid = rects.filter(r => r.width > 40 && r.height > 30 && r.top >= 0 && r.top < 9000);
          if (valid.length) {
            const topEdge = Math.min(...valid.map(r => r.top));
            const minY = topEdge - topSlack;
            const maxY = topEdge + bp + bandMetric + 48;
            const sel =
              'button, a, [role="button"], [role="tab"], [role="menuitem"], div[role="button"], span[role="button"], span, div';
            const bits = [];
            for (const el of document.querySelectorAll(sel)) {
              if (!(el instanceof HTMLElement)) continue;
              const r = el.getBoundingClientRect();
              if (r.top < minY || r.top > maxY) continue;
              if (r.bottom < topEdge - 200) continue;
              if (r.width > 520 && r.height > 160) continue;
              const raw = (el.textContent || '').replace(/\s+/g, ' ').trim();
              if (raw && raw.length < 64) bits.push(raw);
              if (bits.length > 80) break;
            }
            if (bits.length) parts.push(bits.join(' | '));
          }

          return parts.join('\n').slice(0, 48000);
        },
        { bp: bandPx, bandMetric: bandMetricPx, topSlack: topSlackPx }
      );
      blob += `\n${chunk}`;
    } catch {
      /* detached */
    }
  }

  blob = blob.slice(0, 96000);
  const hasMcapParens = blob.match(/\(\s*Market\s*Cap\s*\)/i);
  const hasPriceParens = blob.match(/\(\s*Price\s*\)/i);
  const hasPriceUsd = /\bPrice\s*\(?USD\)?/i.exec(blob);

  if (hasMcapParens) {
    return {
      metricInferredFromTitle: true,
      inferredMetric: 'mcap',
      matchedText: hasMcapParens[0]
    };
  }

  if (hasPriceParens) {
    return { metricInferredFromTitle: false, inferredMetric: 'price', matchedText: hasPriceParens[0] };
  }
  if (hasPriceUsd && !/\(\s*Market\s*Cap\s*\)/i.test(blob)) {
    return { metricInferredFromTitle: false, inferredMetric: 'price', matchedText: hasPriceUsd[0] };
  }

  const ranked = await rankFramesByChartCanvasSignal(page);
  for (const row of ranked) {
    if (row.maxA < 4000 && row.sumA < 5000) continue;
    const sig = await readGeckoMetricSelectionSignals(row.frame, bandMetricPx, topSlackPx);
    if (sig.mcapActive || sig.titleMarketCap) {
      return {
        metricInferredFromTitle: true,
        inferredMetric: 'mcap',
        matchedText: (sig.mcapText || (sig.titleMarketCap ? 'title_(Market_Cap)' : 'toolbar_mcap')).slice(0, 80)
      };
    }
    if (sig.found && sig.priceScore >= 4 && sig.priceScore >= sig.mcapScore + 2) {
      return {
        metricInferredFromTitle: false,
        inferredMetric: 'price',
        matchedText: (sig.priceText || 'toolbar_price').slice(0, 80)
      };
    }
  }

  return { metricInferredFromTitle: false, inferredMetric: null, matchedText: null };
}

/**
 * One fast band-scoped click on the first MCAP-ish label (includes match); no Playwright locator timeouts.
 * @param {import('playwright').Frame} frame
 * @param {number} bandMetricPx
 * @param {number} topSlackPx
 */
async function quickDomClickGeckoMcapToolbarIncludes(frame, bandMetricPx, topSlackPx) {
  return frame
    .evaluate(
      ({ bandMetric, topSlack }) => {
        function norm(s) {
          return (s || '').replace(/\s+/g, ' ').trim();
        }
        function looseMcapToolbarText(s) {
          const n = norm(s);
          if (!n || n.length > 36) return false;
          if (/market\s*cap/i.test(n) || /marketcap/i.test(n)) return true;
          if (/^mcap$/i.test(n)) return true;
          if (/\bmcap\b/i.test(n)) return true;
          return false;
        }

        const rects = [...document.querySelectorAll('canvas')].map(c => c.getBoundingClientRect());
        const valid = rects.filter(r => r.width > 40 && r.height > 30 && r.top >= 0 && r.top < 9000);
        if (!valid.length) return { ok: false, reason: 'no_canvas' };

        const topEdge = Math.min(...valid.map(r => r.top));
        const minY = topEdge - topSlack;
        const maxY = topEdge + bandMetric;

        const sel =
          'button, a, [role="button"], [role="tab"], [role="menuitem"], div[role="button"], span[role="button"], span, div';
        for (const el of document.querySelectorAll(sel)) {
          if (!(el instanceof HTMLElement)) continue;
          const r = el.getBoundingClientRect();
          if (r.top < minY || r.top > maxY) continue;
          if (r.bottom < topEdge - 220) continue;
          if (r.width > 480 && r.height > 140) continue;

          const raw = norm(el.textContent);
          if (!looseMcapToolbarText(raw)) continue;
          try {
            el.click();
            return { ok: true, matchedText: raw.slice(0, 40) };
          } catch {
            return { ok: false, reason: 'click_throw' };
          }
        }
        return { ok: false, reason: 'no_match' };
      },
      { bandMetric: bandMetricPx, topSlack: topSlackPx }
    )
    .catch(() => ({ ok: false, reason: 'evaluate_error' }));
}

/**
 * @param {import('playwright').Page} page
 * @param {string} [wanted]
 * @param {{ deadline?: number|null }} [opts]
 * @returns {Promise<{ metricAttempted: boolean, metricWanted: string, metricConfirmed: boolean, detachedUnrecoverable?: boolean }>}
 */
async function applyGeckoMetricMcapFromPage(page, wanted = 'mcap', opts = {}) {
  const deadline = opts.deadline != null ? opts.deadline : null;
  const w = String(wanted || 'mcap').toLowerCase();
  console.info(`[TokenChartTV] metric mode selection start wanted=${w}`);

  const pre = await readGeckoMcapTrustedOnBestFrame(page);
  if (pre.ok) {
    console.info(`[TokenChartTV] metric: Market Cap mode already active frame[${pre.fidx}] (no click)`);
    console.info('[TokenChartTV] metric mode selected: mcap');
    return { metricAttempted: false, metricWanted: w, metricConfirmed: true };
  }

  const bandM = tvMetricToolbarBandPx();
  const topSlack = tvMetricTopSlackPx();
  let metricAttempted = false;
  let detachedUnrecoverable = false;

  outer: for (let rankPass = 0; rankPass < 2; rankPass++) {
    const ranked = await rankFramesByChartCanvasSignal(page);

    for (const row of ranked) {
      if (tvRemainingMs(deadline) < 400) break outer;
      if (row.maxA < 4000 && row.sumA < 5000) continue;
      const { frame, index: fidx } = row;

      const verifyCap = Math.max(350, Math.min(2400, tvRemainingMs(deadline) - 250));
      const clickFast = Math.min(700, Math.max(250, tvRemainingMs(deadline)));

      try {
        let qd = { ok: false, reason: 'skip' };
        try {
          qd = await quickDomClickGeckoMcapToolbarIncludes(frame, bandM, topSlack);
        } catch (qe) {
          if (isDetachedFrameError(qe) && rankPass === 0) {
            console.warn('[TokenChartTV] detached frame during metric quick click — reacquiring once');
            await page.waitForTimeout(250);
            continue outer;
          }
          if (isDetachedFrameError(qe) && rankPass === 1) {
            detachedUnrecoverable = true;
            break outer;
          }
          qd = { ok: false, reason: String(qe?.message || qe) };
        }
        if (qd.ok) {
          metricAttempted = true;
          console.info(
            `[TokenChartTV] metric quick includes-click ok frame[${fidx}] text="${qd.matchedText || ''}"`
          );
          const verQ = await verifyGeckoMetricAfterClick(page, frame, fidx, w, bandM, topSlack, {
            maxMs: Math.min(1200, verifyCap)
          });
          if (verQ.ok) {
            console.info('[TokenChartTV] metric mode selected: mcap');
            return { metricAttempted: true, metricWanted: w, metricConfirmed: true };
          }
        }

        await logGeckoMetricToolbarCandidates(frame, fidx, bandM, topSlack);

        console.info(`[TokenChartTV] metric dom attempt label="mcap" frame[${fidx}]`);
        let dom = { ok: false, reason: 'skipped' };
        try {
          dom = await domClickGeckoMetricMcapInFrame(frame, fidx, w, bandM, topSlack);
        } catch (de) {
          if (isDetachedFrameError(de) && rankPass === 0) {
            console.warn('[TokenChartTV] detached frame during metric dom click — reacquiring once');
            await page.waitForTimeout(250);
            continue outer;
          }
          if (isDetachedFrameError(de) && rankPass === 1) {
            detachedUnrecoverable = true;
            break outer;
          }
          dom = { ok: false, reason: String(de?.message || de) };
        }

        if (dom.ok) {
          metricAttempted = true;
          console.info(
            `[TokenChartTV] metric dom result label="mcap" frame[${fidx}] matchedText="${dom.matchedText}" matchedToken="${dom.matchedToken}" nativeClick=${dom.domClickOk} syntheticEvents=${dom.usedSynthetic} targetTag=${dom.targetTag}`
          );
          const ver = await verifyGeckoMetricAfterClick(page, frame, fidx, w, bandM, topSlack, { maxMs: verifyCap });
          console.info(
            `[TokenChartTV] metric post-click verify label="mcap" frame[${fidx}] confirmed=${ver.ok} signal=${ver.signal}`
          );
          if (ver.ok) {
            console.info('[TokenChartTV] metric mode selected: mcap');
            return { metricAttempted: true, metricWanted: w, metricConfirmed: true };
          }
          console.info(`[TokenChartTV] metric dom verify rejected label="mcap" frame[${fidx}] — trying playwright`);
        } else {
          console.info(`[TokenChartTV] metric dom miss label="mcap" frame[${fidx}] reason=${dom.reason || 'unknown'}`);
        }

        try {
          const loc = frame.getByRole('button', { name: /^mcap$/i }).first();
          metricAttempted = true;
          await loc.click({ timeout: clickFast, force: true });
          console.info(
            `[TokenChartTV] metric playwright force wanted="${w}" frame[${fidx}] label=MCAP nativeClick=playwright_force syntheticEvents=false`
          );
          const ver = await verifyGeckoMetricAfterClick(page, frame, fidx, w, bandM, topSlack, { maxMs: verifyCap });
          console.info(
            `[TokenChartTV] metric post-click verify label="mcap" frame[${fidx}] confirmed=${ver.ok} signal=${ver.signal}`
          );
          if (ver.ok) {
            console.info('[TokenChartTV] metric mode selected: mcap');
            return { metricAttempted: true, metricWanted: w, metricConfirmed: true };
          }
          console.info(`[TokenChartTV] metric playwright force verify rejected label="mcap" frame[${fidx}]`);
        } catch (e1) {
          if (isDetachedFrameError(e1) && rankPass === 0) {
            console.warn('[TokenChartTV] detached frame during metric playwright click — reacquiring once');
            await page.waitForTimeout(250);
            continue outer;
          }
          if (isDetachedFrameError(e1) && rankPass === 1) {
            detachedUnrecoverable = true;
            break outer;
          }
          console.info(`[TokenChartTV] metric playwright force miss MCAP frame[${fidx}] ${e1?.message || e1}`);
        }

        if (tvRemainingMs(deadline) >= 400) {
          try {
            metricAttempted = true;
            const incLoc = frame.getByText(/MCAP|Market\s*Cap|MCap/i).first();
            await incLoc.click({ timeout: Math.min(650, clickFast), force: true });
            console.info(
              `[TokenChartTV] metric playwright includes-text OK wanted="${w}" frame[${fidx}] nativeClick=playwright_force syntheticEvents=false`
            );
            const verInc = await verifyGeckoMetricAfterClick(page, frame, fidx, w, bandM, topSlack, {
              maxMs: verifyCap
            });
            console.info(
              `[TokenChartTV] metric post-click verify label="mcap" frame[${fidx}] confirmed=${verInc.ok} signal=${verInc.signal}`
            );
            if (verInc.ok) {
              console.info('[TokenChartTV] metric mode selected: mcap');
              return { metricAttempted: true, metricWanted: w, metricConfirmed: true };
            }
            console.info(`[TokenChartTV] metric playwright includes-text verify rejected frame[${fidx}]`);
          } catch (e2) {
            if (isDetachedFrameError(e2) && rankPass === 0) {
              console.warn('[TokenChartTV] detached frame during metric includes-text — reacquiring once');
              await page.waitForTimeout(250);
              continue outer;
            }
            if (isDetachedFrameError(e2) && rankPass === 1) {
              detachedUnrecoverable = true;
              break outer;
            }
          }
        }
      } catch (e) {
        if (isDetachedFrameError(e) && rankPass === 0) {
          console.warn('[TokenChartTV] detached frame during metric toolbar work — reacquiring once');
          await page.waitForTimeout(250);
          continue outer;
        }
        if (isDetachedFrameError(e) && rankPass === 1) {
          detachedUnrecoverable = true;
          break outer;
        }
        throw e;
      }
    }
  }

  const extraBand = Math.min(160, Math.max(0, Math.floor(numEnv('CHART_TV_METRIC_SECOND_PASS_EXTRA_PX', 56))));
  if (extraBand > 0 && tvRemainingMs(deadline) >= 450) {
    const rankedPass2 = await rankFramesByChartCanvasSignal(page);
    const topSlack2 = topSlack + Math.min(24, Math.floor(extraBand / 3));
    for (const row of rankedPass2) {
      if (row.maxA < 4000 && row.sumA < 5000) continue;
      const { frame, index: fidx } = row;
      const verifyCap2 = Math.max(400, Math.min(2200, tvRemainingMs(deadline) - 180));
      if (verifyCap2 < 380) continue;
      console.info(`[TokenChartTV] metric second-pass toggle band frame[${fidx}] extraBandPx=${extraBand}`);
      try {
        await logGeckoMetricToolbarCandidates(frame, fidx, bandM + extraBand, topSlack2);
      } catch {
        /* */
      }
      let dom2 = { ok: false, reason: 'skip' };
      try {
        dom2 = await domClickGeckoMetricMcapInFrame(frame, fidx, w, bandM + extraBand, topSlack2);
      } catch {
        dom2 = { ok: false, reason: 'evaluate_error' };
      }
      if (dom2.ok) {
        metricAttempted = true;
        console.info(
          `[TokenChartTV] metric dom result label="mcap" frame[${fidx}] matchedText="${dom2.matchedText}" matchedToken="${dom2.matchedToken}" secondPass=true`
        );
        const ver2 = await verifyGeckoMetricAfterClick(page, frame, fidx, w, bandM, topSlack, { maxMs: verifyCap2 });
        console.info(
          `[TokenChartTV] metric post-click verify label="mcap" frame[${fidx}] confirmed=${ver2.ok} signal=${ver2.signal}`
        );
        if (ver2.ok) {
          console.info('[TokenChartTV] metric mode selected: mcap');
          return { metricAttempted: true, metricWanted: w, metricConfirmed: true };
        }
      }
    }
  }

  console.warn('[TokenChartTV] metric mode selection failed: mcap');
  console.info('[TokenChartTV] proceeding with current chart mode');
  if (!metricAttempted) {
    console.warn('[TokenChartTV] metric: no MCAP click attempted in chart frames');
  } else {
    console.warn('[TokenChartTV] metric: MCAP not verified after clicks — chart may still be in PRICE mode');
  }

  return { metricAttempted, metricWanted: w, metricConfirmed: false, detachedUnrecoverable };
}

/**
 * Largest plot canvas center in viewport coordinates (same idea as resolveDexPlotViewportCoords in Dex).
 * @param {import('playwright').Page} page
 * @returns {Promise<{ frame: import('playwright').Frame, frameIndex: number, absX: number, absY: number, localPx: number, localPy: number, box: { x: number, y: number, width: number, height: number }, canvasIdx: number, area: number }|null>}
 */
async function resolveTvPlotViewportCoords(page) {
  const ranked = await rankFramesByChartCanvasSignal(page);
  for (const row of ranked) {
    if (row.maxA < 4000 && row.sumA < 5000) continue;
    const { frame, index: frameIndex } = row;
    const canvases = frame.locator('canvas');
    const n = await canvases.count().catch(() => 0);
    let bestI = 0;
    let bestA = 0;
    let box = null;
    for (let i = 0; i < n; i++) {
      const b = await canvases.nth(i).boundingBox().catch(() => null);
      if (!b) continue;
      const a = b.width * b.height;
      if (a > bestA) {
        bestA = a;
        bestI = i;
        box = b;
      }
    }
    if (!box || bestA < 8000) continue;

    const localPx = Math.max(8, Math.min(box.width - 8, box.width * 0.35));
    const localPy = Math.max(8, Math.min(box.height - 8, box.height * 0.45));
    const absX = box.x + localPx;
    const absY = box.y + localPy;
    return {
      frame,
      frameIndex,
      absX,
      absY,
      localPx,
      localPy,
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
      canvasIdx: bestI,
      area: bestA
    };
  }
  return null;
}

function tvFramingEnvBool(name, defaultVal) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultVal;
  const s = String(raw).trim();
  if (/^0$|^false$|^no$|^off$|^disabled$/i.test(s)) return false;
  if (/^1$|^true$|^yes$|^on$|^enabled$/i.test(s)) return true;
  return defaultVal;
}

/**
 * @param {string|null|undefined} selectedInterval
 * @returns {number}
 */
function framingWheelOutCountForInterval(selectedInterval) {
  const lab = String(selectedInterval || '').trim().toLowerCase();
  if (!lab) return 0;
  if (lab === '1s') return Math.max(0, Math.floor(numEnv('CHART_TV_FRAMING_1S_WHEEL_OUT', 0)));
  if (lab === '5s')
    return Math.min(1, Math.max(0, Math.floor(numEnv('CHART_TV_FRAMING_5S_WHEEL_OUT', 0))));
  if (lab === '15s')
    return Math.min(1, Math.max(0, Math.floor(numEnv('CHART_TV_FRAMING_15S_WHEEL_OUT', 0))));
  return Math.min(1, Math.max(0, Math.floor(numEnv('CHART_TV_FRAMING_OTHER_WHEEL_OUT', 0))));
}

/**
 * Subtle zoom-out / history widen on the chart plot (after interval + MCAP), Dex-style canvas targeting.
 * @param {import('playwright').Page} page
 * @param {import('playwright').Frame|null} _frame unused (plot resolved from page)
 * @param {string|null} selectedInterval
 * @param {number|null} _frameIndex unused
 */
async function applyGeckoFramingAssist(page, _frame, selectedInterval, _frameIndex) {
  const enabled = tvFramingEnvBool('CHART_TV_FRAMING_ASSIST_ENABLED', true);
  const lab = String(selectedInterval || '').trim().toLowerCase() || 'unknown';
  console.info(`[TokenChartTV] framing assist start selectedInterval=${lab} enabled=${enabled}`);

  if (!enabled) {
    console.info(`[TokenChartTV] framing assist skipped selectedInterval=${lab} reason=disabled`);
    console.info('[TokenChartTV] framing assist complete');
    return;
  }

  if (lab === '1s') {
    console.info('[TokenChartTV] framing assist skipped for 1s (already optimal zoom)');
    console.info('[TokenChartTV] framing assist complete');
    return;
  }

  const n = Math.min(1, framingWheelOutCountForInterval(selectedInterval));
  if (n <= 0) {
    console.info(`[TokenChartTV] framing assist skipped selectedInterval=${lab}`);
    console.info('[TokenChartTV] framing assist complete');
    return;
  }

  const plot = await resolveTvPlotViewportCoords(page);
  if (!plot) {
    console.info('[TokenChartTV] framing assist skipped reason=no_plot_coords');
    console.info('[TokenChartTV] framing assist complete');
    return;
  }

  console.info(`[TokenChartTV] framing assist wheel out count=${n} frame[${plot.frameIndex}]`);

  const deltaMag = Math.max(20, Math.floor(numEnv('CHART_TV_FRAMING_WHEEL_DELTA', 100)));
  let sign = Number(process.env.CHART_TV_FRAMING_WHEEL_SIGN);
  if (!Number.isFinite(sign) || sign === 0) sign = 1;
  const delayMs = Math.max(30, Math.floor(numEnv('CHART_TV_FRAMING_WHEEL_DELAY_MS', 72)));

  await page.mouse.move(plot.absX, plot.absY);
  await page.waitForTimeout(70);

  for (let i = 0; i < n; i++) {
    await page.mouse.wheel(0, sign * deltaMag);
    await page.waitForTimeout(delayMs);
  }

  console.info('[TokenChartTV] framing assist complete');
}

async function saveTvDebugStep(page, basename) {
  if (!isChartTvDebug() || !page) return;
  try {
    const dir = getTvDebugDir();
    await fs.mkdir(dir, { recursive: true });
    const fp = path.join(dir, basename);
    await page.screenshot({ path: fp, fullPage: false, type: 'png' });
    console.info(`[TokenChartTV][debug] wrote ${path.relative(process.cwd(), fp) || fp}`);
  } catch (err) {
    console.warn('[TokenChartTV][debug] step screenshot failed:', err?.message || err);
  }
}

async function writeTvDebugArtifacts(page, reason) {
  const dir = getTvDebugDir();
  await fs.mkdir(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, 'tv-full.png'), fullPage: true, type: 'png' }).catch(() => {});
  await page.screenshot({ path: path.join(dir, 'tv-view.png'), fullPage: false, type: 'png' }).catch(() => {});
  let html = await page.content().catch(() => '');
  const max = 1_200_000;
  if (html.length > max) html = html.slice(0, max) + '\n<!-- truncated -->';
  await fs.writeFile(path.join(dir, 'tv-dom.html'), `<!-- ${reason} -->\n${html}`, 'utf8');
}

async function runTvDebugOnFailure(page, reason) {
  if (!isChartTvDebug() || !page) return;
  console.warn('[TokenChartTV][debug] capture failure —', reason);
  await writeTvDebugArtifacts(page, reason);
}

/**
 * @param {object} trackedCall
 * @returns {Promise<Buffer|null>}
 */
async function fetchTradingViewChartPng(trackedCall) {
  const mint = resolveSolanaContract(trackedCall);
  if (!mint) return null;

  const network = String(process.env.CHART_TV_NETWORK || 'solana').trim().toLowerCase() || 'solana';
  const resolved = await resolvePoolForChart(trackedCall, mint, network);
  if (!resolved) return null;

  const { poolAddress, source } = resolved;
  const url = geckoPoolPageUrl(network, poolAddress);
  console.info(`[TokenChartTV] loading pool=${poolAddress.slice(0, 8)}… source=${source}`);

  const timeoutMs = numEnv(
    'CHART_TV_TIMEOUT_MS',
    numEnv('CHART_GMGN_TIMEOUT_MS', numEnv('CHART_DEX_TIMEOUT_MS', DEFAULT_TIMEOUT_MS))
  );
  const captureBudgetMs = Math.min(90000, Math.max(18000, Math.floor(numEnv('CHART_TV_CAPTURE_BUDGET_MS', 32000))));
  const vw = numEnv('CHART_TV_VIEWPORT_WIDTH', numEnv('X_CHART_WIDTH', DEFAULT_VIEWPORT.width));
  const vh = numEnv('CHART_TV_VIEWPORT_HEIGHT', numEnv('X_CHART_HEIGHT', DEFAULT_VIEWPORT.height));
  const dpr = Math.min(3, Math.max(1, numEnv('CHART_TV_DEVICE_SCALE', numEnv('CHART_DEX_DEVICE_SCALE', 2))));

  let context = null;
  let page = null;

  try {
    const browser = await getChartPlaywrightBrowser();
    context = await browser.newContext({
      viewport: { width: vw, height: vh },
      deviceScaleFactor: dpr,
      colorScheme: 'dark',
      userAgent:
        process.env.CHART_TV_USER_AGENT ||
        process.env.CHART_DEX_USER_AGENT ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      locale: 'en-US'
    });

    page = await context.newPage();
    const deadline = Date.now() + captureBudgetMs;
    page.setDefaultTimeout(Math.min(timeoutMs, Math.max(5000, tvRemainingMs(deadline))));

    const nav = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(err => {
      console.info('[TokenChartTV] goto failed:', err?.message || err);
      return null;
    });
    if (!nav || nav.status() === 404) {
      console.info('[TokenChartTV] pool page not available (status=', nav?.status(), ')');
      if (isChartTvDebug()) await runTvDebugOnFailure(page, 'goto_404_or_fail');
      return null;
    }

    await dismissOptionalOverlays(page);
    const canvasWaitMs = Math.min(timeoutMs, 45000, Math.max(3000, tvRemainingMs(deadline)));
    await waitForAnyFrameCanvas(page, CANVAS_WAIT_MIN_AREA, canvasWaitMs);

    await saveTvDebugStep(page, 'tv-after-load.png');
    const intervalRes = await trySelectGeckoIntervals(page, { deadline });
    await saveTvDebugStep(page, 'tv-after-interval.png');

    const metricRes = await applyGeckoMetricMcapFromPage(page, 'mcap', { deadline });
    if (isChartTvDebug()) await saveTvDebugStep(page, 'tv-after-metric.png');

    const metricInfer = await inferGeckoMetricMode(page);
    if (!metricRes.metricConfirmed) {
      if (metricInfer.inferredMetric === 'price' && metricInfer.matchedText) {
        console.info(`[TokenChartTV] metric inferred: price via text="${metricInfer.matchedText}"`);
      } else if (metricInfer.inferredMetric == null) {
        console.info('[TokenChartTV] metric inference inconclusive — allowing Gecko capture');
      } else if (metricInfer.inferredMetric === 'mcap' && metricInfer.matchedText) {
        console.info(
          `[TokenChartTV] metric inferred: mcap (title or active toolbar only)="${metricInfer.matchedText}"`
        );
      }
    }

    const plotForGate = await resolveTvPlotViewportCoords(page);
    const chartCanvasFound = !!plotForGate;
    const detachedUnrecoverable = !!(intervalRes.detachedUnrecoverable || metricRes.detachedUnrecoverable);
    const trust = isTrustedGeckoChartState({
      intervalConfirmed: intervalRes.intervalConfirmed,
      chartCanvasFound,
      detachedUnrecoverable
    });

    if (!trust.ok) {
      logGeckoCaptureAbort(intervalRes, metricRes, chartCanvasFound, trust.reason, metricInfer.inferredMetric);
      if (isChartTvDebug()) await runTvDebugOnFailure(page, `readiness_gate:${trust.reason || 'unknown'}`);
      return null;
    }

    if (!metricRes.metricConfirmed) {
      console.info('[TokenChartTV] metric not confirmed — proceeding with current chart mode');
    }

    console.info('[TokenChartTV] usable chart state reached — proceeding to capture');

    if (tvRemainingMs(deadline) < 800) {
      console.warn('[TokenChartTV] capture budget low — skipping settle/stabilize delays');
    }

    const settleMs = Math.min(
      Math.max(0, Math.floor(numEnv('CHART_TV_METRIC_SETTLE_MS', 700))),
      Math.max(0, tvRemainingMs(deadline) - 50)
    );
    if (settleMs > 0) await page.waitForTimeout(settleMs);

    await applyGeckoFramingAssist(page, null, intervalRes.selectedInterval, null);

    const stabEnv = numEnv(
      'CHART_TV_STABILIZE_MS',
      numEnv('CHART_GMGN_STABILIZE_MS', numEnv('CHART_DEX_STABILIZE_MS', 1200))
    );
    const stabilizeMs = Math.min(stabEnv, Math.max(0, tvRemainingMs(deadline) - 50));
    if (stabilizeMs > 0) await page.waitForTimeout(stabilizeMs);

    let cap = await screenshotGeckoChartRegionDetailed(page);
    if (cap.png && isReasonablePng(cap.png)) {
      console.info(`[TokenChartTV] capture success: selector=${cap.selector ?? 'unknown'}`);
      console.info('[TokenChart] provider=tv (GeckoTerminal pool)');
      return cap.png;
    }

    const emerg = await emergencyFinalGeckoCapture(page, { skipRepeatDetailed: true });
    if (emerg && isReasonablePng(emerg)) {
      console.info('[TokenChartTV] capture success: selector=emergency-path');
      console.info('[TokenChart] provider=tv (GeckoTerminal pool)');
      return emerg;
    }

    console.warn('[TokenChartTV] no usable capture target found after readiness gate');
    console.warn('[TokenChartTV] returning null for provider fallback');
    if (isChartTvDebug()) await runTvDebugOnFailure(page, 'no_chart_region');
    return null;
  } catch (err) {
    console.warn('[TokenChartTV] Capture failed:', err?.message || String(err));
    if (isDetachedFrameError(err)) {
      console.warn('[TokenChartTV] aborting Gecko capture: detached frame unrecoverable');
      console.warn('[TokenChartTV] Gecko capture aborted — returning null for provider fallback');
    }
    if (isChartTvDebug() && page) await runTvDebugOnFailure(page, `exception: ${err?.message || String(err)}`);
    return null;
  } finally {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
  }
}

module.exports = {
  fetchTradingViewChartPng,
  geckoPoolPageUrl
};
