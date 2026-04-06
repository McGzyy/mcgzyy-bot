/**
 * DexScreener chart screenshots via Playwright (dark theme, short intervals, recent focus).
 *
 * Navigation:
 *   1. Launch Chromium (headless) with non-automation UA + dark color scheme.
 *   2. Goto https://dexscreener.com/solana/{contractAddress}
 *   3. Optional cookie banner dismiss (best-effort).
 *   4. Wait until a large chart canvas is present (TradingView-style render).
 *   5. Wait for TV interval toolbar, then timeframe; bottom time-range presets (5d/1d/…); light post-preset wheel polish by default; drag opt-in; keyboard +/- last resort.
 *   6. Stabilize, then screenshot chart wrapper (prefers containers that include TV scales / volume).
 *
 * Tuning (optional env):
 *   CHART_DEX_INTERVAL_ORDER — comma/space list, e.g. "1m,30s,15s,5m,15m"
 *   CHART_DEX_USE_RANGE_PRESET — 1/0 (default 1): click bottom TV time-range row (1d, 5d, …) after interval
 *   CHART_DEX_RANGE_PRESET_ORDER — comma list (default 5d,1d,1m,3m) tried in order inside chart frame
 *   CHART_DEX_RANGE_PRESET_SETTLE_MS — wait after preset click (default 700)
 *   CHART_DEX_RANGE_PRESET_VERIFY_MS — max wait polling for preset selected state (default 1800)
 *   CHART_DEX_FRAMING_ASSIST_AFTER_RANGE_PRESET — 1/0 (default 1): after a successful range preset, run light shift/plain wheel/drag polish (set 0 to skip)
 *   CHART_DEX_SHIFT_WHEEL_STEPS — SHIFT+wheel ticks (default 0 = off; set >0 to enable)
 *   CHART_DEX_SHIFT_WHEEL_DELTA — |deltaY| per tick while SHIFT held (default 120; positive expands range with default sign)
 *   CHART_DEX_SHIFT_WHEEL_DELAY_MS — ms between shift-wheel ticks (default 65)
 *   CHART_DEX_SHIFT_WHEEL_SIGN — ±1 multiplier for deltaY (default 1 = scroll “down” to zoom out time)
 *   CHART_DEX_SHIFT_WHEEL_INVERT — if 1, flip shift-wheel direction
 *   CHART_DEX_WHEEL_ZOOM_OUT_STEPS — plain wheel-out ticks (default 2; set 0 to disable)
 *   CHART_DEX_WHEEL_ZOOM_IN_STEPS — plain wheel-in (default 0)
 *   CHART_DEX_WHEEL_DELTA — |deltaY| per wheel tick (default 120)
 *   CHART_DEX_WHEEL_ZOOM_OUT_SIGN / CHART_DEX_WHEEL_ZOOM_IN_SIGN — ±1 flip wheel direction (defaults +1 / -1)
 *   CHART_DEX_WHEEL_INVERT — if 1, flip both wheel directions
 *   CHART_DEX_WHEEL_MODIFIER — none | ctrl | alt | meta (default none)
 *   CHART_DEX_WHEEL_DELAY_MS — ms between wheel ticks (default 72)
 *   CHART_DEX_DRAG_PAN_ENABLED — 1/true or 0/false/off (default 0): horizontal pan (opt-in; was harming framing)
 *   CHART_DEX_DRAG_PAN_PX — drag delta in viewport px per pass (default 320; positive = drag left, reveal earlier candles)
 *   CHART_DEX_DRAG_PAN_STEPS — Playwright mouse.move steps per drag (default 28)
 *   CHART_DEX_DRAG_PAN_PASSES — consecutive drags at same anchor (default 2; helps TV register pan)
 *   CHART_DEX_DRAG_PAN_PRE_DOWN_MS — hover settle before mousedown (default 90)
 *   CHART_DEX_DRAG_PAN_DOWN_HOLD_MS — hold after mousedown before move (default 55)
 *   CHART_DEX_DRAG_PAN_POST_UP_MS — settle after mouseup (default 140)
 *   CHART_DEX_DRAG_PAN_PASS_GAP_MS — pause between passes (default 220)
 *   CHART_DEX_DRAG_PAN_FALLBACK_ANCHOR — 1/0 (default 1): extra drag from ~55% width if fingerprint unchanged after passes
 *   CHART_DEX_DRAG_PAN_AS_SHIFT_FALLBACK — 1/0 (default 0): after SHIFT+wheel, also run drag passes
 *   CHART_DEX_KEYBOARD_ZOOM_FALLBACK — 1/0 (default 1): use +/- keys if plot/wheel unavailable or wheel+drag both off
 *   CHART_DEX_KEYBOARD_ZOOM_AFTER_WHEEL — 1/0 (default 0): also run keyboard nudge after successful wheel/drag
 *   CHART_DEX_ZOOM_OUT_STEPS — '-' presses (keyboard fallback, default 8)
 *   CHART_DEX_ZOOM_IN_STEPS — '+' presses (keyboard fallback, default 2)
 *   CHART_DEX_ZOOM_KEY_DELAY_MS — ms between zoom keys (default 85)
 *   CHART_DEX_AFTER_ZOOM_MS — wait after zoom / wheel / pan (default 1200)
 *   CHART_DEX_STABILIZE_AFTER_INTERVAL_MS — extra settle after rerender detect (default 600)
 *   CHART_DEX_INTERVAL_RERENDER_WAIT_MS — max wait for canvas/layout change after interval (default 2800)
 *   CHART_DEX_INTERVAL_TOOLBAR_WAIT_MS — max wait for TV interval toolbar (1m/5m/1h) before selection (default 7000)
 *   CHART_DEX_INTERVAL_TOOLBAR_POLL_MS — poll interval for toolbar readiness (default 400)
 *   CHART_DEX_INTERVAL_VERIFY_MS — max wait for toolbar/canvas confirmation after DOM interval click (default 2400)
 *   CHART_DEX_STABILIZE_AFTER_ZOOM_MS — settle after zoom keys (default 800)
 *   CHART_DEX_STABILIZE_MS — final wait before screenshot (default 1200)
 *   CHART_DEX_FALLBACK_PARENT_DEPTH — canvas→parent climb depth (default 10; more may include axes/volume)
 *
 * CHART_DEX_DEBUG=1 also writes dex-after-interval.png, dex-after-wheel-or-pan.png, and dex-after-zoom.png (viewport).
 *
 * Limitations:
 *   - DexScreener/Cloudflare may block datacenter or automated traffic; on failure returns null (callers unchanged).
 *   - Interval/zoom controls are heuristic; DOM/class changes on dexscreener.com can break selection without breaking capture.
 *   - Multi-chain: currently Solana-only URL (extend later via trackedCall.chain / env).
 *
 * Temporary diagnostics: CHART_DEX_DEBUG=1 — on capture failure, writes debug/dex-*.png + dex-dom.html and logs DOM/canvas summary.
 */

const fs = require('fs/promises');
const path = require('path');
const { chromium } = require('playwright');

const DEFAULT_TIMEOUT_MS = 55000;
const DEFAULT_VIEWPORT = { width: 1360, height: 860 };
/** Wait loop: any canvas this size counts as “chart loading” (small panes, TV splits). */
const CANVAS_WAIT_MIN_AREA = 10000;
/** Fallback climb-from-canvas: minimum area for a “main” plot canvas. */
const CANVAS_FALLBACK_MIN_AREA = 8000;
let sharedBrowser = null;

/** 1m first for readable x-axis ticks; sub-minute next; wider intervals only if nothing shorter matches. */
const DEFAULT_CHART_DEX_INTERVAL_ORDER = ['1m', '30s', '15s', '1s', '5m', '15m', '30m', '1h', '4h', '1d'];

function getDexIntervalClickOrder() {
  const raw = String(process.env.CHART_DEX_INTERVAL_ORDER || '').trim();
  if (raw) {
    return raw.split(/[\s,]+/)
      .map(s => s.trim())
      .filter(Boolean);
  }
  return DEFAULT_CHART_DEX_INTERVAL_ORDER.slice();
}

/** Bottom TradingView time-range row (5d, 1d, 3m, …) — not candle interval; 5d first for calmer x-axis / new tokens. */
const DEFAULT_CHART_DEX_RANGE_PRESET_ORDER = ['5d', '1d', '1m', '3m'];

function getDexRangePresetOrder() {
  const raw = String(process.env.CHART_DEX_RANGE_PRESET_ORDER || '').trim();
  if (raw) {
    return raw.split(/[\s,]+/)
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);
  }
  return DEFAULT_CHART_DEX_RANGE_PRESET_ORDER.slice();
}

