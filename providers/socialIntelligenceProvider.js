async function fetchSocialIntelligence(contractAddress, tokenName = '', ticker = '') {
  try {
    const cleanName = String(tokenName || '').trim();
    const cleanTicker = String(ticker || '').trim();
    const combined = `${cleanName} ${cleanTicker}`.toLowerCase();

    let xMentions = null;
    let tickerMentions = null;
    let hashtagMentions = null;
    let viralityScore = 10;
    let socialStrength = 'Low';
    let narrativeStrength = 'Weak';
    let socialTrend = 'Flat';
    let aiNarrativeSummary = null;

    const hasTicker = cleanTicker.length >= 2;
    const hasName = cleanName.length >= 3;

    if (!hasTicker && !hasName) {
      return {
        xMentions: null,
        tickerMentions: null,
        hashtagMentions: null,
        socialStrength: 'Unknown',
        viralityScore: null,
        narrativeStrength: 'Unknown',
        socialTrend: 'Unknown',
        aiNarrativeSummary: null,
        source: 'heuristic'
      };
    }

    // ----------------------------
    // MEME / NARRATIVE SIGNALS
    // ----------------------------
    const strongMemeWords = [
      'ai', 'dog', 'cat', 'pepe', 'frog', 'trump', 'elon',
      'moon', 'pump', 'cult', 'baby', 'king', 'queen',
      'sol', 'bonk', 'wojak', 'giga', 'sigma', 'rizz',
      'chad', 'based', 'degen', 'ape', 'send', 'moonshot'
    ];

    const weakMemeWords = [
      'coin', 'token', 'inu', 'labs', 'finance', 'cash',
      'swap', 'chain', 'club', 'army', 'verse', 'world'
    ];

    const narrativeWords = [
      'ai', 'politic', 'president', 'trump', 'elon', 'cult',
      'community', 'frog', 'dog', 'cat', 'sol', 'moon',
      'pump', 'based', 'ape', 'degen', 'rizz'
    ];

    const strongHits = strongMemeWords.filter(word => combined.includes(word)).length;
    const weakHits = weakMemeWords.filter(word => combined.includes(word)).length;
    const narrativeHits = narrativeWords.filter(word => combined.includes(word)).length;

    // ----------------------------
    // TICKER QUALITY SIGNALS
    // ----------------------------
    let tickerQualityScore = 0;

    if (cleanTicker.length >= 3 && cleanTicker.length <= 5) tickerQualityScore += 12;
    else if (cleanTicker.length >= 2 && cleanTicker.length <= 6) tickerQualityScore += 8;
    else tickerQualityScore += 2;

    if (/^[A-Z0-9]+$/.test(cleanTicker)) tickerQualityScore += 8;
    if (!/\s/.test(cleanTicker)) tickerQualityScore += 5;

    // penalize ugly / weak ticker structure
    if (cleanTicker.length > 7) tickerQualityScore -= 6;
    if (/[^a-zA-Z0-9]/.test(cleanTicker)) tickerQualityScore -= 5;

    // ----------------------------
    // NAME QUALITY SIGNALS
    // ----------------------------
    let nameQualityScore = 0;

    if (cleanName.length >= 4 && cleanName.length <= 16) nameQualityScore += 10;
    else if (cleanName.length <= 24) nameQualityScore += 6;
    else nameQualityScore += 2;

    if (!/\d{3,}/.test(cleanName)) nameQualityScore += 4;
    if (!/[_\-]/.test(cleanName)) nameQualityScore += 3;

    // ----------------------------
    // VIRALITY SCORE
    // ----------------------------
    viralityScore =
      10 +
      (strongHits * 10) +
      (weakHits * 4) +
      (narrativeHits * 6) +
      tickerQualityScore +
      nameQualityScore;

    if (viralityScore > 100) viralityScore = 100;
    if (viralityScore < 0) viralityScore = 0;

    // ----------------------------
    // MENTION HEURISTICS
    // ----------------------------
    xMentions = Math.max(0, Math.floor(viralityScore / 12));
    tickerMentions = Math.max(0, Math.floor((viralityScore + tickerQualityScore) / 18));
    hashtagMentions = Math.max(0, Math.floor((viralityScore + strongHits * 8) / 25));

    // ----------------------------
    // LABELS
    // ----------------------------
    if (viralityScore >= 80) {
      socialStrength = 'High';
      socialTrend = 'Heating Up';
    } else if (viralityScore >= 55) {
      socialStrength = 'Moderate';
      socialTrend = 'Developing';
    } else {
      socialStrength = 'Low';
      socialTrend = 'Flat';
    }

    if (narrativeHits >= 3 || strongHits >= 3) {
      narrativeStrength = 'Strong';
    } else if (narrativeHits >= 1 || strongHits >= 1) {
      narrativeStrength = 'Developing';
    } else {
      narrativeStrength = 'Weak';
    }

    // ----------------------------
    // AI NARRATIVE SUMMARY
    // ----------------------------
    if (strongHits >= 2 && narrativeHits >= 2) {
      aiNarrativeSummary =
        `${cleanName} appears to have stronger meme-native branding and a more socially viable narrative shape than average early launches.`;
    } else if (strongHits >= 1 || narrativeHits >= 1) {
      aiNarrativeSummary =
        `${cleanName} shows some early meme / narrative potential, but would need stronger real-world attention to confirm traction.`;
    } else {
      aiNarrativeSummary =
        `${cleanName} currently looks weaker from a meme virality / narrative standpoint and may rely more on market action than social pull.`;
    }

    return {
      xMentions,
      tickerMentions,
      hashtagMentions,
      socialStrength,
      viralityScore,
      narrativeStrength,
      socialTrend,
      aiNarrativeSummary,
      source: 'heuristic-v2'
    };
  } catch (error) {
    console.error('[SocialIntelligenceProvider] Error:', error.message);

    return {
      xMentions: null,
      tickerMentions: null,
      hashtagMentions: null,
      socialStrength: 'Unknown',
      viralityScore: null,
      narrativeStrength: 'Unknown',
      socialTrend: 'Unknown',
      aiNarrativeSummary: null,
      source: 'error'
    };
  }
}

module.exports = { fetchSocialIntelligence };