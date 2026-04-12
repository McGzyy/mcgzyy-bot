'use strict';

const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const { getHelpTopics } = require('./helpMatcher');
const { getHelpTopicImageFiles } = require('./helpMedia');
const { recordHelpTopicClicked } = require('./helpAnalytics');

const SELECT_CATEGORY = 'help_ui_category';
const SELECT_TOPIC = 'help_ui_topic';
const BTN_BACK_CATS = 'help_ui_back_cats';
const BTN_TOPICS_PREFIX = 'help_ui_topics_';

const MAX_SELECT_OPTIONS = 25;
const MAX_EMBED_DESC = 4090;
const MAX_LABEL = 100;

function truncate(str, max) {
  const s = String(str ?? '');
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

function uniqueCategories(topics) {
  return [...new Set(topics.map((t) => t.category).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );
}

function topicsInCategory(topics, categoryName) {
  const out = [];
  topics.forEach((t, globalIdx) => {
    if (t && String(t.category || '') === categoryName) {
      out.push({ globalIdx, topic: t });
    }
  });
  return out;
}

function countTopicsInCategory(topics, categoryName) {
  return topicsInCategory(topics, categoryName).length;
}

/**
 * @param {object[]} topics
 */
function buildHelpCategoryUi(topics) {
  const categories = uniqueCategories(topics).slice(0, MAX_SELECT_OPTIONS);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('What do you need help with?')
    .setDescription(
      'Pick a **category** below. You can also use **`!help <question>`** in the server for a quick match.'
    );

  if (!categories.length) {
    embed.setDescription(
      'No help categories are configured. Use **`!help <question>`** in the server instead.'
    );
    return { embeds: [embed], components: [], files: [] };
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(SELECT_CATEGORY)
    .setPlaceholder('Select a category…')
    .addOptions(
      categories.map((cat, i) => {
        const n = countTopicsInCategory(topics, cat);
        return new StringSelectMenuOptionBuilder()
          .setLabel(truncate(cat, MAX_LABEL))
          .setDescription(truncate(`${n} topic${n === 1 ? '' : 's'}`, MAX_LABEL))
          .setValue(String(i));
      })
    );

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(menu)],
    files: []
  };
}

/**
 * @param {object[]} topics
 * @param {number} categoryIndex index into uniqueCategories(topics)
 */
function buildHelpTopicPickerUi(topics, categoryIndex) {
  const categories = uniqueCategories(topics);
  if (
    !Number.isFinite(categoryIndex) ||
    categoryIndex < 0 ||
    categoryIndex >= categories.length
  ) {
    return buildHelpCategoryUi(topics);
  }

  const cat = categories[categoryIndex];
  const rows = topicsInCategory(topics, cat).slice(0, MAX_SELECT_OPTIONS);
  if (!rows.length) {
    return buildHelpCategoryUi(topics);
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Choose a topic')
    .setDescription(`Category: **${truncate(cat, 200)}**`);

  const total = topicsInCategory(topics, cat).length;
  if (total > MAX_SELECT_OPTIONS) {
    embed.setFooter({ text: `Showing first ${MAX_SELECT_OPTIONS} of ${total} topics.` });
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(SELECT_TOPIC)
    .setPlaceholder('Select a topic…')
    .addOptions(
      rows.map(({ globalIdx, topic }) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(truncate(String(topic.title || 'Topic'), MAX_LABEL))
          .setValue(String(globalIdx))
      )
    );

  const back = new ButtonBuilder()
    .setCustomId(BTN_BACK_CATS)
    .setLabel('← Categories')
    .setStyle(ButtonStyle.Secondary);

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(menu),
      new ActionRowBuilder().addComponents(back)
    ],
    files: []
  };
}

/**
 * @param {object[]} topics
 * @param {number} globalTopicIndex index into topics array
 */
function buildHelpTopicAnswerUi(topics, globalTopicIndex) {
  if (
    !Number.isFinite(globalTopicIndex) ||
    globalTopicIndex < 0 ||
    globalTopicIndex >= topics.length
  ) {
    return buildHelpCategoryUi(topics);
  }

  const topic = topics[globalTopicIndex];
  if (!topic) {
    return buildHelpCategoryUi(topics);
  }

  const categories = uniqueCategories(topics);
  const catIdx = Math.max(0, categories.indexOf(topic.category));

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(truncate(String(topic.title || 'Help'), 256))
    .setDescription(truncate(String(topic.content || '').trim(), MAX_EMBED_DESC));

  const rel = topic.relatedCommands;
  if (Array.isArray(rel) && rel.length) {
    const line = rel.map((c) => `\`${c}\``).join(', ');
    embed.addFields({
      name: 'Related commands',
      value: truncate(line, 1024)
    });
  }

  const btnTopics = new ButtonBuilder()
    .setCustomId(`${BTN_TOPICS_PREFIX}${catIdx}`)
    .setLabel('More in this category')
    .setStyle(ButtonStyle.Secondary);

  const btnCats = new ButtonBuilder()
    .setCustomId(BTN_BACK_CATS)
    .setLabel('All categories')
    .setStyle(ButtonStyle.Primary);

  const imageFiles = getHelpTopicImageFiles(topic);

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(btnTopics, btnCats)],
    files: imageFiles.length ? imageFiles : []
  };
}