function escapeIntervalLabelForRegex(label) {
  return String(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isChartDexDebug() {
  return /^1|true|yes$/i.test(String(process.env.CHART_DEX_DEBUG || '').trim());
}

function getDexDebugDir() {
  return path.join(__dirname, '..', 'debug');
}

/**
 * Per-frame canvas stats and chart-like nodes (best-effort; cross-origin frames error).
 * @param {import('playwright').Page} page
 */
async function collectDexDebugDiagnostics(page) {
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
        const chartLike = [
          ...document.querySelectorAll('[class*="chart"], [class*="Chart"], [id*="chart"], [id*="Chart"]')
        ]
          .slice(0, 20)
          .map(el => {
            const r = el.getBoundingClientRect();
            return {
              tag: el.tagName,
              id: String(el.id || '').slice(0, 80),
              cls: String(el.className || '').slice(0, 120),
              w: Math.round(r.width),
              h: Math.round(r.height)
            };
          });
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

/**
 * Full-page + viewport PNG and trimmed HTML under project debug/.
 * @param {import('playwright').Page} page
 * @param {string} reason
 */
async function writeDexDebugArtifacts(page, reason) {
  const dir = getDexDebugDir();
  await fs.mkdir(dir, { recursive: true });

  const fullPng = path.join(dir, 'dex-full.png');
  const viewPng = path.join(dir, 'dex-view.png');
  const domPath = path.join(dir, 'dex-dom.html');

  await page.screenshot({ path: fullPng, fullPage: true, type: 'png' }).catch(err => {
    console.warn('[TokenChartDex][debug] full-page screenshot failed:', err.message);
  });
  await page.screenshot({ path: viewPng, fullPage: false, type: 'png' }).catch(err => {
    console.warn('[TokenChartDex][debug] viewport screenshot failed:', err.message);
  });

  const maxDom = 1_500_000;
  let html = await page.content().catch(() => '<!-- page.content() failed -->');
  let truncated = false;
  if (html.length > maxDom) {
    truncated = true;
    html =
      `<!-- CHART_DEX_DEBUG: HTML truncated to ${maxDom} chars (was ${html.length}). reason: ${reason} -->\n` +
      html.slice(0, maxDom);
  } else {
    html = `<!-- CHART_DEX_DEBUG: reason=${reason} full_length=${html.length} -->\n${html}`;
  }
  await fs.writeFile(domPath, html, 'utf8');

  if (truncated) {
    console.warn(`[TokenChartDex][debug] dex-dom.html truncated (${maxDom} chars)`);
  }
}

/**
 * @param {import('playwright').Page} page
 * @param {string} reason
 */
async function runDexChartDebugOnFailure(page, reason) {
  if (!page) return;

  let diag;
  try {
    diag = await collectDexDebugDiagnostics(page);
  } catch (err) {
    console.warn('[TokenChartDex][debug] diagnostics failed:', err?.message || err);
    diag = null;
  }

  console.warn('[TokenChartDex][debug] capture failure —', reason);
  if (diag) {
    console.warn('[TokenChartDex][debug] title:', diag.title);
    console.warn('[TokenChartDex][debug] finalUrl:', diag.finalUrl);
    console.warn(
      '[TokenChartDex][debug] frames:',
      diag.frameCount,
      'iframe elements (main DOM):',
      diag.iframeElementCount
    );
    for (const f of diag.perFrame) {
      const canvasLine =
        f.error != null
          ? `error: ${f.error}`
          : `canvasCount=${f.canvasCount} (details: ${f.canvases?.length || 0} listed)`;
      console.warn(`[TokenChartDex][debug] frame[${f.index}] ${canvasLine} url=${f.url?.slice(0, 120) || ''}`);
      if (f.canvases && f.canvases.length) {
        const top = f.canvases
          .slice()
          .sort((a, b) => b.area - a.area)
          .slice(0, 5);
        console.warn('[TokenChartDex][debug]   top canvases:', JSON.stringify(top));
      }
      if (f.chartLike && f.chartLike.length) {
        console.warn('[TokenChartDex][debug]   chart-like nodes:', JSON.stringify(f.chartLike.slice(0, 8)));
      }
    }
  }

  const rel = path.relative(process.cwd(), getDexDebugDir()) || 'debug';
  console.warn(`[TokenChartDex][debug] writing screenshots + DOM to ${rel}/`);

  await writeDexDebugArtifacts(page, reason);
}

function numEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function resolveSolanaContract(trackedCall) {
  const ca = trackedCall && trackedCall.contractAddress;
  if (!ca || typeof ca !== 'string') return null;
  const t = ca.trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(t)) return null;
  return t;
}

function dexScreenerTokenUrl(contractAddress) {
  const chain = String(process.env.CHART_DEX_CHAIN || 'solana').trim().toLowerCase() || 'solana';
  return `https://dexscreener.com/${chain}/${contractAddress}`;
}

async function getSharedBrowser() {
  if (sharedBrowser) return sharedBrowser;
  const headful =
    /^1|true|yes$/i.test(String(process.env.CHART_DEX_HEADFUL || '').trim()) ||
    /^1|true|yes$/i.test(String(process.env.CHART_GMGN_HEADFUL || '').trim());
  const headless = !headful;
  sharedBrowser = await chromium.launch({
    headless,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage']
  });
  return sharedBrowser;
}

/**
 * Best-effort dismiss common consent overlays.
 * @param {import('playwright').Page} page
 */
async function dismissOptionalOverlays(page) {
  const candidates = [
    page.getByRole('button', { name: /accept/i }).first(),
    page.getByRole('button', { name: /agree/i }).first(),
    page.locator('button:has-text("Accept all")').first()
  ];
  for (const loc of candidates) {
    try {
      if (await loc.isVisible({ timeout: 1200 })) {
        await loc.click({ timeout: 2000 });
        await page.waitForTimeout(400);
        break;
      }
    } catch {
      /* ignore */
    }
  }
}

/**
 * Log compact interval-like labels + detailed DOM candidates (chart toolbar band).
 * @param {import('playwright').Frame} frame
 * @param {number} frameIdx
 */
async function logDexToolbarIntervalCandidates(frame, frameIdx) {
  const payload = await frame
    .evaluate(() => {
      const rects = [...document.querySelectorAll('canvas')].map(c => c.getBoundingClientRect());
      const valid = rects.filter(r => r.width > 40 && r.height > 30 && r.top >= 0 && r.top < 9000);
      if (!valid.length) return { labels: [], candidates: [] };
      const topEdge = Math.min(...valid.map(r => r.top));
      const toolbarMaxY = topEdge + 96;
      const seen = new Set();
      const labels = [];
      const candidates = [];
      const sel =
        'button, a, [role="button"], [role="tab"], [role="menuitem"], div[role="button"], span[role="button"], span, div';
      const nodes = document.querySelectorAll(sel);
      for (const el of nodes) {
        if (!(el instanceof HTMLElement)) continue;
        const r = el.getBoundingClientRect();
        if (r.bottom < -400 || r.top > (window.innerHeight || 0) + 400) continue;
        if (r.top > toolbarMaxY) continue;
        const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!t || t.length > 14) continue;
        if (!/^\d/.test(t)) continue;
        if (!/[sSmMhHdD]/.test(t)) continue;
        const token = t.split(/\s+/)[0];
        if (seen.has(token)) continue;
        seen.add(token);
        labels.push(token);
        candidates.push({
          tag: el.tagName,
          text: t.slice(0, 14),
          token,
          w: Math.round(r.width * 10) / 10,
          h: Math.round(r.height * 10) / 10,
          top: Math.round(r.top),
          ariaPressed: el.getAttribute('aria-pressed'),
          ariaSelected: el.getAttribute('aria-selected'),
          cls: (typeof el.className === 'string' ? el.className : '').slice(0, 72)
        });
        if (labels.length > 24) break;
      }
      return { labels, candidates };
    })
    .catch(() => ({ labels: [], candidates: [] }));

  const { labels, candidates } = payload;
  if (labels.length) {
    console.info(`[TokenChartDex] interval toolbar labels frame[${frameIdx}]: ${labels.join(', ')}`);
  } else {
    console.info(`[TokenChartDex] interval toolbar labels frame[${frameIdx}]: (none detected)`);
  }
  if (candidates.length) {
    console.info(
      `[TokenChartDex] interval toolbar DOM candidates frame[${frameIdx}]: ${JSON.stringify(candidates)}`
    );
  }
}

/**
 * Click interval control via in-frame DOM (no Playwright visibility gate). Tries native click, then synthetic pointer/mouse.
 * @param {import('playwright').Frame} frame
 * @param {string} label e.g. "1m"
 * @returns {Promise<{ ok: boolean, matchedText?: string, domClickOk?: boolean, usedSynthetic?: boolean, targetTag?: string }>}
 */
async function domClickToolbarIntervalInFrame(frame, label) {
  const want = String(label).trim().toLowerCase();
  const result = await frame
    .evaluate(w => {
      const norm = s => (s || '').replace(/\s+/g, ' ').trim();
      const rects = [...document.querySelectorAll('canvas')].map(c => c.getBoundingClientRect());
      const valid = rects.filter(r => r.width > 40 && r.height > 30 && r.top >= 0 && r.top < 9000);
      if (!valid.length) return { ok: false, reason: 'no_canvas' };
      const topEdge = Math.min(...valid.map(r => r.top));
      const toolbarMaxY = topEdge + 96;

      const sel =
        'button, a, [role="button"], [role="tab"], [role="menuitem"], div[role="button"], span[role="button"], span, div';
      const nodes = [...document.querySelectorAll(sel)];

      const matches = [];
      for (const el of nodes) {
        if (!(el instanceof HTMLElement)) continue;
        const r = el.getBoundingClientRect();
        if (r.top > toolbarMaxY) continue;
        if (r.bottom < topEdge - 120) continue;
        const full = norm(el.textContent);
        const token = norm(full.split(/\s+/)[0] || '');
        if (token.toLowerCase() !== w) continue;
        matches.push({ el, r, full, token });
      }

      if (!matches.length) return { ok: false, reason: 'no_text_match' };

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

      let { el: rawEl, r, full } = matches[0];
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
          /* PointerEvent missing in very old contexts */
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
          /* ignore */
        }
        el.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 0 }));
        el.dispatchEvent(new MouseEvent('click', base));
      }

      return {
        ok: true,
        matchedText: full || rawEl.textContent || w,
        domClickOk,
        usedSynthetic,
        targetTag: el.tagName
      };
    }, want)
    .catch(err => ({ ok: false, reason: String(err?.message || err) }));

  return result;
}

/**
 * Click a bottom time-range preset (1d, 5d, 3m, …) in the band below the main chart canvases.
 * @param {import('playwright').Frame} frame
 * @param {string} label e.g. "1d"
 */
async function domClickBottomRangePresetInFrame(frame, label) {
  const want = String(label).trim().toLowerCase();
  const result = await frame
    .evaluate(w => {
      const norm = s => (s || '').replace(/\s+/g, ' ').trim();
      const rangeTok = /^(\d+[dDmMyYwW])$/;
      const rects = [...document.querySelectorAll('canvas')].map(c => c.getBoundingClientRect());
      const valid = rects.filter(r => r.width > 40 && r.height > 30 && r.top >= 0 && r.top < 9000);
      if (!valid.length) return { ok: false, reason: 'no_canvas' };
      const chartBottom = Math.max(...valid.map(r => r.bottom));
      const bandMinY = chartBottom - 20;
      const bandMaxY = Math.min((window.innerHeight || 900) + 80, chartBottom + 160);

      const sel =
        'button, a, [role="button"], [role="tab"], [role="menuitem"], div[role="button"], span[role="button"], span, div';
      const nodes = [...document.querySelectorAll(sel)];

      const matches = [];
      for (const el of nodes) {
        if (!(el instanceof HTMLElement)) continue;
        const r = el.getBoundingClientRect();
        if (r.bottom < bandMinY || r.top > bandMaxY) continue;
        if (r.width < 2 || r.height < 2) continue;
        const full = norm(el.textContent);
        const token = norm((full.split(/\s+/)[0] || '').toLowerCase());
        if (!rangeTok.test(token)) continue;
        if (token !== w) continue;
        matches.push({ el, r, full, token });
      }

      if (!matches.length) return { ok: false, reason: 'no_text_match' };

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

      let { el: rawEl, r, full } = matches[0];
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
          /* ignore */
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
          /* ignore */
        }
        el.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 0 }));
        el.dispatchEvent(new MouseEvent('click', base));
      }

      return {
        ok: true,
        matchedText: full || rawEl.textContent || w,
        domClickOk,
        usedSynthetic,
        targetTag: el.tagName
      };
    }, want)
    .catch(err => ({ ok: false, reason: String(err?.message || err) }));

  return result;
}

/**
 * Read selected-like state for a range preset token in the bottom band.
 * @param {import('playwright').Frame} frame
 * @param {string} label
 */
async function readDexRangePresetSignals(frame, label) {
  const want = String(label).trim().toLowerCase();
  return frame
    .evaluate(w => {
      const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const rangeTok = /^(\d+[dDmMyYwW])$/;
      const rects = [...document.querySelectorAll('canvas')].map(c => c.getBoundingClientRect());
      const valid = rects.filter(r => r.width > 40 && r.height > 30 && r.top >= 0 && r.top < 9000);
      if (!valid.length) return { found: false, reason: 'no_canvas' };
      const chartBottom = Math.max(...valid.map(r => r.bottom));
      const bandMinY = chartBottom - 20;
      const bandMaxY = Math.min((window.innerHeight || 900) + 80, chartBottom + 160);
      const sel =
        'button, a, [role="button"], [role="tab"], [role="menuitem"], div[role="button"], span[role="button"], span, div';
      let best = null;
      for (const el of document.querySelectorAll(sel)) {
        if (!(el instanceof HTMLElement)) continue;
        const r = el.getBoundingClientRect();
        if (r.bottom < bandMinY || r.top > bandMaxY) continue;
        const t = norm((el.textContent || '').split(/\s+/)[0] || '');
        if (!rangeTok.test(t) || t !== w) continue;
        const pressed = el.getAttribute('aria-pressed') === 'true';
        const selected = el.getAttribute('aria-selected') === 'true';
        const cls = typeof el.className === 'string' ? el.className : '';
        const classLooksActive = /\b(selected|active|current|isActive|is-active|isSelected|is-selected)\b/i.test(
          cls
        );
        const dataActive = el.getAttribute('data-active') === 'true' || el.getAttribute('data-selected') === 'true';
        const score = (pressed ? 4 : 0) + (selected ? 4 : 0) + (classLooksActive ? 2 : 0) + (dataActive ? 2 : 0);
        const row = {
          tag: el.tagName,
          text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 14),
          ariaPressed: pressed,
          ariaSelected: selected,
          classLooksActive,
          dataActive,
          cls: cls.slice(0, 100),
          score
        };
        if (!best || score > best.score) best = row;
      }
      if (!best) return { found: false, reason: 'no_matching_node' };
      return { found: true, ...best };
    }, want)
    .catch(() => ({ found: false, reason: 'evaluate_error' }));
}

