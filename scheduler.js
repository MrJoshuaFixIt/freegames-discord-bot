// src/scheduler.js
// Cron-based scheduler that checks for new free games and posts them.

import cron from 'node-cron';
import { fetchAllFreeGames } from './scrapers.js';
import { recordPostedGame, cleanExpiredGames } from './database.js';
import { buildGameEmbed } from './embeds.js';
import { TextChannel } from 'discord.js';

let client;
let channelId;

/**
 * Initialize the scheduler with the Discord client and target channel.
 */
export function initScheduler(discordClient, targetChannelId) {
  client    = discordClient;
  channelId = targetChannelId;

  // Run every hour at :00
  cron.schedule('0 * * * *', () => checkAndPost('scheduled'));

  // Midnight cleanup of expired games
  cron.schedule('0 0 * * *', () => {
    console.log('[Scheduler] Running midnight cleanup...');
    cleanExpiredGames();
  });

  console.log('[Scheduler] Initialized. Checking every hour.');
}

/**
 * Fetch all current free games and post any new ones to Discord.
 * Returns the number of new games posted.
 */
export async function checkAndPost(trigger = 'manual') {
  console.log(`[Scheduler] Checking for free games (trigger: ${trigger})...`);

  if (!client || !channelId) {
    console.error('[Scheduler] Client or channelId not set.');
    return 0;
  }

  let channel;
  try {
    channel = await client.channels.fetch(channelId);
    if (!channel || !(channel instanceof TextChannel) && channel.type !== 0) {
      console.error('[Scheduler] Target channel not found or not a text channel.');
      return 0;
    }
  } catch (err) {
    console.error(`[Scheduler] Could not fetch channel: ${err.message}`);
    return 0;
  }

  let games;
  try {
    games = await fetchAllFreeGames();
  } catch (err) {
    console.error(`[Scheduler] Error fetching games: ${err.message}`);
    return 0;
  }

  if (!games.length) {
    console.log('[Scheduler] No free games found this check.');
    return 0;
  }

  let posted = 0;

  for (const game of games) {
    // Skip upcoming games — only post currently claimable
    if (game.isUpcoming) continue;

    const { shouldPost, isReturn } = recordPostedGame(game);

    if (!shouldPost) continue;

    try {
      const embed = buildGameEmbed(game, isReturn);

      // Role mention if configured
      const roleMention = process.env.NOTIFY_ROLE_ID
        ? `<@&${process.env.NOTIFY_ROLE_ID}>`
        : null;

      await channel.send({
        content: roleMention || undefined,
        embeds:  [embed],
      });

      posted++;
      console.log(`[Scheduler] Posted: "${game.title}" (${game.platform})${isReturn ? ' [RETURN]' : ''}`);

      // Small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      console.error(`[Scheduler] Failed to post "${game.title}": ${err.message}`);
    }
  }

  if (posted === 0 && trigger === 'manual') {
    console.log('[Scheduler] No new games to post.');
  } else {
    console.log(`[Scheduler] Done. Posted ${posted} new game(s).`);
  }

  return posted;
}
