'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  AttachmentBuilder
} = require('discord.js');

const { buildOhlcvCandlestickBufferForTrackedCall } = require('./ohlcvCandlestickBuffer');
const { getTrackedCall } = require('./trackedCallsService');

const PREFIX = 'ohlcv_tf';

const BUTTON_ORDER = ['1m', '5m', '15m', '1h', '4h', '1d'];

/**
 * @param {string} customId
 * @returns {{ contractAddress: string, interval: string } | null}
 */
function parseOhlcvTimeframeCustomId(customId) {
  if (!customId || typeof customId !== 'string' || !customId.startsWith(`${PREFIX}:`)) {
    return null;
  }
  const rest = customId.slice(PREFIX.length + 1);
  const lastColon = rest.lastIndexOf(':');
  if (lastColon <= 0) return null;
  const contractAddress = rest.slice(0, lastColon);
  const interval = rest.slice(lastColon + 1);
  if (!contractAddress || !interval) return null;
  if (!BUTTON_ORDER.includes(interval)) return null;
  return { contractAddress, interval };
}

/**
 * @param {string} contractAddress
 * @param {string} [activeInterval='5m']
 * @returns {import('discord.js').ActionRowBuilder<import('discord.js').ButtonBuilder>[]}
 */
function buildOhlcvTimeframeRows(contractAddress, activeInterval = '5m') {
  const ca = String(contractAddress || '').trim();
  if (!ca) return [];

  const active = BUTTON_ORDER.includes(activeInterval) ? activeInterval : '5m';

  const makeBtn = (tf) =>
    new ButtonBuilder()
      .setCustomId(`${PREFIX}:${ca}:${tf}`)
      .setLabel(tf)
      .setStyle(tf === active ? ButtonStyle.Primary : ButtonStyle.Secondary);

  const row1 = new ActionRowBuilder().addComponents(
    BUTTON_ORDER.slice(0, 5).map(makeBtn)
  );
  const row2 = new ActionRowBuilder().addComponents(
    BUTTON_ORDER.slice(5).map(makeBtn)
  );
  return [row1, row2];
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @returns {Promise<boolean>} true if this handler owned the interaction (matched prefix)
 */
async function handleOhlcvTimeframeButton(interaction) {
  const parsed = parseOhlcvTimeframeCustomId(interaction.customId || '');
  if (!parsed) return false;

  try {
    await interaction.deferUpdate();
  } catch (_e) {
    return true;
  }

  try {
    const tracked = getTrackedCall(parsed.contractAddress);
    const buf = await buildOhlcvCandlestickBufferForTrackedCall(
      tracked,
      null,
      { interval: parsed.interval }
    );

    if (!buf || !Buffer.isBuffer(buf) || buf.length < 100) {
      return true;
    }

    const message = interaction.message;
    if (!message || typeof message.edit !== 'function') {
      return true;
    }

    const embeds = message.embeds.map((emb) => {
      const json = emb.toJSON();
      const url = json.image?.url || '';
      if (url.startsWith('attachment://chart')) {
        json.image = { url: 'attachment://chart.png' };
      }
      return EmbedBuilder.from(json);
    });

    const file = new AttachmentBuilder(buf, { name: 'chart.png' });
    const components = buildOhlcvTimeframeRows(
      parsed.contractAddress,
      parsed.interval
    );

    await message.edit({
      embeds,
      files: [file],
      components
    });
  } catch (err) {
    console.error('[ohlcvChartControls]', err?.message || err);
  }

  return true;
}

module.exports = {
  buildOhlcvTimeframeRows,
  parseOhlcvTimeframeCustomId,
  handleOhlcvTimeframeButton,
  OHLCV_TIMEFRAME_IDS: [...BUTTON_ORDER]
};