/**
 * Try bottom time-range presets in order inside one chart frame.
 * @param {import('playwright').Frame} frame
 * @param {number} frameIndex
 * @returns {Promise<string|null>} matched preset label or null
 */
async function tryClickDexBottomRangePreset(frame, frameIndex) {
  const order = getDexRangePresetOrder();
  for (const label of order) {
    console.info(`[TokenChartDex] range preset attempt label="${label}" frame[${frameIndex}]`);
    const res = await domClickBottomRangePresetInFrame(frame, label);
    if (!res.ok) {
      console.info(
        `[TokenChartDex] range preset miss label="${label}" frame[${frameIndex}] reason=${res.reason || 'unknown'}`
      );
      continue;
    }
    console.info(
      `[TokenChartDex] range preset result label="${label}" frame[${frameIndex}] matchedText="${res.matchedText}" nativeClick=${res.domClickOk} syntheticEvents=${res.usedSynthetic} targetTag=${res.targetTag}`
    );
    return label;
  }
  return null;
}

/**
 * @param {import('playwright').Page} page
 * @param {import('playwright').Frame} frame
 * @param {number} fidx
 * @param {string} label
 */
async function verifyDexRangePresetSelection(page, frame, fidx, label) {
  const maxMs = Math.min(3500, Math.max(400, numEnv('CHART_DEX_RANGE_PRESET_VERIFY_MS', 1800)));
  const start = Date.now();
  let lastSig = null;
  while (Date.now() - start < maxMs) {
    await page.waitForTimeout(180);
    const sig = await readDexRangePresetSignals(frame, label);
    lastSig = sig;
    if (
      sig.found &&
      (sig.ariaPressed || sig.ariaSelected || sig.classLooksActive || sig.dataActive)
    ) {
      console.info(
        `[TokenChartDex] range preset verify label="${label}" frame[${fidx}] signal=toolbar_state score=${sig.score} ariaPressed=${sig.ariaPressed} ariaSelected=${sig.ariaSelected} classActive=${sig.classLooksActive} text="${sig.text}"`
      );
      return;
    }
  }
  const fp = await readDexCanvasFingerprintInFrame(frame);
  console.info(
    `[TokenChartDex] range preset verify label="${label}" frame[${fidx}] signal=no_strong_state (preset may still apply) lastScore=${lastSig?.found ? lastSig.score : 'n/a'} fp=${JSON.stringify(fp)}`
  );
}

/**
 * Apply bottom range preset across ranked chart frames (Dex TV embed).
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>} true if a preset was clicked in some frame
 */
async function applyDexBottomRangePresetFromPage(page) {
  if (!dexEnvBool('CHART_DEX_USE_RANGE_PRESET', true)) {
    console.info('[TokenChartDex] range preset: skipped (CHART_DEX_USE_RANGE_PRESET=0)');
    return false;
  }

  const ranked = await rankFramesByChartCanvasSignal(page);
  for (const row of ranked) {
    if (row.maxA < 8000 && row.sumA < 8000) continue;
    const { frame, index: fidx } = row;
    const hit = await tryClickDexBottomRangePreset(frame, fidx);
    if (hit) {
      await verifyDexRangePresetSelection(page, frame, fidx, hit);
      return true;
    }
  }

  console.warn('[TokenChartDex] range preset: no preset matched in any chart frame');
  return false;
}

/**
 * After a DOM interval click, detect toolbar "selected" signals for the wanted label.
 * @param {import('playwright').Frame} frame
 * @param {string} label
 */
async function readDexIntervalSelectionSignals(frame, label) {
  const want = String(label).trim().toLowerCase();
  return frame
    .evaluate(w => {
      const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const rects = [...document.querySelectorAll('canvas')].map(c => c.getBoundingClientRect());
      const valid = rects.filter(r => r.width > 40 && r.height > 30 && r.top >= 0 && r.top < 9000);
      if (!valid.length) return { found: false, reason: 'no_canvas' };
      const topEdge = Math.min(...valid.map(r => r.top));
      const toolbarMaxY = topEdge + 96;
      const sel =
        'button, a, [role="button"], [role="tab"], [role="menuitem"], div[role="button"], span[role="button"], span, div';
      let best = null;
      for (const el of document.querySelectorAll(sel)) {
        if (!(el instanceof HTMLElement)) continue;
        const r = el.getBoundingClientRect();
        if (r.top > toolbarMaxY) continue;
        const t = norm((el.textContent || '').split(/\s+/)[0] || '');
        if (t !== w) continue;
        const pressed = el.getAttribute('aria-pressed') === 'true';
        const selected = el.getAttribute('aria-selected') === 'true';
        const cls = typeof el.className === 'string' ? el.className : '';
        const classLooksActive = /\b(selected|active|current|isActive|is-active|isSelected|is-selected)\b/i.test(
          cls
        );
        const dataActive = el.getAttribute('data-active') === 'true' || el.getAttribute('data-selected') === 'true';
        const score = (pressed ? 4 : 0) + (selected ? 4 : 0) + (classLooksActive ? 2 : 0) + (dataActive ? 2 : 0);
        const row = {
          tag: el.tagName,
          text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 14),
          ariaPressed: pressed,
          ariaSelected: selected,
          classLooksActive,
          dataActive,
          cls: cls.slice(0, 100),
          score
        };
        if (!best || score > best.score) best = row;
      }
      if (!best) return { found: false, reason: 'no_matching_node' };
      return { found: true, ...best };
    }, want)
    .catch(() => ({ found: false, reason: 'evaluate_error' }));
}

/**
 * Poll for confirmation that the interval control looks selected or chart canvas changed.
 * @param {import('playwright').Frame} frame
 * @param {string} label
 * @param {{ w: number, h: number, a: number }|null} canvasBefore
 */
async function verifyDexIntervalChangeAfterClick(page, frame, fidx, label, canvasBefore) {
  const maxMs = Math.min(4000, Math.max(800, numEnv('CHART_DEX_INTERVAL_VERIFY_MS', 2400)));
  const start = Date.now();
  let lastSignal = 'none';

  const readCanvas = () =>
    frame
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

  while (Date.now() - start < maxMs) {
    await page.waitForTimeout(160);
    const sig = await readDexIntervalSelectionSignals(frame, label);
    if (sig.found && (sig.ariaPressed || sig.ariaSelected || sig.classLooksActive || sig.dataActive)) {
      lastSignal = `toolbar_state score=${sig.score} ariaPressed=${sig.ariaPressed} ariaSelected=${sig.ariaSelected} classActive=${sig.classLooksActive} dataActive=${sig.dataActive}`;
      console.info(`[TokenChartDex] interval verify frame[${fidx}] label="${label}" OK: ${lastSignal}`);
      return { ok: true, signal: lastSignal, detail: sig };
    }
    const after = await readCanvas();
    if (
      canvasBefore &&
      after &&
      (after.w !== canvasBefore.w || after.h !== canvasBefore.h || Math.abs((after.a || 0) - (canvasBefore.a || 0)) > 500)
    ) {
      lastSignal = `canvas_resize before=${JSON.stringify(canvasBefore)} after=${JSON.stringify(after)}`;
      console.info(`[TokenChartDex] interval verify frame[${fidx}] label="${label}" OK: ${lastSignal}`);
      return { ok: true, signal: lastSignal };
    }
  }

  const sig = await readDexIntervalSelectionSignals(frame, label);
  if (sig.found) {
    lastSignal = `toolbar_weak text="${sig.text}" score=${sig.score} (no strong selected attrs)`;
    console.info(`[TokenChartDex] interval verify frame[${fidx}] label="${label}" weak: ${lastSignal}`);
    return { ok: false, signal: lastSignal, detail: sig };
  }
  console.info(`[TokenChartDex] interval verify frame[${fidx}] label="${label}" inconclusive: ${lastSignal}`);
  return { ok: false, signal: lastSignal };
}

/**
 * Toolbar-scoped click on main frame only (chart container subtree, top band).
 * @param {import('playwright').Page} page
 * @param {string[]} order
 * @returns {Promise<string|null>}
 */
async function tryDexToolbarScopedIntervalClick(page, order) {
  const clicked = await page
    .mainFrame()
    .evaluate(labels => {
      const want = labels.map(l => l.toLowerCase());
      const chart =
        document.querySelector('.chart-container') ||
        document.querySelector('.chart-widget') ||
        document.querySelector('#tv-chart-container');
      if (!chart) return null;
      const cr = chart.getBoundingClientRect();
      const maxY = cr.top + 110;
      const nodes = chart.querySelectorAll('button, [role="button"], [role="tab"], div, span');
      for (const el of nodes) {
        const r = el.getBoundingClientRect();
        if (r.top > maxY || r.bottom < cr.top - 8) continue;
        const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!t || t.length > 10) continue;
        const low = t.toLowerCase();
        for (const w of want) {
          if (low === w || low.startsWith(`${w} `)) {
            const target = el instanceof HTMLElement ? el : el.parentElement;
            if (target instanceof HTMLElement) {
              target.click();
              return t;
            }
          }
        }
      }
      return null;
    }, order)
    .catch(() => null);
  return clicked;
}

/**
 * Largest chart canvas dims inside a frame (for interval-change detection).
 * @param {import('playwright').Frame} frame
 */
