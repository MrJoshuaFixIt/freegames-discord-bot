// src/scheduler.js

import cron from 'node-cron';
import { fetchAllFreeGames } from './scrapers.js';
import { recordPostedGame, cleanExpiredGames } from './database.js';
import { buildGameEmbed } from './embeds.js';

let client;
let channelId;

export function initScheduler(discordClient, targetChannelId) {
  client    = discordClient;
  channelId = targetChannelId;

  // Check every hour
  cron.schedule('0 * * * *', () => checkAndPost('scheduled'));

  // Midnight cleanup
  cron.schedule('0 0 * * *', () => {
    console.log('[Scheduler] Midnight cleanup...');
    cleanExpiredGames();
  });

  console.log('[Scheduler] Initialized — checking every hour.');
}

export async function checkAndPost(trigger = 'manual') {
  console.log(`[Scheduler] Checking (trigger: ${trigger})...`);

  if (!client || !channelId) {
    console.error('[Scheduler] Client or channelId not set.');
    return { posted: 0, errors: 0 };
  }

  let channel;
  try {
    channel = await client.channels.fetch(channelId);
    if (!channel) throw new Error('Channel not found');
  } catch (err) {
    console.error(`[Scheduler] Cannot fetch channel: ${err.message}`);
    return { posted: 0, errors: 1 };
  }

  let games;
  try {
    games = await fetchAllFreeGames();
  } catch (err) {
    console.error(`[Scheduler] fetchAllFreeGames error: ${err.message}`);
    return { posted: 0, errors: 1 };
  }

  if (!games.length) {
    console.log('[Scheduler] No games returned from scrapers.');
    return { posted: 0, errors: 0 };
  }

  let posted = 0;
  let errors = 0;

  for (const game of games) {
    // Never post upcoming games automatically — they go in /upcoming command only
    if (game.isUpcoming) continue;

    const { shouldPost, isReturn } = recordPostedGame(game);
    if (!shouldPost) continue;

    try {
      const embed = buildGameEmbed(game, isReturn);
      const roleMention = process.env.NOTIFY_ROLE_ID
        ? `<@&${process.env.NOTIFY_ROLE_ID}>`
        : null;

      await channel.send({
        content: roleMention ?? undefined,
        embeds: [embed],
      });

      posted++;
      console.log(`[Scheduler] ✅ Posted: "${game.title}" (${game.platform})${isReturn ? ' [RETURN]' : ''}`);

      // Small delay to respect Discord rate limits
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      console.error(`[Scheduler] ❌ Failed to post "${game.title}": ${err.message}`);
      errors++;
    }
  }

  console.log(`[Scheduler] Done. Posted: ${posted}, Errors: ${errors}`);
  return { posted, errors };
}
