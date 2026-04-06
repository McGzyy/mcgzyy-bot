/**
 * Trader / call alert embed layout (A / B / C). Override with env for quick A/B testing.
 * B — hero title + MC on first embed, chart high, details on second (default).
 * A — chart-first embed, then title / MC / details.
 * C — chart-first embed, then compact header line + details.
 */
function getAlertEmbedLayoutMode() {
  const raw = String(process.env.ALERT_EMBED_LAYOUT || 'B').trim().toUpperCase();
  if (raw === 'A' || raw === 'C') return raw;
  return 'B';
}

module.exports = {
  getAlertEmbedLayoutMode
};