async function readLargestCanvasDimsInFrame(frame) {
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

/** Toolbar tokens that indicate TradingView interval row is mounted (at least one must appear with non-zero box). */
const DEX_INTERVAL_TOOLBAR_ANCHOR_TOKENS = ['1m', '5m', '1h'];

/**
 * Wait until the chart frame shows interval controls above the main canvas (toolbar mounted).
 * On timeout, returns without throwing so interval selection can still run (fallback unchanged).
 * @param {import('playwright').Page} page
 */
async function waitForDexIntervalToolbarReady(page) {
  const timeoutMs = Math.min(12000, Math.max(5000, Math.floor(numEnv('CHART_DEX_INTERVAL_TOOLBAR_WAIT_MS', 7000))));
  const pollMs = Math.min(800, Math.max(280, Math.floor(numEnv('CHART_DEX_INTERVAL_TOOLBAR_POLL_MS', 400))));
  const anchors = DEX_INTERVAL_TOOLBAR_ANCHOR_TOKENS;

  console.info(
    `[TokenChartDex] waiting for interval toolbar... (anchors=${anchors.join(',')}, timeoutMs=${timeoutMs}, pollMs=${pollMs})`
  );

  const start = Date.now();
  let lastLabels = [];

  while (Date.now() - start < timeoutMs) {
    const ranked = await rankFramesByChartCanvasSignal(page);
    for (const row of ranked) {
      if (row.maxA < 8000 && row.sumA < 8000) continue;
      const { frame, index: fidx } = row;

      const probe = await frame
        .evaluate(wantList => {
          const wantAnchor = new Set(wantList.map(s => s.toLowerCase()));
          const norm = s => (s || '').replace(/\s+/g, ' ').trim();
          const rects = [...document.querySelectorAll('canvas')].map(c => c.getBoundingClientRect());
          const valid = rects.filter(r => r.width > 40 && r.height > 30 && r.top >= 0 && r.top < 9000);
          if (!valid.length) return { ready: false, labels: [] };

          const topEdge = Math.min(...valid.map(r => r.top));
          const toolbarMaxY = topEdge + 96;
          const sel =
            'button, a, [role="button"], [role="tab"], [role="menuitem"], div[role="button"], span[role="button"], span, div';

          const seen = new Set();
          const labels = [];
          let anchorHit = false;

          for (const el of document.querySelectorAll(sel)) {
            if (!(el instanceof HTMLElement)) continue;
            const r = el.getBoundingClientRect();
            if (r.bottom < -400 || r.top > (window.innerHeight || 0) + 400) continue;
            if (r.top > toolbarMaxY) continue;

            const t = norm(el.textContent);
            if (!t || t.length > 14) continue;
            if (!/^\d/.test(t)) continue;
            if (!/[sSmMhHdD]/.test(t)) continue;

            const token = norm((t.split(/\s+/)[0] || '')).toLowerCase();
            if (!token) continue;

            if (wantAnchor.has(token) && r.width >= 3 && r.height >= 3) {
              anchorHit = true;
            }

            if (seen.has(token)) continue;
            seen.add(token);
            labels.push(token);
          }

          labels.sort();
          return { ready: anchorHit, labels };
        }, anchors)
        .catch(() => ({ ready: false, labels: [] }));

      lastLabels = probe.labels || [];
      if (probe.ready) {
        console.info(`[TokenChartDex] interval toolbar ready: [${lastLabels.join(', ')}] frame[${fidx}]`);
        return;
      }
    }

    await page.waitForTimeout(pollMs);
  }

  console.warn(
    `[TokenChartDex] interval toolbar NOT found (timeout after ${timeoutMs}ms) lastLabels=[${(lastLabels || []).join(', ')}]`
  );
}

/**
 * Pick timeframe: DOM click in chart iframe toolbar first (no visibility gate), then Playwright force click, then main-frame toolbar.
 * @param {import('playwright').Page} page
 * @returns {Promise<string|null>}
 */
async function trySelectShortInterval(page) {
  const order = getDexIntervalClickOrder();
  console.info(`[TokenChartDex] interval selection start order=${order.join(',')}`);

  const ranked = await rankFramesByChartCanvasSignal(page);
  let selected = null;

  for (const row of ranked) {
    if (row.maxA < 8000 && row.sumA < 8000) continue;
    const { frame, index: fidx } = row;
    await logDexToolbarIntervalCandidates(frame, fidx);

    for (const label of order) {
      const canvasBefore = await readLargestCanvasDimsInFrame(frame);

      console.info(`[TokenChartDex] interval dom attempt label="${label}" frame[${fidx}]`);
      const dom = await domClickToolbarIntervalInFrame(frame, label);

      if (dom.ok) {
        console.info(
          `[TokenChartDex] interval dom result label="${label}" frame[${fidx}] matchedText="${dom.matchedText}" nativeClick=${dom.domClickOk} syntheticEvents=${dom.usedSynthetic} targetTag=${dom.targetTag}`
        );
        const ver = await verifyDexIntervalChangeAfterClick(page, frame, fidx, label, canvasBefore);
        console.info(
          `[TokenChartDex] interval post-click verify label="${label}" frame[${fidx}] confirmed=${ver.ok} signal=${ver.signal}`
        );
        selected = label;
        break;
      }

      console.info(
        `[TokenChartDex] interval dom miss label="${label}" frame[${fidx}] reason=${dom.reason || 'unknown'}`
      );

      const esc = escapeIntervalLabelForRegex(label);
      console.info(`[TokenChartDex] interval playwright force attempt label="${label}" frame[${fidx}]`);
      try {
        const loc = frame.getByRole('button', { name: new RegExp(`^\\s*${esc}\\s*$`, 'i') }).first();
        await loc.click({ timeout: 2500, force: true });
        console.info(`[TokenChartDex] interval playwright force click OK label="${label}" frame[${fidx}]`);
        const ver = await verifyDexIntervalChangeAfterClick(page, frame, fidx, label, canvasBefore);
        console.info(
          `[TokenChartDex] interval post-click verify label="${label}" frame[${fidx}] confirmed=${ver.ok} signal=${ver.signal}`
        );
        selected = label;
        break;
      } catch (err) {
        console.info(
          `[TokenChartDex] interval playwright force miss label="${label}" frame[${fidx}] ${err?.message || err}`
        );
      }

      const exactLoc = frame.getByText(label, { exact: true }).first();
      try {
        await exactLoc.click({ timeout: 1500, force: true });
        console.info(`[TokenChartDex] interval playwright getByText force OK label="${label}" frame[${fidx}]`);
        const ver = await verifyDexIntervalChangeAfterClick(page, frame, fidx, label, canvasBefore);
        console.info(
          `[TokenChartDex] interval post-click verify label="${label}" frame[${fidx}] confirmed=${ver.ok} signal=${ver.signal}`
        );
        selected = label;
        break;
      } catch (err) {
        console.info(
          `[TokenChartDex] interval playwright getByText miss label="${label}" frame[${fidx}] ${err?.message || err}`
        );
      }
    }
    if (selected) break;
  }

  if (!selected) {
    console.info('[TokenChartDex] interval: trying main-frame toolbar-scoped click');
    const t = await tryDexToolbarScopedIntervalClick(page, order);
    if (t) {
      console.info(`[TokenChartDex] interval toolbar-scoped click OK text="${t}"`);
      selected = t;
    } else {
      console.warn('[TokenChartDex] interval: no interval button matched in any chart frame or toolbar');
    }
  }

  return selected;
}

/**
 * Wait for largest canvas box to change (or timeout) after interval change.
 * @param {import('playwright').Page} page
 * @param {string|null} selectedLabel
 */
async function waitForDexChartRerenderAfterInterval(page, selectedLabel) {
  const ranked = await rankFramesByChartCanvasSignal(page);
  const row = ranked.find(r => r.maxA >= 4000 || r.sumA >= 6000) || ranked[0];
  if (!row) {
    await page.waitForTimeout(numEnv('CHART_DEX_INTERVAL_RERENDER_WAIT_MS', 2800));
    console.info('[TokenChartDex] interval rerender wait: no chart frame, used blind delay');
    return;
  }

  const { frame, index: fidx } = row;
  const readDims = () =>
    frame
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

  const before = await readDims();
  const maxWait = numEnv('CHART_DEX_INTERVAL_RERENDER_WAIT_MS', 2800);
  const start = Date.now();
  await page.waitForTimeout(350);

  let changed = false;
  while (Date.now() - start < maxWait) {
    await page.waitForTimeout(220);
    const after = await readDims();
    if (
      before &&
      after &&
      (after.w !== before.w || after.h !== before.h || Math.abs((after.a || 0) - (before.a || 0)) > 800)
    ) {
      changed = true;
      console.info('[TokenChartDex] interval rerender detected canvas resize', { before, after, fidx });
      break;
    }
  }

  if (!changed) {
    console.info('[TokenChartDex] interval rerender: no canvas dimension change (timeout ok)', {
      before,
      selectedLabel,
      fidx
    });
  }

  await page.waitForTimeout(numEnv('CHART_DEX_STABILIZE_AFTER_INTERVAL_MS', 600));
}

/**
 * Largest plot canvas center in viewport coordinates (for page.mouse over embedded TV chart).
 * @param {import('playwright').Page} page
 * @returns {Promise<{ frame: import('playwright').Frame, frameIndex: number, absX: number, absY: number, localPx: number, localPy: number, box: { x: number, y: number, width: number, height: number }, canvasIdx: number, area: number }|null>}
 */
async function resolveDexPlotViewportCoords(page) {
  const ranked = await rankFramesByChartCanvasSignal(page);
  for (const row of ranked) {
    if (row.maxA < 8000 && row.sumA < 8000) continue;
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
    if (!box || bestA < 12000) continue;

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

/** Coarse canvas layout fingerprint (TV pan often does not resize canvases). */
async function readDexCanvasFingerprintInFrame(frame) {
  return frame
    .evaluate(() => {
      let maxA = 0;
      let sumA = 0;
      let n = 0;
      for (const c of document.querySelectorAll('canvas')) {
        const r = c.getBoundingClientRect();
        const a = r.width * r.height;
        if (a < 100) continue;
        n++;
        sumA += a;
        if (a > maxA) maxA = a;
      }
      return { n, maxA: Math.round(maxA), sumA: Math.round(sumA) };
    })
    .catch(() => null);
}

/** @returns {string} human-readable change signal */
function dexCanvasFingerprintDelta(before, after, areaThreshold = 500) {
  if (!before || !after) return 'no_fingerprint';
  if (before.n !== after.n) return `canvas_count_${before.n}_to_${after.n}`;
  if (Math.abs((before.maxA || 0) - (after.maxA || 0)) >= areaThreshold) return 'max_canvas_area_changed';
  if (Math.abs((before.sumA || 0) - (after.sumA || 0)) >= areaThreshold) return 'sum_canvas_area_changed';
  return 'unchanged';
}

function dexWheelModifierKey() {
  const v = String(process.env.CHART_DEX_WHEEL_MODIFIER || 'none').trim().toLowerCase();
  if (v === 'ctrl' || v === 'control') return 'Control';
  if (v === 'alt') return 'Alt';
  if (v === 'meta' || v === 'cmd') return 'Meta';
  return null;
}

function dexEnvBool(name, defaultVal) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultVal;
  const s = String(raw).trim();
  if (/^0$|^false$|^no$|^off$|^disabled$/i.test(s)) return false;
  if (/^1$|^true$|^yes$|^on$|^enabled$/i.test(s)) return true;
  return defaultVal;
}

/**
 * Click largest canvas in best chart frame (keyboard zoom fallback path).
 * @param {import('playwright').Page} page
 * @returns {Promise<{ index: number, frame: import('playwright').Frame }|null>}
 */
async function focusDexChartPlotForKeyboard(page) {
  const ranked = await rankFramesByChartCanvasSignal(page);
  for (const row of ranked) {
    if (row.maxA < 8000 && row.sumA < 8000) continue;
    const { frame, index } = row;
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
    if (!box || bestA < 12000) continue;

    const plot = canvases.nth(bestI);
    await plot.focus({ timeout: 2000 }).catch(() => {});
    const px = Math.max(10, Math.min(box.width - 10, box.width * 0.35));
    const py = Math.max(10, Math.min(box.height - 10, box.height * 0.4));
    await plot.click({ position: { x: px, y: py }, timeout: 3500 }).catch(() => {});
    console.info(
      `[TokenChartDex] zoom focus: plot click frame[${index}] canvasIdx=${bestI} area=${Math.round(bestA)}`
    );
    await page.waitForTimeout(180);
    return { index, frame };
  }
  console.warn('[TokenChartDex] zoom focus: no suitable canvas for plot click');
  return null;
}

/**
 * Fallback: focus wrapper if plot click failed.
 * @param {import('playwright').Page} page
 */
async function clickChartToFocus(page) {
  const ranked = await rankFramesByChartCanvasSignal(page);
  for (const { frame, maxA, sumA } of ranked) {
    if (maxA < 8000 && sumA < 8000) continue;
    const el = await findChartWrapperElementHandle(frame);
    if (!el) continue;
    try {
      await el.click({ position: { x: 64, y: 120 }, timeout: 2500 }).catch(() => {});
      console.info('[TokenChartDex] zoom focus: wrapper click fallback');
      return;
    } finally {
      await el.dispose();
    }
  }
}

/**
 * +/- keyboard nudge (fallback when plot mouse/wheel is unavailable).
 * @param {import('playwright').Page} page
 */
async function applyDexKeyboardZoomNudge(page) {
  const zoomIn = Math.min(24, Math.max(0, Math.floor(numEnv('CHART_DEX_ZOOM_IN_STEPS', 2))));
  const zoomOut = Math.min(32, Math.max(0, Math.floor(numEnv('CHART_DEX_ZOOM_OUT_STEPS', 8))));
  const keyDelay = Math.max(20, Math.floor(numEnv('CHART_DEX_ZOOM_KEY_DELAY_MS', 85)));

  const focused = await focusDexChartPlotForKeyboard(page);
  if (!focused) {
    console.info('[TokenChartDex] zoom keyboard: using wrapper focus fallback');
    await clickChartToFocus(page);
    await page.waitForTimeout(200);
  }

  if (focused) {
    console.info(
      `[TokenChartDex] zoom keyboard: page.keyboard after plot focus in chart frame[${focused.index}]`
    );
  } else {
    console.info('[TokenChartDex] zoom keyboard: page.keyboard after wrapper focus fallback');
  }

  console.info(`[TokenChartDex] zoom keyboard out start targetPresses=${zoomOut}`);
  let outSent = 0;
  for (let i = 0; i < zoomOut; i++) {
    await page.keyboard.press('-').catch(() => {});
    outSent++;
    await page.waitForTimeout(keyDelay);
  }
  console.info(`[TokenChartDex] zoom keyboard out sent count=${outSent}`);

  console.info(`[TokenChartDex] zoom keyboard in start targetPresses=${zoomIn}`);
  let inSent = 0;
  for (let i = 0; i < zoomIn; i++) {
    await page.keyboard.press('+').catch(() => {});
    inSent++;
    await page.waitForTimeout(keyDelay);
  }
  console.info(`[TokenChartDex] zoom keyboard in sent count=${inSent}`);
}

/**
 * One horizontal pan gesture; logs start/end and coarse canvas fingerprint delta (TV often pans without resizing).
 * @param {import('playwright').Page} page
 * @param {import('playwright').Frame} frame
 */
async function dexExecutePanPass(page, frame, x0, y0, x1, y1, dragSteps, timing, label) {
  const { preDown, downHold, postUp } = timing;
  const fpBefore = await readDexCanvasFingerprintInFrame(frame);
  await page.mouse.move(x0, y0);
  await page.waitForTimeout(preDown);
  await page.mouse.down();
  await page.waitForTimeout(downHold);
  await page.mouse.move(x1, y1, { steps: dragSteps });
  await page.mouse.up();
  await page.waitForTimeout(postUp);
  const fpAfter = await readDexCanvasFingerprintInFrame(frame);
  const viewSignal = dexCanvasFingerprintDelta(fpBefore, fpAfter);
  console.info(
    `[TokenChartDex] drag pan ${label} start=(${x0.toFixed(1)},${y0.toFixed(1)}) end=(${x1.toFixed(1)},${y1.toFixed(1)}) steps=${dragSteps} viewSignal=${viewSignal} fpBefore=${JSON.stringify(fpBefore)} fpAfter=${JSON.stringify(fpAfter)}`
  );
  return { viewSignal, fpBefore, fpAfter };
}

/**
 * Optional light framing: SHIFT+wheel, plain wheel (small wheel-out by default), drag opt-in; keyboard last resort unless range preset already applied.
 * @param {import('playwright').Page} page
 * @param {{ assumeFramingApplied?: boolean }} [opts]
 */
async function nudgeZoomRecentWindow(page, opts = {}) {
  const { assumeFramingApplied = false } = opts;

  const framingAssistAfterRange = dexEnvBool('CHART_DEX_FRAMING_ASSIST_AFTER_RANGE_PRESET', true);
  if (assumeFramingApplied && !framingAssistAfterRange) {
    console.info('[TokenChartDex] framing assist after range preset: disabled by env');
    await saveDexDebugStepScreenshot(page, 'dex-after-wheel-or-pan.png');
    await page.waitForTimeout(numEnv('CHART_DEX_AFTER_ZOOM_MS', 1200));
    await page.waitForTimeout(numEnv('CHART_DEX_STABILIZE_AFTER_ZOOM_MS', 800));
    console.info(
      '[TokenChartDex] zoom sequence complete framingAssist=skipped reason=CHART_DEX_FRAMING_ASSIST_AFTER_RANGE_PRESET off (set 1/true/on to enable light polish after preset)'
    );
    return;
  }

  if (assumeFramingApplied && framingAssistAfterRange) {
    console.info('[TokenChartDex] framing assist after range preset: enabled');
  }

  const shiftSteps = Math.min(100, Math.max(0, Math.floor(numEnv('CHART_DEX_SHIFT_WHEEL_STEPS', 0))));
  const shiftDelta = Math.max(20, Math.floor(numEnv('CHART_DEX_SHIFT_WHEEL_DELTA', 120)));
  const shiftDelay = Math.max(12, Math.floor(numEnv('CHART_DEX_SHIFT_WHEEL_DELAY_MS', 65)));
  let shiftSign = Number(process.env.CHART_DEX_SHIFT_WHEEL_SIGN);
  if (!Number.isFinite(shiftSign) || shiftSign === 0) shiftSign = 1;
  shiftSign = shiftSign > 0 ? 1 : -1;
  if (dexEnvBool('CHART_DEX_SHIFT_WHEEL_INVERT', false)) shiftSign *= -1;

  const wheelOutN = Math.min(64, Math.max(0, Math.floor(numEnv('CHART_DEX_WHEEL_ZOOM_OUT_STEPS', 2))));
  const wheelInN = Math.min(24, Math.max(0, Math.floor(numEnv('CHART_DEX_WHEEL_ZOOM_IN_STEPS', 0))));
  const deltaMag = Math.max(20, Math.floor(numEnv('CHART_DEX_WHEEL_DELTA', 120)));
  const wheelDelay = Math.max(18, Math.floor(numEnv('CHART_DEX_WHEEL_DELAY_MS', 72)));

  const rawDragEnv = process.env.CHART_DEX_DRAG_PAN_ENABLED;
  const dragEnabled = dexEnvBool('CHART_DEX_DRAG_PAN_ENABLED', false);
  const dragAsShiftFallback = dexEnvBool('CHART_DEX_DRAG_PAN_AS_SHIFT_FALLBACK', false);
  const dragPx = Math.min(900, Math.max(0, Math.floor(numEnv('CHART_DEX_DRAG_PAN_PX', 320))));
  const dragSteps = Math.min(60, Math.max(6, Math.floor(numEnv('CHART_DEX_DRAG_PAN_STEPS', 28))));
  const dragPasses = Math.min(4, Math.max(1, Math.floor(numEnv('CHART_DEX_DRAG_PAN_PASSES', 2))));
  const preDown = Math.max(0, Math.floor(numEnv('CHART_DEX_DRAG_PAN_PRE_DOWN_MS', 90)));
  const downHold = Math.max(0, Math.floor(numEnv('CHART_DEX_DRAG_PAN_DOWN_HOLD_MS', 55)));
  const postUp = Math.max(0, Math.floor(numEnv('CHART_DEX_DRAG_PAN_POST_UP_MS', 140)));
  const passGap = Math.max(0, Math.floor(numEnv('CHART_DEX_DRAG_PAN_PASS_GAP_MS', 220)));
  const dragFallbackAnchor = dexEnvBool('CHART_DEX_DRAG_PAN_FALLBACK_ANCHOR', true);

  const kbFallback = dexEnvBool('CHART_DEX_KEYBOARD_ZOOM_FALLBACK', true);
  const kbAfterWheel = dexEnvBool('CHART_DEX_KEYBOARD_ZOOM_AFTER_WHEEL', false);

  const shouldRunDrag =
    dragEnabled && dragPx > 0 && (shiftSteps === 0 || dragAsShiftFallback);

  console.info(
    `[TokenChartDex] chart framing config: assumeFramingApplied=${assumeFramingApplied} shiftWheelSteps=${shiftSteps} plainWheelOut=${wheelOutN} plainWheelIn=${wheelInN} CHART_DEX_DRAG_PAN_ENABLED raw=${rawDragEnv === undefined ? '(unset)' : JSON.stringify(String(rawDragEnv))} resolvedDragEnabled=${dragEnabled} dragAsShiftFallback=${dragAsShiftFallback} willRunDrag=${shouldRunDrag} dragPx=${dragPx} dragPasses=${dragPasses}`
  );

  let outSign = Number(process.env.CHART_DEX_WHEEL_ZOOM_OUT_SIGN);
  if (!Number.isFinite(outSign) || outSign === 0) outSign = 1;
  outSign = outSign > 0 ? 1 : -1;
  let inSign = Number(process.env.CHART_DEX_WHEEL_ZOOM_IN_SIGN);
  if (!Number.isFinite(inSign) || inSign === 0) inSign = -1;
  inSign = inSign > 0 ? 1 : -1;
  if (dexEnvBool('CHART_DEX_WHEEL_INVERT', false)) {
    outSign *= -1;
    inSign *= -1;
  }

  const modKey = dexWheelModifierKey();
  const plot = await resolveDexPlotViewportCoords(page);

  let shiftWheelSent = 0;
  let wheelOutSent = 0;
  let wheelInSent = 0;
  let wheelAttempted = false;
  let dragAttempted = false;
  let usedKeyboardFallback = false;
  let dragFallbackAttempted = false;

  const timing = { preDown, downHold, postUp };

  const runWheel = async deltaY => {
    if (modKey) {
      await page.keyboard.down(modKey);
      try {
        await page.mouse.wheel(0, deltaY);
      } finally {
        await page.keyboard.up(modKey);
      }
    } else {
      await page.mouse.wheel(0, deltaY);
    }
  };

  if (plot) {
    const { frame } = plot;
    console.info(
      `[TokenChartDex] plot focus: frame[${plot.frameIndex}] canvasIdx=${plot.canvasIdx} area=${Math.round(plot.area)} viewport=(${plot.absX.toFixed(1)},${plot.absY.toFixed(1)}) local=(${plot.localPx.toFixed(1)},${plot.localPy.toFixed(1)}) canvasBox=${JSON.stringify(plot.box)}`
    );

    await page.mouse.move(plot.absX, plot.absY);
    await page.waitForTimeout(70);
    await page.mouse.click(plot.absX, plot.absY);
    await page.waitForTimeout(120);

    if (shiftSteps > 0) {
      await page.mouse.move(plot.absX, plot.absY);
      await page.waitForTimeout(55);
      console.info(
        `[TokenChartDex] shift-wheel zoom start ticks=${shiftSteps} deltaYeach=${shiftSign * shiftDelta} delayMs=${shiftDelay}`
      );
      console.info('[TokenChartDex] shift-wheel: SHIFT key down');
      await page.keyboard.down('Shift');
      try {
        for (let i = 0; i < shiftSteps; i++) {
          await page.mouse.wheel(0, shiftSign * shiftDelta);
          shiftWheelSent++;
          await page.waitForTimeout(shiftDelay);
        }
        console.info(`[TokenChartDex] shift-wheel ticks sent=${shiftWheelSent}`);
      } finally {
        await page.keyboard.up('Shift');
        console.info('[TokenChartDex] shift-wheel: SHIFT key up');
      }
      await page.waitForTimeout(90);
    } else {
      console.info('[TokenChartDex] shift-wheel: skipped (CHART_DEX_SHIFT_WHEEL_STEPS=0)');
    }

    if (wheelOutN + wheelInN > 0) {
      wheelAttempted = true;
      console.info(
        `[TokenChartDex] plain wheel (after shift-wheel): outTicks=${wheelOutN} inTicks=${wheelInN} deltaMag=${deltaMag} outSign=${outSign} inSign=${inSign} modifier=${modKey || 'none'}`
      );
    } else {
      console.info('[TokenChartDex] plain wheel: skipped (CHART_DEX_WHEEL_ZOOM_OUT/IN_STEPS both 0)');
    }

    if (wheelOutN > 0) {
      await page.mouse.move(plot.absX, plot.absY);
      await page.waitForTimeout(80);
      for (let i = 0; i < wheelOutN; i++) {
        await runWheel(outSign * deltaMag);
        wheelOutSent++;
        await page.waitForTimeout(wheelDelay);
      }
      console.info(`[TokenChartDex] plain wheel out sent count=${wheelOutSent} deltaYeach=${outSign * deltaMag}`);
    }

    if (wheelInN > 0) {
      await page.mouse.move(plot.absX, plot.absY);
      await page.waitForTimeout(70);
      for (let i = 0; i < wheelInN; i++) {
        await runWheel(inSign * deltaMag);
        wheelInSent++;
        await page.waitForTimeout(wheelDelay);
      }
      console.info(
        `[TokenChartDex] plain wheel in sent count=${wheelInSent} deltaYeach=${inSign * deltaMag}`
      );
    }

    let measurablePanSignal = false;

    if (shouldRunDrag) {
      dragAttempted = true;
      let lastSignal = 'unchanged';
      for (let p = 1; p <= dragPasses; p++) {
        const x0 = plot.absX;
        const y0 = plot.absY;
        const x1 = plot.absX - dragPx;
        const y1 = plot.absY;
        const r = await dexExecutePanPass(
          page,
          frame,
          x0,
          y0,
          x1,
          y1,
          dragSteps,
          timing,
          `pass${p}/${dragPasses}`
        );
        lastSignal = r.viewSignal;
        if (r.viewSignal !== 'unchanged' && r.viewSignal !== 'no_fingerprint') {
          measurablePanSignal = true;
        }
        if (p < dragPasses) await page.waitForTimeout(passGap);
      }

      if (dragFallbackAnchor && !measurablePanSignal && lastSignal === 'unchanged') {
        dragFallbackAttempted = true;
        const altX = plot.box.x + Math.max(12, Math.min(plot.box.width - 12, plot.box.width * 0.55));
        const altY = plot.absY;
        const x1 = altX - dragPx;
        console.warn(
          '[TokenChartDex] drag pan: fallback anchor (fingerprint still unchanged after primary passes)'
        );
        const r2 = await dexExecutePanPass(
          page,
          frame,
          altX,
          altY,
          x1,
          altY,
          dragSteps,
          timing,
          'fallback_anchor'
        );
        if (r2.viewSignal !== 'unchanged' && r2.viewSignal !== 'no_fingerprint') {
          measurablePanSignal = true;
        }
      }

      if (measurablePanSignal) {
        console.info('[TokenChartDex] drag pan: measurable canvas fingerprint change detected (layout)');
      } else {
        console.info(
          '[TokenChartDex] drag pan: no measurable canvas fingerprint change (TradingView may still have panned; WebGL often keeps canvas size)'
        );
      }
      console.info(
        `[TokenChartDex] drag pan summary: fallbackAnchorAttempted=${dragFallbackAttempted} passes=${dragPasses}`
      );
    } else {
      console.info(
        `[TokenChartDex] drag pan: skipped (resolvedDragEnabled=${dragEnabled} dragPx=${dragPx} shiftSteps=${shiftSteps} dragAsShiftFallback=${dragAsShiftFallback}) rawEnv=${rawDragEnv === undefined ? '(unset)' : JSON.stringify(String(rawDragEnv))}`
      );
    }

    const didFraming =
      assumeFramingApplied ||
      shiftWheelSent > 0 ||
      wheelOutSent + wheelInSent > 0 ||
      (dragAttempted && dragPx > 0);
    if (kbAfterWheel) {
      console.info('[TokenChartDex] zoom keyboard: running after pan/wheel (CHART_DEX_KEYBOARD_ZOOM_AFTER_WHEEL=1)');
      await applyDexKeyboardZoomNudge(page);
    } else if (!didFraming && kbFallback) {
      usedKeyboardFallback = true;
      console.info('[TokenChartDex] zoom keyboard fallback: used=true (no shift-wheel, no plain wheel, no drag)');
      await applyDexKeyboardZoomNudge(page);
    } else {
      console.info('[TokenChartDex] zoom keyboard fallback: used=false');
    }
  } else {
    console.warn('[TokenChartDex] chart framing: no plot viewport coords (canvas box missing)');
    if (assumeFramingApplied) {
      console.info(
        '[TokenChartDex] framing assist after range preset: skipped — no plot viewport coords (cannot apply wheel/drag)'
      );
    }
    if (!assumeFramingApplied && kbFallback) {
      usedKeyboardFallback = true;
      console.info('[TokenChartDex] zoom keyboard fallback: used=true (no plot target)');
      await applyDexKeyboardZoomNudge(page);
    } else if (assumeFramingApplied) {
      console.info(
        '[TokenChartDex] zoom keyboard fallback: used=false (range preset applied, no plot viewport for wheel/drag; light assist could not focus chart)'
      );
    } else {
      console.info('[TokenChartDex] zoom keyboard fallback: used=false (CHART_DEX_KEYBOARD_ZOOM_FALLBACK=0)');
    }
  }

  await saveDexDebugStepScreenshot(page, 'dex-after-wheel-or-pan.png');

  await page.waitForTimeout(numEnv('CHART_DEX_AFTER_ZOOM_MS', 1200));
  await page.waitForTimeout(numEnv('CHART_DEX_STABILIZE_AFTER_ZOOM_MS', 800));
  console.info(
    `[TokenChartDex] zoom sequence complete shiftWheelTicks=${shiftWheelSent} plainWheelAttempted=${wheelAttempted} plainWheelOut=${wheelOutSent} plainWheelIn=${wheelInSent} dragAttempted=${dragAttempted} dragFallbackAnchor=${dragFallbackAttempted} keyboardFallback=${usedKeyboardFallback}`
  );
}

/**
 * Prefer candlesticks if a clear toggle exists (Dex often defaults to candles).
 * @param {import('playwright').Page} page
 */
async function trySelectCandles(page) {
  console.info('[TokenChartDex] candles: checking');
  try {
    const c = page.getByRole('button', { name: /candles?/i }).first();
    if (await c.isVisible({ timeout: 800 })) {
      await c.click({ timeout: 2000 });
      await page.waitForTimeout(400);
      console.info('[TokenChartDex] candles: clicked candle mode toggle');
    } else {
      console.info('[TokenChartDex] candles: no visible toggle (ok if already candles)');
    }
  } catch (err) {
    console.info('[TokenChartDex] candles: skip', err?.message || err);
  }
}

/**
 * @param {import('playwright').Page} page
 * @param {string} basename
 */
async function saveDexDebugStepScreenshot(page, basename) {
  if (!isChartDexDebug() || !page) return;
  try {
    const dir = getDexDebugDir();
    await fs.mkdir(dir, { recursive: true });
    const fp = path.join(dir, basename);
    await page.screenshot({ path: fp, fullPage: false, type: 'png' });
    console.info(`[TokenChartDex][debug] wrote ${path.relative(process.cwd(), fp) || fp}`);
  } catch (err) {
    console.warn('[TokenChartDex][debug] step screenshot failed:', err?.message || err);
  }
}

/**
 * Ordered DexScreener / TradingView-style wrappers: prefer markup table / widget (toolbar + plot + scales).
 * @type {{ key: string, sel: string, minW: number, minH: number }[]}
 */
const CHART_WRAPPER_SELECTOR_ORDER = [
  { key: '.chart-markup-table', sel: '.chart-markup-table', minW: 220, minH: 200 },
  { key: '.chart-widget', sel: '.chart-widget', minW: 220, minH: 200 },
  { key: '.chart-container.top-full-width-chart.active', sel: '.chart-container.top-full-width-chart.active', minW: 220, minH: 200 },
  { key: '.chart-container-border', sel: '.chart-container-border', minW: 200, minH: 160 },
  { key: '#tv-chart-container', sel: '#tv-chart-container', minW: 220, minH: 200 }
];

/**
 * First matching visible wrapper in this frame (Playwright locators are frame-scoped).
 * @param {import('playwright').Frame} frame
 * @returns {Promise<{ handle: import('playwright').ElementHandle, selector: string }|null>}
 */
async function findPreferredChartWrapperInFrame(frame) {
  for (const { key, sel, minW, minH } of CHART_WRAPPER_SELECTOR_ORDER) {
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
      /* try next */
    }
  }
  return null;
}

/**
 * Climb from largest visible canvas to a wrapper that includes toolbar + plot (fallback).
 * Uses relaxed canvas size so multi-pane TV layouts still match.
 * @param {import('playwright').Frame} frame
 * @returns {Promise<import('playwright').ElementHandle|null>}
 */
async function findCanvasParentFallbackWrapperHandle(frame) {
  const maxDepth = Math.min(16, Math.max(6, Math.floor(numEnv('CHART_DEX_FALLBACK_PARENT_DEPTH', 10))));
  let js;
  try {
    js = await frame.evaluateHandle(
      ({ minArea, maxDepth: md }) => {
        const canvases = [...document.querySelectorAll('canvas')].filter(c => {
          const r = c.getBoundingClientRect();
          const area = r.width * r.height;
          if (area < minArea) return false;
          if (r.width < 50 || r.height < 40) return false;
          if (r.bottom < -30 || r.top > (window.innerHeight || 0) + 200) return false;
          return true;
        });
        if (!canvases.length) return null;

        canvases.sort((a, b) => {
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          return rb.width * rb.height - ra.width * ra.height;
        });

        const main = canvases[0];
        let node = main;
        let best = main;

        for (let depth = 0; depth < md && node && node.parentElement; depth++) {
          node = node.parentElement;
          const r = node.getBoundingClientRect();
          const area = r.width * r.height;
          const br = best.getBoundingClientRect();
          const bestArea = br.width * br.height;
          if (
            r.width >= br.width * 0.82 &&
            r.height >= br.height * 0.85 &&
            area <= bestArea * 12 &&
            r.height < (window.innerHeight || 9999) * 0.96
          ) {
            best = node;
          }
        }

        return best;
      },
      { minArea: CANVAS_FALLBACK_MIN_AREA, maxDepth }
    );
  } catch {
    return null;
  }

  const el = js.asElement();
  await js.dispose();
  return el;
}

/**
 * @param {import('playwright').Frame} frame
 * @returns {Promise<{ handle: import('playwright').ElementHandle, selector: string, source: 'primary'|'fallback' }|null>}
 */
async function resolveChartWrapperInFrame(frame) {
  const preferred = await findPreferredChartWrapperInFrame(frame);
  if (preferred) return { ...preferred, source: 'primary' };

  const fallback = await findCanvasParentFallbackWrapperHandle(frame);
  if (fallback) return { handle: fallback, selector: 'canvas-parent-fallback', source: 'fallback' };

  return null;
}

/**
 * @param {import('playwright').Frame} frame
 * @returns {Promise<import('playwright').ElementHandle|null>}
 */
async function findChartWrapperElementHandle(frame) {
  const resolved = await resolveChartWrapperInFrame(frame);
  return resolved ? resolved.handle : null;
}

/**
 * If the chosen wrapper is vertically tight, climb to a chart-like parent that fully contains it for more x-axis / range-row air.
 * @param {import('playwright').ElementHandle} handle
 * @returns {Promise<import('playwright').ElementHandle>}
 */
async function expandDexWrapperHandleForVerticalPadding(handle) {
  const minComfortH = Math.min(920, Math.max(220, numEnv('CHART_DEX_WRAPPER_MIN_COMFORT_HEIGHT', 320)));
  const maxUp = Math.min(12, Math.max(1, Math.floor(numEnv('CHART_DEX_WRAPPER_PARENT_CLIMB_STEPS', 6))));

  let upgraded;
  try {
    upgraded = await handle.evaluateHandle(
      (el, args) => {
        const { minH, maxUpSteps } = args;
        if (!(el instanceof Element)) return el;
        let best = el;
        let br = el.getBoundingClientRect();
        let node = el;
        for (let i = 0; i < maxUpSteps && node.parentElement; i++) {
          const p = node.parentElement;
          if (!(p instanceof HTMLElement)) break;
          const r = p.getBoundingClientRect();
          const hint = `${p.className || ''} ${p.id || ''}`;
          const chartish = /chart|widget|container|tv-|markup|layout|pane|card|border/i.test(hint);
          if (!chartish) break;
          const cr = best.getBoundingClientRect();
          const contains =
            r.top <= cr.top + 8 &&
            r.left <= cr.left + 8 &&
            r.bottom >= cr.bottom - 12 &&
            r.right >= cr.right - 8;
          if (
            contains &&
            r.height >= minH &&
            r.height > cr.height + 14 &&
            r.height < cr.height * 4.2
          ) {
            best = p;
            br = r;
          }
          node = p;
        }
        return best;
      },
      { minH: minComfortH, maxUpSteps: maxUp }
    );
  } catch {
    return handle;
  }

  const newEl = upgraded.asElement();
  await upgraded.dispose();
  if (!newEl) return handle;

  await handle.dispose();
  return newEl;
}

async function waitForAnyFrameCanvas(page, minArea, waitMs) {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      try {
        const ok = await frame.evaluate(
          minA => {
            for (const c of document.querySelectorAll('canvas')) {
              const r = c.getBoundingClientRect();
              if (r.width * r.height >= minA && r.width > 80 && r.height > 50) return true;
            }
            return false;
          },
          minArea
        );
        if (ok) return;
      } catch {
        /* detached / cross-origin */
      }
    }
    await page.waitForTimeout(350);
  }
}