/**
 * @param {import('discord.js').StringSelectMenuInteraction | import('discord.js').ButtonInteraction} interaction
 * @returns {Promise<boolean>} true if handled
 */
async function handleHelpUiInteraction(interaction) {
  const id = interaction.customId;
  const isHelpSelect =
    interaction.isStringSelectMenu() &&
    (id === SELECT_CATEGORY || id === SELECT_TOPIC);
  const isHelpButton =
    interaction.isButton() && (id === BTN_BACK_CATS || id.startsWith(BTN_TOPICS_PREFIX));

  if (!isHelpSelect && !isHelpButton) return false;

  const topics = getHelpTopics();
  if (!topics || !topics.length) {
    await interaction.reply({
      content: '❌ Help topics are not available right now.',
      ephemeral: true
    });
    return true;
  }

  try {
    if (interaction.isStringSelectMenu() && id === SELECT_CATEGORY) {
      const idx = parseInt(interaction.values[0], 10);
      if (!Number.isFinite(idx) || idx < 0) {
        await interaction.update(buildHelpCategoryUi(topics));
        return true;
      }
      await interaction.update(buildHelpTopicPickerUi(topics, idx));
      return true;
    }

    if (interaction.isStringSelectMenu() && id === SELECT_TOPIC) {
      const gIdx = parseInt(interaction.values[0], 10);
      if (!Number.isFinite(gIdx) || gIdx < 0 || gIdx >= topics.length) {
        await interaction.update(buildHelpCategoryUi(topics));
        return true;
      }
      await interaction.update(buildHelpTopicAnswerUi(topics, gIdx));
      const clicked = topics[gIdx];
      if (clicked) recordHelpTopicClicked(clicked);
      return true;
    }

    if (interaction.isButton() && id === BTN_BACK_CATS) {
      await interaction.update(buildHelpCategoryUi(topics));
      return true;
    }

    if (interaction.isButton() && id.startsWith(BTN_TOPICS_PREFIX)) {
      const catIdx = parseInt(id.slice(BTN_TOPICS_PREFIX.length), 10);
      if (!Number.isFinite(catIdx) || catIdx < 0) {
        await interaction.update(buildHelpCategoryUi(topics));
        return true;
      }
      await interaction.update(buildHelpTopicPickerUi(topics, catIdx));
      return true;
    }
  } catch (err) {
    console.error('[HelpUI]', err.message);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: '❌ Something went wrong updating help. Try `!help` again.',
          ephemeral: true
        });
      } else {
        await interaction.reply({
          content: '❌ Something went wrong updating help. Try `!help` again.',
          ephemeral: true
        });
      }
    } catch (_) {}
    return true;
  }

  return false;
}

module.exports = {
  buildHelpCategoryUi,
  buildHelpTopicPickerUi,
  buildHelpTopicAnswerUi,
  handleHelpUiInteraction,
  SELECT_CATEGORY,
  SELECT_TOPIC
};
