const PRO_CALL_LIMITS = {
  title: 80,
  why: 300,
  risk: 120
};

function sanitizeProField(value, maxLen) {
  let s = String(value || '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!s) return '';

  // Neutralize @mentions + strip URLs (avoid pinging or link spam in Discord).
  s = s.replace(/@\w+/g, '[mention]');
  s = s.replace(/https?:\/\/\S+/gi, '').replace(/\s+/g, ' ').trim();

  if (!s) return '';

  if (s.length > maxLen) {
    s = `${s.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
  }

  return s;
}

function parseProCallFields(tweetText) {
  const lines = String(tweetText || '').split(/\r?\n/);
  let title = '';
  let why = '';
  let risk = '';

  for (const raw of lines) {
    const line = String(raw || '').trim();
    if (!line) continue;

    const t = line.match(/^title\s*:\s*(.+)$/i);
    if (t && !title) {
      title = t[1];
      continue;
    }

    const w = line.match(/^why\s*:\s*(.+)$/i);
    if (w && !why) {
      why = w[1];
      continue;
    }

    const r = line.match(/^risk\s*:\s*(.+)$/i);
    if (r && !risk) {
      risk = r[1];
      continue;
    }
  }

  return {
    title: sanitizeProField(title, PRO_CALL_LIMITS.title),
    why: sanitizeProField(why, PRO_CALL_LIMITS.why),
    risk: sanitizeProField(risk, PRO_CALL_LIMITS.risk)
  };
}

function parseProCallCommandArgs(raw) {
  const text = String(raw || '').trim();
  if (!text) return { ca: '', title: '', why: '', risk: '' };

  const parts = text.split('|').map(s => String(s || '').trim());
  const ca = parts[0] || '';

  return {
    ca,
    title: sanitizeProField(parts[1] || '', PRO_CALL_LIMITS.title),
    why: sanitizeProField(parts[2] || '', PRO_CALL_LIMITS.why),
    risk: sanitizeProField(parts[3] || '', PRO_CALL_LIMITS.risk)
  };
}

module.exports = {
  PRO_CALL_LIMITS,
  sanitizeProField,
  parseProCallFields,
  parseProCallCommandArgs
};

