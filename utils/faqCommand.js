'use strict';

const { getHelpTopics } = require('./helpMatcher');
const { collectFaqImageAttachments } = require('./helpMedia');
const { recordFaqOpened } = require('./helpAnalytics');

const DM_LIMIT = 2000;

const DM_BLOCKED_REPLY =
  "I couldn't DM you. Please enable DMs and try again.";

const NO_FAQ_FALLBACK =
  'There aren’t any FAQ entries yet. Use **`!help`** for guided help, or ask a mod.';

/**
 * @param {object[]|null|undefined} topics
 * @returns {object[]}
 */
function filterFaqTopics(topics) {
  if (!Array.isArray(topics)) return [];
  return topics.filter((t) => t && t.faq === true);
}

/**
 * Prefer `faqSummary` from JSON; otherwise first block of `content`, trimmed (no hardcoded FAQ facts).
 * @param {object} topic
 * @returns {string}
 */
function pickShortContent(topic) {
  if (typeof topic.faqSummary === 'string' && topic.faqSummary.trim()) {
    return topic.faqSummary.trim();
  }
  const raw = String(topic.content || '').trim();
  if (!raw) return '';
  const firstBlock = raw.split(/\n\n+/)[0] || raw;
  if (firstBlock.length <= 500) return firstBlock;
  return `${firstBlock.slice(0, 497).trimEnd()}…`;
}

/**
 * @param {object} topic
 * @returns {string}
 */
function formatFaqEntry(topic) {
  const title = String(topic.title || '').trim() || 'Topic';
  const short = pickShortContent(topic);
  let block = `**${title}**\n${short}`;
  const rel = topic.relatedCommands;
  if (Array.isArray(rel) && rel.length) {
    block += `\n**Related commands:** ${rel.map((c) => `\`${c}\``).join(', ')}`;
  }
  return block;
}

/**
 * @param {object[]} faqTopics
 * @returns {string|null}
 */
function buildFaqBody(faqTopics) {
  if (!faqTopics.length) return null;
  return faqTopics.map((t) => formatFaqEntry(t)).join('\n\n—\n\n');
}

/**
 * @param {import('discord.js').Message} message
 * @param {(content: string, limit?: number) => string[]} splitDiscordMessage
 */
async function handleFaqCommand(message, splitDiscordMessage) {
  recordFaqOpened();

  const topics = getHelpTopics();
  const faqTopics = filterFaqTopics(topics);

  const sendFallback = async () => {
    try {
      await message.author.send({
        content: NO_FAQ_FALLBACK,
        allowedMentions: { parse: [] }
      });
    } catch (_e) {
      await message.reply({
        content: DM_BLOCKED_REPLY,
        allowedMentions: { repliedUser: false }
      });
    }
  };

  if (!faqTopics.length) {
    await sendFallback();
    return;
  }

  const body = buildFaqBody(faqTopics);
  if (!body || !body.trim()) {
    await sendFallback();
    return;
  }

  const chunks = splitDiscordMessage(body, DM_LIMIT).filter((c) =>
    String(c || '').trim().length
  );

  const faqImages = collectFaqImageAttachments(faqTopics);

  try {
    for (let i = 0; i < chunks.length; i++) {
      const payload = {
        content: chunks[i],
        allowedMentions: { parse: [] }
      };
      if (i === 0 && faqImages.length) {
        payload.files = faqImages;
      }
      await message.author.send(payload);
    }
  } catch (_err) {
    await message.reply({
      content: DM_BLOCKED_REPLY,
      allowedMentions: { repliedUser: false }
    });
  }
}

module.exports = {
  handleFaqCommand,
  filterFaqTopics,
  pickShortContent
};
