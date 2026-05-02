'use strict';

let botFallbackThumbnailUrl = null;

/**
 * @param {string | null | undefined} url
 */
function setBotEmbedThumbnailFallbackUrl(url) {
  botFallbackThumbnailUrl =
    typeof url === 'string' && url.trim() ? url.trim() : null;
}

function getBotEmbedThumbnailFallbackUrl() {
  return botFallbackThumbnailUrl;
}

/**
 * @param {unknown} v
 * @returns {string}
 */
function safeTrimmedUrl(v) {
  if (v == null) return '';
  if (typeof v === 'string') {
    const t = v.trim();
    return t;
  }
  const s = String(v).trim();
  return s || '';
}

/**
 * @param {...unknown} candidates
 * @returns {string}
 */
function pickNonEmptyUrl(...candidates) {
  for (const c of candidates) {
    const t = safeTrimmedUrl(c);
    if (t) return t;
  }
  return '';
}

/**
 * Discord thumbnails require https; `ipfs://` and plain `http://` often fail to load.
 * @param {string} raw
 * @returns {string}
 */
function discordSafeImageUrl(raw) {
  let u = safeTrimmedUrl(raw);
  if (!u) return '';
  if (/^ipfs:\/\//i.test(u)) {
    const rest = u.slice(7).replace(/^ipfs\//i, '');
    u = `https://cloudflare-ipfs.com/ipfs/${rest}`;
  } else if (u.startsWith('http://')) {
    u = `https://${u.slice('http://'.length)}`;
  }
  return u;
}

/**
 * Public CDN icon when Dex/Gecko omit `imageUrl` (common on fresh pump pairs).
 * @param {string} contractAddress
 * @returns {string}
 */
function dexScreenerSolTokenIconUrl(contractAddress) {
  const ca = String(contractAddress || '').trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,48}$/.test(ca)) return '';
  return `https://dd.dexscreener.com/ds-data/tokens/solana/${ca}.png`;
}

/**
 * DexScreener image first, then GeckoTerminal token metadata, then Dex CDN by mint,
 * then bot avatar (if set).
 * @param {unknown} scan
 * @returns {string}
 */
function resolveScanThumbnailUrl(scan) {
  const s = scan && typeof scan === 'object' ? /** @type {Record<string, unknown>} */ (scan) : null;
  const token = s?.token;
  const t =
    token && typeof token === 'object'
      ? /** @type {{ imageUrl?: unknown, geckoImageUrl?: unknown }} */ (token)
      : null;
  const ca = s ? String(s.contractAddress || s.ca || '').trim() : '';
  const picked = pickNonEmptyUrl(
    t?.imageUrl,
    t?.geckoImageUrl,
    s?.tokenImageUrl,
    s?.geckoTokenImageUrl,
    ca ? dexScreenerSolTokenIconUrl(ca) : '',
    getBotEmbedThumbnailFallbackUrl()
  );
  const safe = discordSafeImageUrl(picked);
  return safe || picked;
}

/**
 * @param {import('discord.js').EmbedBuilder} embed
 * @param {unknown} scan
 */
function applyScanThumbnailToEmbed(embed, scan) {
  if (!embed || typeof embed.setThumbnail !== 'function') return;
  const url = resolveScanThumbnailUrl(scan);
  if (!url) return;
  try {
    embed.setThumbnail(url);
  } catch (_) {
    /* invalid URL — omit thumbnail */
  }
}

module.exports = {
  setBotEmbedThumbnailFallbackUrl,
  getBotEmbedThumbnailFallbackUrl,
  dexScreenerSolTokenIconUrl,
  discordSafeImageUrl,
  resolveScanThumbnailUrl,
  applyScanThumbnailToEmbed
};