/**
 * Score each frame by visible canvas area — prefer the frame that actually hosts the TradingView chart.
 * @param {import('playwright').Page} page
 * @returns {Promise<{ index: number, frame: import('playwright').Frame, maxA: number, sumA: number }[]>}
 */
async function rankFramesByChartCanvasSignal(page) {
  const frames = page.frames();
  const rows = [];

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    try {
      const { maxA, sumA } = await frame.evaluate(() => {
        let maxA = 0;
        let sumA = 0;
        for (const c of document.querySelectorAll('canvas')) {
          const r = c.getBoundingClientRect();
          const a = r.width * r.height;
          if (a < 8000) continue;
          if (r.width < 50 || r.height < 40) continue;
          if (r.bottom < -40 || r.top > (window.innerHeight || 0) + 180) continue;
          sumA += a;
          if (a > maxA) maxA = a;
        }
        return { maxA, sumA };
      });
      rows.push({ index: i, frame, maxA, sumA });
    } catch {
      rows.push({ index: i, frame, maxA: 0, sumA: 0 });
    }
  }

  rows.sort((a, b) => b.maxA - a.maxA || b.sumA - a.sumA);
  return rows;
}

/**
 * Rank visible DOM containers around the main chart canvas (same frame as TV / framing).
 * Prefers chart wrappers / ancestors that include axes + range bar; rejects full-viewport, trades table, side panels.
 * @param {import('playwright').Frame} frame
 * @returns {Promise<{
 *   useRawCanvas: boolean,
 *   climbSteps: number,
 *   kind: string,
 *   selector: string,
 *   anchorSelector: string|null,
 *   candidates: object[]
 * }|null>}
 */
