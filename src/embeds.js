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
  'GamerPower':           0xFF6B35,
  default:                0x5865F2,
};

export function formatDate(isoString) {
  if (!isoString) return 'No expiry';
  try {
    const d = new Date(isoString);
    if (isNaN(d)) return isoString;
    return d.toLocaleDateString('en-US', {
      month:   'short',
      day:     'numeric',
      year:    'numeric',
      timeZone: 'UTC',
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
    if (days > 0) return `${days}d ${hours}h left`;
    return `${hours}h left`;
  } catch {
    return null;
  }
}

function multiplayerLabel(multiplayer) {
  if (multiplayer === true)  return '✅ Yes';
  if (multiplayer === false) return '❌ No';
  return '❓ Unknown';
}

// Safely truncate a string to a max length
function trunc(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

/**
 * Rich embed for a single free game announcement.
 */
export function buildGameEmbed(game, isReturn = false) {
  const color = PLATFORM_COLORS[game.platform] ?? PLATFORM_COLORS.default;

  let titlePrefix = '🆓';
  if (isReturn)        titlePrefix = '🔄';
  if (game.isUpcoming) titlePrefix = '⏳';

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(trunc(`${titlePrefix} ${game.title}`, 256))
    .setURL(game.url || null)
    .setTimestamp();

  if (game.imageUrl) embed.setThumbnail(game.imageUrl);

  embed.addFields({
    name: '🏪 Platform',
    value: `${game.platformEmoji ?? '🎮'} **${game.platform}**`,
    inline: true,
  });

  const ratingVal = game.metacritic
    ? `⭐ ${game.rating ?? 'N/A'}\n🎯 ${game.metacritic} (MC)`
    : (game.rating ? `⭐ ${game.rating}` : '❓ No rating');
  embed.addFields({ name: '📊 Rating', value: ratingVal, inline: true });

  embed.addFields({ name: '👥 Multiplayer', value: multiplayerLabel(game.multiplayer), inline: true });

  if (game.isUpcoming && game.freeFrom) {
    embed.addFields({ name: '📅 Free Starting', value: formatDate(game.freeFrom), inline: true });
  }

  const expiryLabel = game.isUpcoming ? '📅 Free Until' : '⏰ Free Until';
  const expiryValue = game.freeUntil
    ? `${formatDate(game.freeUntil)} *(${timeUntil(game.freeUntil)})*`
    : 'No expiry listed';
  embed.addFields({ name: expiryLabel, value: expiryValue, inline: true });

  if (game.url) {
    embed.addFields({
      name: '🔗 Claim',
      value: `**[👉 Click here to claim on ${game.platform}](${game.url})**`,
    });
  }

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
 * Summary embed for /listgames.
 * Kept well under Discord's 6000-char embed limit by using compact lines
 * and capping each platform group at 15 games.
 */
export function buildSummaryEmbed(games) {
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🆓 Currently Tracked Free Games')
    .setTimestamp()
    .setFooter({ text: 'Use /checkgames to refresh • /upcoming for upcoming games' });

  // Group by platform
  const grouped = {};
  for (const g of games) {
    if (!grouped[g.platform]) grouped[g.platform] = [];
    grouped[g.platform].push(g);
  }

  let totalCount = 0;
  let fieldCount = 0;

  for (const [platform, list] of Object.entries(grouped)) {
    // Discord allows max 25 fields per embed
    if (fieldCount >= 24) break;

    const lines = list.slice(0, 15).map(g => {
      const expiry = g.free_until ? ` *(${formatDate(g.free_until)})*` : '';
      // Keep title short to avoid blowing the char limit
      const title  = trunc(g.title, 50);
      const link   = g.url ? `[${title}](${g.url})` : title;
      return `• ${link}${expiry}`;
    });

    // Truncate field value to Discord's 1024-char field limit
    let value = lines.join('\n');
    if (value.length > 1024) value = value.slice(0, 1021) + '…';

    embed.addFields({
      name: trunc(`${list[0]?.platformEmoji ?? '🎮'} ${platform} (${list.length})`, 256),
      value: value || 'None',
    });

    totalCount += list.length;
    fieldCount++;
  }

  embed.setDescription(`Showing **${totalCount}** tracked game(s) across **${Object.keys(grouped).length}** platform(s).`);
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
      name: trunc(`${g.platformEmoji ?? '🎮'} ${g.title}`, 256),
      value: trunc([
        `**Platform:** ${g.platform}`,
        g.freeFrom  ? `**Free from:** ${formatDate(g.freeFrom)}`  : null,
        g.freeUntil ? `**Free until:** ${formatDate(g.freeUntil)}` : null,
        g.url       ? `**Link:** [View on store](${g.url})`        : null,
      ].filter(Boolean).join('\n'), 1024),
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
    .setDescription(trunc(message, 4096))
    .setTimestamp();
}
