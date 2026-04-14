// src/embeds.js

import { EmbedBuilder } from 'discord.js';

const PLATFORM_COLORS = {
  'Epic Games':           0x313131,
  'Steam':                0x1B2838,
  'GOG':                  0x9A3BE8,
  'Amazon Prime Gaming':  0x00A8E0,
  'Humble Bundle':        0xCC2929,
  'IndieGala':            0xF5A623,
  'Ubisoft Connect':      0x0070CC,
  'Itch.io':              0xFA5C5C,
  default:                0x5865F2,
};

export function formatDate(isoString) {
  if (!isoString) return 'No expiry / Permanently free';
  try {
    const d = new Date(isoString);
    if (isNaN(d)) return isoString;
    return d.toLocaleDateString('en-US', {
      weekday: 'short',
      month:   'short',
      day:     'numeric',
      year:    'numeric',
      hour:    '2-digit',
      minute:  '2-digit',
      timeZone: 'UTC',
      timeZoneName: 'short',
    });
  } catch {
    return isoString;
  }
}

function timeUntil(isoString) {
  if (!isoString) return null;
  try {
    const ms = new Date(isoString) - Date.now();
    if (ms <= 0) return 'Expired';
    const days  = Math.floor(ms / 86400000);
    const hours = Math.floor((ms % 86400000) / 3600000);
    if (days > 0) return `${days}d ${hours}h remaining`;
    return `${hours}h remaining`;
  } catch {
    return null;
  }
}

function multiplayerLabel(multiplayer) {
  if (multiplayer === true)  return '✅ Yes';
  if (multiplayer === false) return '❌ No';
  return '❓ Unknown';
}

/**
 * Rich embed for a single free game announcement.
 */
export function buildGameEmbed(game, isReturn = false) {
  const color = PLATFORM_COLORS[game.platform] ?? PLATFORM_COLORS.default;

  let titlePrefix = '🆓';
  if (isReturn)       titlePrefix = '🔄';
  if (game.isUpcoming) titlePrefix = '⏳';

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${titlePrefix} ${game.title}`)
    .setURL(game.url || null)
    .setTimestamp();

  if (game.imageUrl) embed.setThumbnail(game.imageUrl);

  // Platform row
  embed.addFields({
    name: '🏪 Platform',
    value: `${game.platformEmoji ?? '🎮'} **${game.platform}**`,
    inline: true,
  });

  // Rating
  const ratingVal = game.metacritic
    ? `⭐ ${game.rating ?? 'N/A'}\n🎯 ${game.metacritic} (MC)`
    : (game.rating ? `⭐ ${game.rating}` : '❓ No rating');
  embed.addFields({ name: '📊 Rating', value: ratingVal, inline: true });

  // Multiplayer
  embed.addFields({ name: '👥 Multiplayer', value: multiplayerLabel(game.multiplayer), inline: true });

  // Free dates
  if (game.isUpcoming && game.freeFrom) {
    embed.addFields({ name: '📅 Free Starting', value: formatDate(game.freeFrom), inline: true });
  }

  const expiryLabel = game.isUpcoming ? '📅 Free Until' : '⏰ Free Until';
  const expiryValue = game.freeUntil
    ? `${formatDate(game.freeUntil)}\n*(${timeUntil(game.freeUntil)})*`
    : 'No expiry listed / Permanently free';
  embed.addFields({ name: expiryLabel, value: expiryValue, inline: true });

  // Claim link as a prominent field
  if (game.url) {
    embed.addFields({
      name: '🔗 Claim',
      value: `**[👉 Click here to claim on ${game.platform}](${game.url})**`,
    });
  }

  // Footer
  if (isReturn) {
    embed.setFooter({ text: '🔄 This game was free before and is now free again!' });
  } else if (game.isUpcoming) {
    embed.setFooter({ text: '⏳ Not yet claimable — check back when it goes live' });
  } else {
    embed.setFooter({ text: 'Free Games Bot • Claim before it expires!' });
  }

  return embed;
}

/**
 * Summary embed for /listgames
 */
export function buildSummaryEmbed(games) {
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🆓 Currently Tracked Free Games')
    .setTimestamp()
    .setFooter({ text: 'Use /checkgames to force a refresh • /upcoming to see upcoming free games' });

  // Group by platform
  const grouped = {};
  for (const g of games) {
    if (!grouped[g.platform]) grouped[g.platform] = [];
    grouped[g.platform].push(g);
  }

  let totalCount = 0;
  for (const [platform, list] of Object.entries(grouped)) {
    const lines = list.slice(0, 10).map(g => {
      const expiry = g.free_until
        ? ` *(expires ${formatDate(g.free_until)})*`
        : ' *(no expiry)*';
      const link = g.url ? `[${g.title}](${g.url})` : g.title;
      return `• ${link}${expiry}`;
    });
    embed.addFields({
      name: `${list[0]?.platformEmoji ?? '🎮'} ${platform} (${list.length})`,
      value: lines.join('\n') || 'None',
    });
    totalCount += list.length;
  }

  embed.setDescription(`Showing **${totalCount}** tracked free game(s) across **${Object.keys(grouped).length}** platform(s).`);
  return embed;
}

/**
 * Upcoming games embed for /upcoming
 */
export function buildUpcomingEmbed(games) {
  const embed = new EmbedBuilder()
    .setColor(0xFEE75C)
    .setTitle('⏳ Upcoming Free Games')
    .setTimestamp()
    .setFooter({ text: 'These are not yet free — check back when they go live!' });

  if (!games.length) {
    embed.setDescription('No upcoming free games found right now. Check back later!');
    return embed;
  }

  for (const g of games.slice(0, 10)) {
    embed.addFields({
      name: `${g.platformEmoji ?? '🎮'} ${g.title}`,
      value: [
        `**Platform:** ${g.platform}`,
        g.freeFrom  ? `**Free from:** ${formatDate(g.freeFrom)}`  : null,
        g.freeUntil ? `**Free until:** ${formatDate(g.freeUntil)}` : null,
        g.url       ? `**Link:** [View on store](${g.url})`        : null,
      ].filter(Boolean).join('\n'),
    });
  }

  return embed;
}

/**
 * Status / error embed
 */
export function buildStatusEmbed(message, isError = false) {
  return new EmbedBuilder()
    .setColor(isError ? 0xED4245 : 0x57F287)
    .setDescription(message)
    .setTimestamp();
}
