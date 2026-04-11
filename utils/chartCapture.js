/**
 * GeckoTerminal static chart image (PNG) via HTTP fetch.
 */

const path = require('path');
const fs = require('fs').promises;

/**
 * @param {{ pairAddress?: string, contractAddress?: string }} params
 * @returns {Promise<Buffer|null>}
 */
async function fetchGeckoChart({ pairAddress, contractAddress } = {}) {
  const id = String(pairAddress || contractAddress || '').trim();
  if (!id) return null;

  const url = `https://www.geckoterminal.com/solana/pools/${id}/chart.png`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    return buffer;
  } catch (err) {
    console.error('[ChartCapture]', err.message);
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
    const buf = await fetchGeckoChart({ contractAddress, pairAddress });
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
  fetchGeckoChart,
  debugCapture
};
