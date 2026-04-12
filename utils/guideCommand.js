'use strict';

const fs = require('fs');
const path = require('path');

const DOCS_DIR = path.join(__dirname, '..', 'docs');
const DISCORD_DM_CHAR_LIMIT = 2000;

const DM_BLOCKED_REPLY =
  "I couldn't DM you. Please enable DMs and try again.";

/**
 * Member used for Manage Guild checks: guild messages use `message.member`;
 * in DMs, resolve via `DISCORD_GUILD_ID` + `guild.members.fetch(author.id)`.
 * On any failure, returns null (regular-user guide set).
 *
 * @param {import('discord.js').Message} message
 * @returns {Promise<import('discord.js').GuildMember | null>}
 */
async function resolveMemberForGuidePermissions(message) {
  if (message.guild) {
    return message.member ?? null;
  }

  const guildId = String(process.env.DISCORD_GUILD_ID ?? '').trim();
  if (!guildId || !message.client) return null;

  try {
    const guild = await message.client.guilds.fetch(guildId);
    return await guild.members.fetch(message.author.id);
  } catch {
    return null;
  }
}

/**
 * Resolve which markdown guides to send for this caller.
 * Precedence: bot owner → admin only; else Manage Server → user + mod; else beginner + user.
 *
 * @param {import('discord.js').GuildMember | null} member
 * @param {import('discord.js').User} author
 * @param {{ memberCanManageGuild: (m: import('discord.js').GuildMember | null) => boolean, isBotOwner: (u: import('discord.js').User) => boolean }} permissions
 * @returns {string[]}
 */
function resolveGuideFilenames(member, author, { memberCanManageGuild, isBotOwner }) {
  if (isBotOwner(author)) return ['admin.md'];
  if (memberCanManageGuild(member)) return ['user.md', 'mod.md'];
  return ['beginner.md', 'user.md'];
}

function loadAndJoinGuides(filenames) {
  const parts = [];
  for (const name of filenames) {
    const full = path.join(DOCS_DIR, name);
    if (!fs.existsSync(full)) {
      throw new Error(`Missing docs/${name}`);
    }
    const text = fs.readFileSync(full, 'utf8');
    parts.push(String(text).trimEnd());
  }
  return parts.join('\n\n---\n\n');
}

/**
 * DM guide markdown to the author, split for Discord limits.
 * On DM failure, replies in the channel with a short prompt (guides are never posted in-channel).
 *
 * @param {import('discord.js').Message} message
 * @param {{ memberCanManageGuild: Function, isBotOwner: Function, splitDiscordMessage: (content: string, limit?: number) => string[] }} deps
 */
async function handleGuideCommand(message, deps) {
  const { memberCanManageGuild, isBotOwner, splitDiscordMessage } = deps;
  const member = await resolveMemberForGuidePermissions(message);
  const filenames = resolveGuideFilenames(member, message.author, {
    memberCanManageGuild,
    isBotOwner
  });

  let combined;
  try {
    combined = loadAndJoinGuides(filenames);
  } catch (err) {
    await message.reply({
      content: `❌ Could not load guides: ${err.message}`,
      allowedMentions: { repliedUser: false }
    });
    return;
  }

  const chunks = splitDiscordMessage(combined, DISCORD_DM_CHAR_LIMIT).filter(
    c => String(c || '').length > 0
  );

  if (!chunks.length) {
    await message.reply({
      content: '❌ No guide content to send.',
      allowedMentions: { repliedUser: false }
    });
    return;
  }

  try {
    for (let i = 0; i < chunks.length; i++) {
      await message.author.send({
        content: chunks[i],
        allowedMentions: { parse: [] }
      });
    }
  } catch (_err) {
    await message.reply({
      content: DM_BLOCKED_REPLY,
      allowedMentions: { repliedUser: false }
    });
  }
}

module.exports = { handleGuideCommand };