async function evaluateDexCaptureTargetResolution(frame) {
  const minCanvasArea = CANVAS_FALLBACK_MIN_AREA;
  try {
    return await frame.evaluate(minA => {
      function findMainCanvas() {
        const canvases = [...document.querySelectorAll('canvas')].filter(c => {
          const r = c.getBoundingClientRect();
          const a = r.width * r.height;
          if (a < minA) return false;
          if (r.width < 50 || r.height < 40) return false;
          const vh = window.innerHeight || 0;
          if (r.bottom < -40 || r.top > vh + 180) return false;
          return true;
        });
        if (!canvases.length) return null;
        canvases.sort((a, b) => {
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          return rb.width * rb.height - ra.width * ra.height;
        });
        return canvases[0];
      }

      const main = findMainCanvas();
      if (!main) return null;

      const crect = main.getBoundingClientRect();
      const canvasArea = Math.max(1, crect.width * crect.height);
      const vw = window.innerWidth || 1;
      const vh = window.innerHeight || 1;
      const viewportArea = vw * vh;

      function containsRect(outer, inner, pad) {
        return (
          outer.left <= inner.left + pad &&
          outer.top <= inner.top + pad &&
          outer.right >= inner.right - pad &&
          outer.bottom >= inner.bottom - pad
        );
      }

      function badHint(el) {
        const s = `${el.className || ''} ${el.id || ''} ${el.getAttribute('role') || ''}`;
        return /token-stats|pair-symbol|chart-header__|order-book|orderbook|transactions?-table|trade-table|recent-trades|swap-panel|holders-tab|sidebar|social-|community-links|pool-info-card|dex-table|trades-list|tx-table/i.test(
          s
        );
      }

      function goodHint(el) {
        const s = `${el.className || ''} ${el.id || ''}`;
        return /chart|widget|tv-|markup|tradingview|pane|plot|container-border|layout__area|markup-/i.test(s);
      }

      function knownSelHit(el) {
        const hits = [];
        for (const sel of [
          '.chart-markup-table',
          '.chart-widget',
          '#tv-chart-container',
          '.chart-container-border',
          '.chart-container.top-full-width-chart.active'
        ]) {
          try {
            if (el.matches && el.matches(sel)) hits.push(sel);
          } catch {
            /* */
          }
        }
        return hits.join('+');
      }

      const ANCHOR_SEL_ORDER = [
        '.chart-markup-table',
        '.chart-widget',
        '#tv-chart-container',
        '.chart-container-border',
        '.chart-container.top-full-width-chart.active'
      ];

      function findAnchoringSelector(mainCanvas, el) {
        for (const sel of ANCHOR_SEL_ORDER) {
          try {
            if (mainCanvas.closest(sel) === el) return sel;
          } catch {
            /* */
          }
        }
        return null;
      }

      /** @type {Map<Element, { score: number, step: number, source: string }>} */
      const elScores = new Map();
      const candLog = [];

      function scoreElement(el, step, source) {
        if (!(el instanceof HTMLElement)) return;
        const r = el.getBoundingClientRect();
        const area = r.width * r.height;
        if (area < 1 || r.width < 160 || r.height < 140) {
          candLog.push({
            source,
            step,
            tag: el.tagName,
            cls: String(el.className || '').slice(0, 96),
            area: Math.round(area),
            score: -9999,
            reasons: 'too_small'
          });
          return;
        }
        if (!containsRect(r, crect, 6)) {
          candLog.push({
            source,
            step,
            tag: el.tagName,
            cls: String(el.className || '').slice(0, 96),
            area: Math.round(area),
            score: -9999,
            reasons: 'no_contain_canvas'
          });
          return;
        }

        let score = 50;
        const reasons = [];

        if (area >= viewportArea * 0.86) {
          score -= 200;
          reasons.push('near_full_viewport');
        }
        if (r.width >= vw * 0.97 && r.height >= vh * 0.88) {
          score -= 150;
          reasons.push('fullpage_wh');
        }

        const ratio = area / canvasArea;
        if (ratio > 24) {
          score -= 120;
          reasons.push('huge_vs_canvas');
        } else if (ratio > 12) {
          score -= 55;
          reasons.push('large_vs_canvas');
        }

        const below = r.bottom - crect.bottom;
        if (below > crect.height * 1.15 && ratio > 4) {
          score -= 90;
          reasons.push('deep_below_canvas');
        }
        if (below > vh * 0.38) {
          score -= 70;
          reasons.push('bottom_excess');
        }

        if (r.width > crect.width * 1.38 && r.right > vw * 0.93) {
          score -= 45;
          reasons.push('wide_right_panel');
        }

        if (badHint(el)) {
          score -= 95;
          reasons.push('bad_hint');
        }
        if (goodHint(el)) {
          score += 35;
          reasons.push('good_hint');
        }

        const kh = knownSelHit(el);
        if (kh) {
          score += 42;
          reasons.push('known:' + kh);
        }

        const hratio = r.height / crect.height;
        if (hratio >= 1.04 && hratio <= 1.85) {
          score += 38;
          reasons.push('nice_v_pad');
        } else if (hratio > 2.4 && hratio < 8) {
          score -= 25;
          reasons.push('tall_stack');
        }

        if (r.height > vh * 0.82) {
          score -= 60;
          reasons.push('very_tall');
        }

        candLog.push({
          source,
          step,
          tag: el.tagName,
          id: String(el.id || '').slice(0, 48),
          cls: String(el.className || '').slice(0, 96),
          area: Math.round(area),
          score: Math.round(score * 10) / 10,
          reasons: reasons.join(',')
        });

        const prev = elScores.get(el);
        if (!prev || score > prev.score) {
          elScores.set(el, { score, step, source });
        }
      }

      let node = main;
      let step = 0;
      const maxDepth = 22;
      while (node && step <= maxDepth) {
        scoreElement(node, step, step === 0 ? 'canvas' : `ancestor:${step}`);
        node = node.parentElement;
        step++;
      }

      for (const sel of [
        '.chart-markup-table',
        '.chart-widget',
        '#tv-chart-container',
        '.chart-container-border',
        '.chart-container.top-full-width-chart.active'
      ]) {
        try {
          const hit = main.closest(sel);
          if (hit) scoreElement(hit, -1, `closest:${sel}`);
        } catch {
          /* */
        }
      }

      const nonCanvas = [...elScores.entries()].filter(([el]) => el !== main);
      if (!nonCanvas.length) {
        candLog.sort((a, b) => b.score - a.score);
        return {
          useRawCanvas: true,
          climbSteps: -1,
          kind: 'canvas',
          selector: '',
          anchorSelector: null,
          candidates: candLog.slice(0, 16)
        };
      }

      nonCanvas.sort((a, b) => b[1].score - a[1].score);
      const MIN_SCORE = 15;
      if (nonCanvas[0][1].score < MIN_SCORE) {
        candLog.sort((a, b) => b.score - a.score);
        return {
          useRawCanvas: true,
          climbSteps: -1,
          kind: 'canvas',
          selector: '',
          anchorSelector: null,
          candidates: candLog.slice(0, 16)
        };
      }

      const bestEl = nonCanvas[0][0];
      const meta = nonCanvas[0][1];
      let climb = 0;
      let n = main;
      while (n && n !== bestEl) {
        n = n.parentElement;
        climb++;
      }
      if (n !== bestEl) {
        candLog.sort((a, b) => b.score - a.score);
        return {
          useRawCanvas: true,
          climbSteps: -1,
          kind: 'canvas',
          selector: '',
          anchorSelector: null,
          candidates: candLog.slice(0, 16)
        };
      }

      const id = String(bestEl.id || '').slice(0, 48);
      const cls = String(bestEl.className || '').slice(0, 72).replace(/\s+/g, ' ');
      const selTag = knownSelHit(bestEl) || `${bestEl.tagName}${id ? '#' + id : ''}`;

      candLog.sort((a, b) => b.score - a.score);

      return {
        useRawCanvas: false,
        climbSteps: climb,
        kind: meta.source,
        selector: selTag + (cls ? ` .${cls.split(' ').slice(0, 3).join('.')}` : ''),
        anchorSelector: findAnchoringSelector(main, bestEl),
        candidates: candLog.slice(0, 16)
      };
    }, minCanvasArea);
  } catch {
    return null;
  }
}

