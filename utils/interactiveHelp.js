'use strict';

const {
  matchHelpTopic,
  getHelpTopics,
  getClosestHelpTopics
} = require('./helpMatcher');
const { buildHelpCategoryUi } = require('./helpUi');

const LOW_CONFIDENCE_REPLY =
  "I'm not sure what you need help with. Try rephrasing, or ask @Mods.";

const DM_CHUNK_LIMIT = 2000;

const DM_BLOCKED_REPLY =
  "I couldn't DM you. Please enable DMs and try again.";

const BARE_HELP_DM_ACK = 'I’ve sent you help in DMs 📩';

function parseHelpQuery(content) {
  const trimmed = String(content || '').trim();
  const m = trimmed.match(/^!help\s*(.*)$/i);
  return m ? String(m[1] || '').trim() : '';
}

const NO_MATCH_SUGGEST_HEADER = "I couldn't find an exact match. Did you mean:";

/**
 * @param {string} query
 * @returns {string}
 */
function buildNoMatchReply(query) {
  const closest = getClosestHelpTopics(query, 3);
  if (closest.length) {
    const bullets = closest
      .map((t) => `• ${String(t.title || '').trim()}`)
      .filter(Boolean)
      .join('\n');
    return `${NO_MATCH_SUGGEST_HEADER}\n\n${bullets}\n\n${LOW_CONFIDENCE_REPLY}`;
  }
  return LOW_CONFIDENCE_REPLY;
}

/**
 * @param {{ title?: string, content?: string, relatedCommands?: string[] }} topic
 */
function formatMatchedTopicMessage(topic) {
  const title = String(topic.title || 'Help').trim();
  let body = String(topic.content || '').trim();
  const rel = topic.relatedCommands;
  let out = `**${title}**\n\n${body}`;
  if (Array.isArray(rel) && rel.length) {
    out += `\n\n**Related commands:** ${rel.map((c) => `\`${c}\``).join(', ')}`;
  }
  return out.trim();
}

/**
 * Send all chunks via DM only. Returns false if any send fails (no channel fallback).
 *
 * @param {import('discord.js').Message} message
 * @param {string} text
 * @param {(content: string, limit?: number) => string[]} splitDiscordMessage
 * @returns {Promise<boolean>}
 */
async function deliverHelpDmOnly(message, text, splitDiscordMessage) {
  const chunks = splitDiscordMessage(text, DM_CHUNK_LIMIT).filter((c) =>
    String(c || '').trim().length
  );
  if (!chunks.length) return true;

  for (let i = 0; i < chunks.length; i++) {
    try {
      await message.author.send({
        content: chunks[i],
        allowedMentions: { parse: [] }
      });
    } catch (_err) {
      return false;
    }
  }

  return true;
}

/**
 * @param {import('discord.js').Message} message
 * @param {string} content raw message content
 * @param {{ splitDiscordMessage: (content: string, limit?: number) => string[] }} deps
 */
async function handleInteractiveHelp(message, content, deps) {
  const { splitDiscordMessage } = deps;
  const query = parseHelpQuery(content);

  if (!query) {
    await message.reply({
      content: BARE_HELP_DM_ACK,
      allowedMentions: { repliedUser: false }
    });
    try {
      const topics = getHelpTopics();
      if (!topics || !topics.length) {
        const ok = await deliverHelpDmOnly(
          message,
          '❌ Help topics are not available right now.',
          splitDiscordMessage
        );
        if (!ok) {
          await message.reply({
            content: DM_BLOCKED_REPLY,
            allowedMentions: { repliedUser: false }
          });
        }
        return;
      }
      const { embeds, components } = buildHelpCategoryUi(topics);
      await message.author.send({
        embeds,
        components,
        allowedMentions: { parse: [] }
      });
    } catch (_err) {
      await message.reply({
        content: DM_BLOCKED_REPLY,
        allowedMentions: { repliedUser: false }
      });
    }
    return;
  }

  const topic = matchHelpTopic(query);
  if (!topic) {
    const body = buildNoMatchReply(query);
    const ok = await deliverHelpDmOnly(message, body, splitDiscordMessage);
    if (!ok) {
      await message.reply({
        content: DM_BLOCKED_REPLY,
        allowedMentions: { repliedUser: false }
      });
    }
    return;
  }

  const response = formatMatchedTopicMessage(topic);
  const matchedOk = await deliverHelpDmOnly(message, response, splitDiscordMessage);
  if (!matchedOk) {
    await message.reply({
      content: DM_BLOCKED_REPLY,
      allowedMentions: { repliedUser: false }
    });
  }
}

module.exports = {
  handleInteractiveHelp,
  parseHelpQuery,
  LOW_CONFIDENCE_REPLY
};
