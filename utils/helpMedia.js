'use strict';

const fs = require('fs');
const path = require('path');
const { AttachmentBuilder } = require('discord.js');

const PROJECT_ROOT = path.join(__dirname, '..');

const MAX_FILES_PER_MESSAGE = 10;

/**
 * Resolve `topic.image` to local file paths (project-relative or absolute).
 * Returns AttachmentBuilder instances for Discord uploads (not embed URLs).
 *
 * @param {object} topic
 * @returns {import('discord.js').AttachmentBuilder[]}
 */
function getHelpTopicImageFiles(topic) {
  const raw = topic?.image;
  if (typeof raw !== 'string' || !raw.trim()) return [];

  const trimmed = raw.trim();
  const full = path.isAbsolute(trimmed)
    ? path.normalize(trimmed)
    : path.join(PROJECT_ROOT, trimmed.replace(/^[\\/]+/, ''));

  try {
    if (!fs.existsSync(full)) {
      console.error('[HelpMedia] Image not found:', full);
      return [];
    }
    const stat = fs.statSync(full);
    if (!stat.isFile()) {
      console.error('[HelpMedia] Image path is not a file:', full);
      return [];
    }
    return [new AttachmentBuilder(full)];
  } catch (err) {
    console.error('[HelpMedia] Failed to attach image:', full, err?.message || err);
    return [];
  }
}

/**
 * FAQ: collect up to Discord’s per-message attachment limit, in topic order.
 *
 * @param {object[]} faqTopics
 * @returns {import('discord.js').AttachmentBuilder[]}
 */
function collectFaqImageAttachments(faqTopics) {
  const out = [];
  if (!Array.isArray(faqTopics)) return out;

  for (const t of faqTopics) {
    if (out.length >= MAX_FILES_PER_MESSAGE) break;
    for (const att of getHelpTopicImageFiles(t)) {
      if (out.length >= MAX_FILES_PER_MESSAGE) break;
      out.push(att);
    }
  }

  return out;
}

module.exports = {
  getHelpTopicImageFiles,
  collectFaqImageAttachments,
  MAX_FILES_PER_MESSAGE
};
