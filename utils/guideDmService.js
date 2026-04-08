const fs = require('fs');
const path = require('path');

const DOCS_DIR = path.join(__dirname, '../docs');

/** Only these basenames may be read (no path traversal). */
const ALLOWED_GUIDE_FILES = new Set(['user.md', 'mod.md', 'admin.md', 'beginner.md', 'explanation.md']);

/**
 * @param {string} filename — basename only, e.g. 'user.md'
 * @returns {{ ok: true, text: string } | { ok: false, reason: string }}
 */
function readGuideFile(filename) {
  const base = path.basename(String(filename || ''));
  if (!ALLOWED_GUIDE_FILES.has(base)) {
    return { ok: false, reason: 'invalid_guide' };
  }
  const fullPath = path.join(DOCS_DIR, base);
  try {
    const text = fs.readFileSync(fullPath, 'utf8');
    return { ok: true, text };
  } catch (e) {
    return { ok: false, reason: 'read_failed' };
  }
}

/**
 * Split markdown into Discord DM-safe chunks (content max 2000; use margin).
 * Prefers breaks at paragraph boundaries (\n\n), then single newlines, then hard split.
 * @param {string} text
 * @param {number} [maxLen=1900]
 * @returns {string[]}
 */
function chunkGuideForDm(text, maxLen = 1900) {
  const s = String(text || '');
  if (!s) return [''];

  const chunks = [];
  let remaining = s;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    let slice = remaining.slice(0, maxLen);
    let cut = slice.lastIndexOf('\n\n');
    if (cut < maxLen * 0.4) {
      cut = slice.lastIndexOf('\n');
    }
    if (cut < maxLen * 0.4) {
      cut = maxLen;
    }
    if (cut < 1) {
      cut = maxLen;
    }

    const part = remaining.slice(0, cut).replace(/\s+$/, '');
    chunks.push(part || remaining.slice(0, maxLen));
    remaining = remaining.slice(cut === maxLen ? maxLen : cut).replace(/^\s+/, '');
  }

  return chunks;
}

module.exports = {
  readGuideFile,
  chunkGuideForDm,
  ALLOWED_GUIDE_FILES
};
