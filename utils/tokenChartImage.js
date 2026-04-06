/**

 * Token chart images for Discord new-call attachments and X milestone posts.

 *

 * Providers (Playwright screenshots):

 *   - GMGN (primary when CHART_PROVIDER=auto or gmgn) — gmgn.ai/sol/token/{CA}

 *   - GeckoTerminal pool chart (CHART_PROVIDER=tv) — geckoterminal.com/.../pools/{pool}; fails → Dex

 *   - DexScreener (fallback when auto or after tv, or sole when CHART_PROVIDER=dex)

 *

 * Env (gating — unchanged):

 *   X_MILESTONE_CHART_ENABLED=1|true|yes — callers enable chart fetch for milestones / new calls.

 *

 * Env (provider):

 *   CHART_PROVIDER=auto|gmgn|dex|tv — default auto: GMGN then Dex (unchanged). tv = Gecko pool chart then Dex if null.

 *

 * Env (GMGN — optional, see tokenChartGmgn.js):

 *   CHART_GMGN_* and shared X_CHART_WIDTH / X_CHART_HEIGHT

 *   CHART_GMGN_DEBUG=1 — on GMGN capture failure: debug/gmgn-*.png + gmgn-dom.html (also if CHART_DEX_DEBUG=1)

 *

 * Env (TV / Gecko chart — optional, see tokenChartTradingView.js):

 *   CHART_TV_* (NETWORK, INTERVAL_ORDER, STABILIZE_MS, DEBUG, …)

 *

 * Env (Dex — optional, see tokenChartDexscreener.js):

 *   CHART_DEX_* (interval order, ZOOM_IN/OUT_STEPS, STABILIZE_*, FALLBACK_PARENT_DEPTH, DEBUG, …)

 *

 * Legacy: buildQuickChartSpec retained for previews/tests (QuickChart bar spec — not used for attachments).

 */



const { fetchDexScreenerChartPng, resolveSolanaContract } = require('./tokenChartDexscreener');

const { fetchGmgnChartPng } = require('./tokenChartGmgn');

const { fetchTradingViewChartPng } = require('./tokenChartTradingView');



function truthyEnv(name) {

  return /^1|true|yes$/i.test(String(process.env[name] || '').trim());

}



function isMilestoneChartAttachmentEnabled() {

  return truthyEnv('X_MILESTONE_CHART_ENABLED');

}



function resolveChartProviderMode() {

  const raw = String(process.env.CHART_PROVIDER || 'auto').trim().toLowerCase() || 'auto';

  if (raw === 'gmgn' || raw === 'dex' || raw === 'tv') return raw;

  return 'auto';

}



function shortTitle(trackedCall) {

  const name = String(trackedCall?.tokenName || '').trim() || 'Token';

  const tick = String(trackedCall?.ticker || '').trim().replace(/^\$+/, '');

  const tickShow = tick ? `$${tick}` : '';

  const combined = tickShow && !name.toLowerCase().includes(tick.toLowerCase()) ? `${name} (${tickShow})` : name;

  return combined.length > 48 ? `${combined.slice(0, 45)}…` : combined;

}



/**

 * Chart.js config for QuickChart — legacy helper for tooling / previews (not used in fetchTokenChartImageBuffer).

 * @returns {object|null}

 */

function buildQuickChartSpec(trackedCall) {

  if (!trackedCall) return null;



  const callMc = Number(

    trackedCall.firstCalledMarketCap ?? trackedCall.marketCapAtCall ?? trackedCall.marketCap ?? 0

  );

  const ath = Number(

    trackedCall.ath ??

      trackedCall.athMc ??

      trackedCall.athMarketCap ??

      trackedCall.latestMarketCap ??

      0

  );



  if (!Number.isFinite(ath) || ath <= 0) return null;



  let labels;

  let data;

  if (Number.isFinite(callMc) && callMc > 0) {

    labels = ['At call', 'ATH'];

    data = [callMc, ath];

  } else {

    labels = ['ATH'];

    data = [ath];

  }



  return {

    type: 'bar',

    data: {

      labels,

      datasets: [

        {

          label: 'Market cap (USD)',

          data,

          backgroundColor: ['#94a3b8', '#0ea5e9'],

          borderRadius: 4,

          barPercentage: 0.65

        }

      ]

    },

    options: {

      plugins: {

        legend: { display: false },

        title: {

          display: true,

          text: shortTitle(trackedCall),

          color: '#0f172a',

          font: { size: 15, weight: '600' },

          padding: { bottom: 12, top: 4 }

        }

      },

      layout: { padding: { left: 8, right: 12, top: 4, bottom: 8 } },

      scales: {

        x: {

          grid: { display: false },

          ticks: { color: '#475569', font: { size: 12 } }

        },

        y: {

          beginAtZero: true,

          grid: { color: '#e2e8f0' },

          ticks: {

            color: '#64748b',

            font: { size: 11 },

            maxTicksLimit: 6

          }

        }

      }

    }

  };

}



/**

 * Whether a chart screenshot can be attempted (valid Solana contract on profile).

 * @param {object} trackedCall

 * @returns {boolean}

 */

function canAttemptDexChart(trackedCall) {

  return !!resolveSolanaContract(trackedCall);

}



/**

 * @returns {Promise<Buffer|null>} PNG bytes, or null on failure / missing contract.

 */

async function fetchTokenChartImageBuffer(trackedCall) {

  if (!resolveSolanaContract(trackedCall)) return null;



  const mode = resolveChartProviderMode();



  if (mode === 'dex') {

    const d = await fetchDexScreenerChartPng(trackedCall);

    if (d) console.info('[TokenChart] provider=dex');

    return d;

  }



  if (mode === 'gmgn') {

    const g = await fetchGmgnChartPng(trackedCall);

    if (g) console.info('[TokenChart] provider=gmgn');

    return g;

  }

  if (mode === 'tv') {

    const t = await fetchTradingViewChartPng(trackedCall);

    if (t) {

      console.info('[TokenChart] provider=tv (GeckoTerminal pool)');

      return t;

    }

    console.info('[TokenChart] tv failed, falling back to dex');

    const d = await fetchDexScreenerChartPng(trackedCall);

    if (d) console.info('[TokenChart] provider=dex (fallback after tv)');

    return d;

  }



  const g = await fetchGmgnChartPng(trackedCall);

  if (g) {

    console.info('[TokenChart] provider=gmgn');

    return g;

  }



  console.info('[TokenChart] gmgn failed, falling back to dex');

  const d = await fetchDexScreenerChartPng(trackedCall);

  if (d) console.info('[TokenChart] provider=dex (fallback)');

  return d;

}



const QUICKCHART_POST_URL = 'https://quickchart.io/chart';



module.exports = {

  isMilestoneChartAttachmentEnabled,

  buildQuickChartSpec,

  canAttemptDexChart,

  fetchTokenChartImageBuffer,

  QUICKCHART_POST_URL

};