/**
 * Same main chart canvas as ranking (largest qualifying plot in frame) — locator only, no long-lived handles.
 * @param {import('playwright').Frame} frame
 * @returns {Promise<import('playwright').Locator|null>}
 */
async function findDexMainChartCanvasLocator(frame) {
  const canvases = frame.locator('canvas');
  const count = await canvases.count().catch(() => 0);
  let bestLoc = null;
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
    if (area < CANVAS_FALLBACK_MIN_AREA || b.width < 50 || b.height < 40) continue;
    if (area > bestArea) {
      bestArea = area;
      bestLoc = loc;
    }
  }
  return bestLoc;
}

/**
 * Re-resolve capture container in frame scope (anchor + contains-canvas, else parent chain from main canvas).
 * @param {import('playwright').Frame} frame
 * @param {{ anchorSelector: string|null, climbSteps: number }} res
 * @param {import('playwright').Locator} canvasLoc
 * @returns {Promise<import('playwright').Locator>}
 */
async function buildDexCaptureTargetLocator(frame, res, canvasLoc) {
  if (res.anchorSelector) {
    const scoped = frame.locator(res.anchorSelector).filter({ has: canvasLoc }).first();
    const n = await scoped.count().catch(() => 0);
    if (n > 0) return scoped;
  }
  let loc = canvasLoc;
  for (let s = 0; s < res.climbSteps; s++) {
    loc = loc.locator('xpath=..');
  }
  return loc;
}

