'use strict';

const { EmbedBuilder } = require('discord.js');

/** Cobalt accent — matches dashboard alert branding. */
const EMBED_COLOR = 0x4b8bf4;

function truncate(s, max) {
  const t = String(s || '').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * Send a dashboard alert to a user's Discord DMs.
 *
 * @param {import('discord.js').Client} client
 * @param {{ userId: string, title: string, body: string }} input
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function sendDashboardAlertDm(client, input) {
  const userId = String(input?.userId || '').trim();
  const title = truncate(input?.title, 256);
  const body = truncate(input?.body, 3900);
  if (!userId || !title) {
    return { success: false, error: 'Missing userId or title' };
  }
  if (!client || !client.isReady()) {
    return { success: false, error: 'Discord client is not ready' };
  }

  try {
    const user = await client.users.fetch(userId);
    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle(title)
      .setDescription(body || '—')
      .setFooter({ text: 'McGBot · Dashboard alert' })
      .setTimestamp();

    await user.send({ embeds: [embed] });
    return { success: true };
  } catch (e) {
    const msg = e && e.message ? String(e.message) : 'DM failed';
    return { success: false, error: msg };
  }
}

module.exports = { sendDashboardAlertDm };
