/**
 * Token chart images for X milestones (and future Discord attachments).
 *
 * Strategy (v1): QuickChart.io — server-rendered Chart.js PNG via POST (no URL length issues).
 * Designed for later: swap spec builder to add call/milestone markers, watermark, or Playwright screenshots.
 *
 * Env: X_MILESTONE_CHART_ENABLED=1|true|yes — fetch chart when posting milestones (callers gate).
 */

const axios = require('axios');

const QUICKCHART_POST_URL = 'https://quickchart.io/chart';

function truthyEnv(name) {
  return /^1|true|yes$/i.test(String(process.env[name] || '').trim());
}

function isMilestoneChartAttachmentEnabled() {
  return truthyEnv('X_MILESTONE_CHART_ENABLED');
}

function shortTitle(trackedCall) {
  const name = String(trackedCall?.tokenName || '').trim() || 'Token';
  const tick = String(trackedCall?.ticker || '').trim().replace(/^\$+/, '');
  const tickShow = tick ? `$${tick}` : '';
  const combined = tickShow && !name.toLowerCase().includes(tick.toLowerCase()) ? `${name} (${tickShow})` : name;
  return combined.length > 48 ? `${combined.slice(0, 45)}…` : combined;
}

/**
 * Chart.js config for QuickChart — keep simple; extend for markers / branding later.
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
 * @returns {Promise<Buffer|null>} PNG bytes, or null on failure / disabled chart types.
 */
async function fetchTokenChartImageBuffer(trackedCall) {
  const spec = buildQuickChartSpec(trackedCall);
  if (!spec) return null;

  try {
    const w = Number(process.env.X_CHART_WIDTH || 720);
    const h = Number(process.env.X_CHART_HEIGHT || 380);
    const res = await axios.post(
      QUICKCHART_POST_URL,
      {
        chart: spec,
        format: 'png',
        width: Number.isFinite(w) && w >= 320 && w <= 2000 ? Math.floor(w) : 720,
        height: Number.isFinite(h) && h >= 240 && h <= 2000 ? Math.floor(h) : 380,
        backgroundColor: '#ffffff',
        devicePixelRatio: 2
      },
      {
        responseType: 'arraybuffer',
        timeout: 25000,
        maxContentLength: 6 * 1024 * 1024,
        validateStatus: s => s === 200
      }
    );

    const buf = Buffer.isBuffer(res.data) ? res.data : Buffer.from(res.data || []);
    if (buf.length < 24) return null;
    const sig = buf.subarray(0, 8).toString('hex');
    if (sig !== '89504e470d0a1a0a') {
      console.warn('[TokenChartImage] Response was not PNG');
      return null;
    }
    return buf;
  } catch (err) {
    console.warn('[TokenChartImage] QuickChart request failed:', err.message);
    return null;
  }
}

module.exports = {
  isMilestoneChartAttachmentEnabled,
  buildQuickChartSpec,
  fetchTokenChartImageBuffer,
  QUICKCHART_POST_URL
};