/**
 * After wrapper failure / null box: screenshot best ranked chart container in frame (same main canvas as framing).
 * @param {import('playwright').Frame} frame
 * @param {number} frameIndex
 * @returns {Promise<Buffer|null>}
 */
async function tryDexSmartContainerScreenshot(frame, frameIndex) {
  const res = await evaluateDexCaptureTargetResolution(frame);
  if (!res) return null;

  let candStr = JSON.stringify(res.candidates);
  if (candStr.length > 7800) candStr = candStr.slice(0, 7800) + '…';
  console.info(`[TokenChartDex] capture target candidates frame[${frameIndex}]: ${candStr}`);

  if (res.useRawCanvas) return null;

  const canvasLoc = await findDexMainChartCanvasLocator(frame);
  if (!canvasLoc) {
    console.info(
      '[TokenChartDex] capture failure: selector=' +
        (res.selector || res.anchorSelector || 'unknown') +
        ' reason=no_main_chart_canvas_locator'
    );
    return null;
  }

  const capLoc = await buildDexCaptureTargetLocator(frame, res, canvasLoc);
  const logSel = res.selector || res.anchorSelector || `climb:${res.climbSteps}`;
  console.info(
    `[TokenChartDex] capture target selected frame[${frameIndex}]: kind=${res.kind} selector=${res.selector} anchor=${res.anchorSelector || 'none'} climbSteps=${res.climbSteps}`
  );

  const page = frame.page();

  for (let round = 0; round < 2; round++) {
    let eh = null;
    try {
      eh = await capLoc.elementHandle();
    } catch {
      eh = null;
    }
    if (!eh) {
      console.info(`[TokenChartDex] capture failure: selector=${logSel} reason=no_element_handle`);
      return null;
    }

    const connected = await eh.evaluate(node => !!(node && node.isConnected)).catch(() => false);
    if (!connected) {
      await eh.dispose().catch(() => {});
      if (round === 0) {
        await page.waitForTimeout(90).catch(() => {});
        continue;
      }
      console.info(`[TokenChartDex] capture failure: selector=${logSel} reason=element_detached`);
      return null;
    }

    let box = null;
    try {
      box = await eh.boundingBox();
    } catch {
      box = null;
    }
    const boxLog = box
      ? {
          w: Math.round(box.width * 10) / 10,
          h: Math.round(box.height * 10) / 10,
          x: Math.round(box.x * 10) / 10,
          y: Math.round(box.y * 10) / 10
        }
      : null;
    console.info(`[TokenChartDex] capture attempt: selector=${logSel} box=${JSON.stringify(boxLog)}`);

    if (!box) {
      await eh.dispose().catch(() => {});
      if (round === 0) {
        await page.waitForTimeout(90).catch(() => {});
        continue;
      }
      console.info(`[TokenChartDex] capture failure: selector=${logSel} reason=boundingBox_null_after_retry`);
      return null;
    }

    try {
      const png = await eh.screenshot({ type: 'png', timeout: 20000 });
      await eh.dispose().catch(() => {});
      if (png && png.length >= 24 && png.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') {
        console.info(`[TokenChartDex] capture success: selector=${logSel}`);
        console.info('[TokenChartDex] capture fallback: using ancestor container instead of raw canvas');
        return png;
      }
      console.info(`[TokenChartDex] capture failure: selector=${logSel} reason=invalid_png`);
      return null;
    } catch (err) {
      await eh.dispose().catch(() => {});
      const msg = err && err.message ? err.message : String(err);
      if (round === 0) {
        console.info(`[TokenChartDex] capture failure: selector=${logSel} reason=${msg} (retry)`);
        await page.waitForTimeout(90).catch(() => {});
        continue;
      }
      console.info(`[TokenChartDex] capture failure: selector=${logSel} reason=${msg}`);
      return null;
    }
  }

  return null;
}

/**
 * Screenshot the largest canvas in a frame that has a non-null Playwright boundingBox (same frame as Dex capture).
 * On area tie, the first largest wins.
 * @param {import('playwright').Frame} frame
 * @returns {Promise<{ png: Buffer, area: number }|null>}
 */
async function screenshotLargestCanvasInFrame(frame) {
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
    if (area <= 0) continue;
    if (area > bestArea) {
      bestArea = area;
      bestIdx = i;
    }
  }
  if (bestIdx < 0) return null;
  try {
    const png = await canvases.nth(bestIdx).screenshot({ type: 'png', timeout: 20000 });
    if (
      png &&
      png.length >= 24 &&
      png.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
    ) {
      return { png, area: Math.round(bestArea) };
    }
  } catch {
    /* */
  }
  return null;
}

async function screenshotChartWrapperPng(page) {
  const ranked = await rankFramesByChartCanvasSignal(page);

  for (const { frame, index, maxA, sumA } of ranked) {
    if (maxA < 8000 && sumA < 8000) continue;

    const resolved = await resolveChartWrapperInFrame(frame);
    if (!resolved) continue;

    const { handle, selector, source } = resolved;
    let shotHandle = handle;
    try {
      shotHandle = await expandDexWrapperHandleForVerticalPadding(handle);
    } catch {
      shotHandle = handle;
    }

    let box = null;
    try {
      box = await shotHandle.boundingBox();
    } catch {
      box = null;
    }
    const boxLog = box
      ? { w: Math.round(box.width * 10) / 10, h: Math.round(box.height * 10) / 10, x: Math.round(box.x * 10) / 10, y: Math.round(box.y * 10) / 10 }
      : null;
    console.info(
      `[TokenChartDex] screenshot using frame[${index}] wrapper=${selector} kind=${source} box=${JSON.stringify(boxLog)}`
    );

    if (!box) {
      console.info('[TokenChartDex] wrapper box=null, resolving ranked chart container for capture');
      let smartPng = null;
      try {
        smartPng = await tryDexSmartContainerScreenshot(frame, index);
      } finally {
        await shotHandle.dispose().catch(() => {});
      }
      if (smartPng) return smartPng;
      console.info('[TokenChartDex] capture fallback: raw canvas only (last resort)');
      const fb = await screenshotLargestCanvasInFrame(frame);
      if (fb) {
        console.info(`[TokenChartDex] fallback canvas screenshot area=${fb.area}`);
        return fb.png;
      }
      console.info('[TokenChartDex] fallback failed: no canvas with box');
      continue;
    }

    try {
      const png = await shotHandle.screenshot({ type: 'png', timeout: 20000 });
      if (
        png &&
        png.length >= 24 &&
        png.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
      ) {
        console.info(
          `[TokenChartDex] chart capture OK frame[${index}] wrapper=${selector} kind=${source} box=${JSON.stringify(boxLog)}`
        );
        await shotHandle.dispose().catch(() => {});
        return png;
      }
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      console.info(`[TokenChartDex] wrapper screenshot failed, trying ranked container then canvas: ${msg}`);
      let smartPng = null;
      try {
        smartPng = await tryDexSmartContainerScreenshot(frame, index);
      } finally {
        await shotHandle.dispose().catch(() => {});
      }
      if (smartPng) return smartPng;
      console.info('[TokenChartDex] capture fallback: raw canvas only (last resort)');
      const fb = await screenshotLargestCanvasInFrame(frame);
      if (fb) {
        console.info(`[TokenChartDex] fallback canvas screenshot area=${fb.area}`);
        return fb.png;
      }
      console.info('[TokenChartDex] fallback failed: no canvas with box');
      continue;
    }
    await shotHandle.dispose().catch(() => {});
  }
  return null;
}

/**
 * @param {object} trackedCall
 * @returns {Promise<Buffer|null>}
 */
async function fetchDexScreenerChartPng(trackedCall) {
  const contractAddress = resolveSolanaContract(trackedCall);
  if (!contractAddress) return null;

  const timeoutMs = numEnv('CHART_DEX_TIMEOUT_MS', DEFAULT_TIMEOUT_MS);
  const url = dexScreenerTokenUrl(contractAddress);
  const vw = numEnv('CHART_DEX_VIEWPORT_WIDTH', numEnv('X_CHART_WIDTH', DEFAULT_VIEWPORT.width));
  const vh = numEnv('CHART_DEX_VIEWPORT_HEIGHT', numEnv('X_CHART_HEIGHT', DEFAULT_VIEWPORT.height));
  const dpr = Math.min(3, Math.max(1, numEnv('CHART_DEX_DEVICE_SCALE', 2)));

  let context = null;
  let page = null;

  try {
    const browser = await getSharedBrowser();
    context = await browser.newContext({
      viewport: { width: vw, height: vh },
      deviceScaleFactor: dpr,
      colorScheme: 'dark',
      userAgent:
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
    await waitForDexIntervalToolbarReady(page);
    const selectedInterval = await trySelectShortInterval(page);

    await saveDexDebugStepScreenshot(page, 'dex-after-interval.png');

    await waitForDexChartRerenderAfterInterval(page, selectedInterval);

    const rangePresetApplied = await applyDexBottomRangePresetFromPage(page);
    await page.waitForTimeout(numEnv('CHART_DEX_RANGE_PRESET_SETTLE_MS', 700));

    await nudgeZoomRecentWindow(page, { assumeFramingApplied: rangePresetApplied });

    await saveDexDebugStepScreenshot(page, 'dex-after-zoom.png');

    await page.waitForTimeout(numEnv('CHART_DEX_STABILIZE_MS', 1200));

    const png = await screenshotChartWrapperPng(page);
    if (!png) {
      console.warn('[TokenChartDex] No chart canvas/wrapper found after load');
      if (isChartDexDebug()) await runDexChartDebugOnFailure(page, 'no_chart_wrapper');
      return null;
    }
    return png;
  } catch (err) {
    console.warn('[TokenChartDex] Capture failed:', err.message || String(err));
    if (isChartDexDebug()) await runDexChartDebugOnFailure(page, `exception: ${err.message || String(err)}`);
    return null;
  } finally {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
  }
}

/**
 * Close shared browser (e.g. tests / graceful shutdown).
 * @returns {Promise<void>}
 */
async function closeDexChartBrowser() {
  if (!sharedBrowser) return;
  try {
    try {
      const tv = require('./tokenChartTradingView');
      if (tv && typeof tv.resetGeckoChartReuseSession === 'function') {
        await tv.resetGeckoChartReuseSession();
      }
    } catch {
      /* avoid blocking browser close if TV module unload/order issues */
    }
    await sharedBrowser.close();
  } finally {
    sharedBrowser = null;
  }
}

module.exports = {
  fetchDexScreenerChartPng,
  closeDexChartBrowser,
  getChartPlaywrightBrowser: getSharedBrowser,
  resolveSolanaContract,
  dexScreenerTokenUrl,
  numEnv,
  waitForAnyFrameCanvas,
  rankFramesByChartCanvasSignal,
  dismissOptionalOverlays,
  trySelectShortInterval,
  trySelectCandles,
  findCanvasParentFallbackWrapperHandle,
  CANVAS_WAIT_MIN_AREA,
  CANVAS_FALLBACK_MIN_AREA
};
