// src/embeds.js
// Builds Discord embeds for free game announcements

import { EmbedBuilder } from 'discord.js';

// Platform brand colors
const PLATFORM_COLORS = {
  'Epic Games':           0x2B2D31,
  'Steam':                0x1B2838,
  'GOG':                  0x9A3BE8,
  'Amazon Prime Gaming':  0x00A8E0,
  'Humble Bundle':        0xCC2929,
  'IndieGala':            0xF5A623,
  'Ubisoft Connect':      0x0070CC,
  default:                0x5865F2,
};

function formatDate(isoString) {
  if (!isoString) return 'Unknown';
  try {
    const d = new Date(isoString);
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

function multiplayerLabel(multiplayer) {
  if (multiplayer === true)  return '✅ Yes (Multiplayer / Co-op)';
  if (multiplayer === false) return '❌ No (Single-player only)';
  return '❓ Unknown';
}

/**
 * Build a rich embed for a single free game.
 */
export function buildGameEmbed(game, isReturn = false) {
  const color = PLATFORM_COLORS[game.platform] ?? PLATFORM_COLORS.default;

  const title = isReturn
    ? `🔄 Back for Free: ${game.title}`
    : `🆓 Free Game: ${game.title}`;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setURL(game.url || null)
    .setTimestamp();

  // Platform + upcoming badge
  const platformLine = game.isUpcoming
    ? `${game.platformEmoji ?? '🎮'} **${game.platform}** — ⏳ Coming Soon`
    : `${game.platformEmoji ?? '🎮'} **${game.platform}**`;

  embed.addFields(
    { name: '🏪 Platform',     value: platformLine,                              inline: true  },
    { name: '⭐ Rating',        value: game.rating    || '❓ No rating found',   inline: true  },
    { name: '👥 Multiplayer',   value: multiplayerLabel(game.multiplayer),        inline: true  },
  );

  if (game.metacritic) {
    embed.addFields({ name: '🎯 Metacritic', value: game.metacritic, inline: true });
  }

  if (game.isUpcoming && game.freeFrom) {
    embed.addFields({
      name:   '📅 Free Starting',
      value:  formatDate(game.freeFrom),
      inline: true,
    });
  }

  embed.addFields({
    name:   game.isUpcoming ? '📅 Free Until' : '⏰ Free Until',
    value:  game.freeUntil ? formatDate(game.freeUntil) : 'Permanently Free / No expiry listed',
    inline: true,
  });

  if (game.url) {
    embed.addFields({
      name:  '🔗 Claim Here',
      value: `[Click to claim on ${game.platform}](${game.url})`,
    });
  }

  if (game.imageUrl) {
    embed.setThumbnail(game.imageUrl);
  }

  if (isReturn) {
    embed.setFooter({ text: 'This game was previously free and is now free again!' });
  } else if (game.isUpcoming) {
    embed.setFooter({ text: 'Upcoming free game — not yet claimable' });
  }

  return embed;
}

/**
 * Build a summary embed listing all current free games (for /listgames)
 */
export function buildSummaryEmbed(games) {
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🆓 All Currently Tracked Free Games')
    .setDescription(`Showing the ${games.length} most recently posted free games.`)
    .setTimestamp()
    .setFooter({ text: 'Use /checkgames to force a refresh' });

  const grouped = {};
  for (const g of games) {
    if (!grouped[g.platform]) grouped[g.platform] = [];
    grouped[g.platform].push(g);
  }

  for (const [platform, list] of Object.entries(grouped)) {
    const lines = list.slice(0, 10).map(g => {
      const expiry = g.free_until ? ` *(until ${formatDate(g.free_until)})*` : '';
      const link = g.url ? `[${g.title}](${g.url})` : g.title;
      return `• ${link}${expiry}`;
    });
    embed.addFields({
      name:  `${list[0]?.platformEmoji ?? '🎮'} ${platform}`,
      value: lines.join('\n') || 'None',
    });
  }

  return embed;
}

/**
 * Build an error/status embed
 */
export function buildStatusEmbed(message, isError = false) {
  return new EmbedBuilder()
    .setColor(isError ? 0xED4245 : 0x57F287)
    .setDescription(message)
    .setTimestamp();
}
