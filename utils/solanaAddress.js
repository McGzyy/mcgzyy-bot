function extractFirstSolanaCaFromText(text) {
  const match = String(text || '').match(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/);
  return match ? match[0] : null;
}

function isLikelySolanaCA(input = '') {
  const clean = String(input || '').trim();
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(clean);
}

module.exports = {
  extractFirstSolanaCaFromText,
  isLikelySolanaCA
};

