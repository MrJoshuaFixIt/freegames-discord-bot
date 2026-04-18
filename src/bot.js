// src/bot.js

import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  Partials,
  SlashCommandBuilder,
  REST,
  Routes,
  PermissionFlagsBits,
} from 'discord.js';
import { initDatabase, getAllPostedGames } from './database.js';
import { initScheduler, checkAndPost } from './scheduler.js';
import { buildSummaryEmbed, buildUpcomingEmbed, buildStatusEmbed } from './embeds.js';
import { fetchAllFreeGames } from './scrapers.js';

// ── Validate env ──────────────────────────────────────────────────────────────
for (const key of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'CHANNEL_ID']) {
  if (!process.env[key]) {
    console.error(`[Bot] Missing required env var: ${key}`);
    process.exit(1);
  }
}

const { DISCORD_TOKEN, DISCORD_CLIENT_ID, CHANNEL_ID } = process.env;

// ── Discord client ────────────────────────────────────────────────────────────
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  partials: [Partials.Channel],
});

// ── Slash commands ────────────────────────────────────────────────────────────
const commands = [
  new SlashCommandBuilder()
    .setName('checkgames')
    .setDescription('Force an immediate check for new free games.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  new SlashCommandBuilder()
    .setName('listgames')
    .setDescription('Show all free games the bot has posted.'),

  new SlashCommandBuilder()
    .setName('upcoming')
    .setDescription('Show games that will be free soon (Epic, etc.).'),

  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Show bot status, uptime, and last check time.'),

  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check if the bot is alive.'),
].map(c => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID), { body: commands });
    console.log('[Bot] Slash commands registered.');
  } catch (err) {
    console.error('[Bot] Failed to register commands:', err.message);
  }
}

// ── Track uptime and last check ───────────────────────────────────────────────
const startTime = new Date();
let lastCheckTime  = null;
let lastCheckCount = 0;

// ── Interactions ──────────────────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  // /ping
  if (interaction.commandName === 'ping') {
    try {
      await interaction.reply({
        embeds: [buildStatusEmbed(`🏓 Pong! Latency: **${client.ws.ping}ms**`)],
        flags: 64,
      });
    } catch (err) {
      console.error('[Bot] /ping error:', err.message);
    }
    return;
  }

  // /status
  if (interaction.commandName === 'status') {
    try {
      const uptime  = Math.floor((Date.now() - startTime) / 1000);
      const hours   = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      const games   = getAllPostedGames(1000);

      const msg = [
        `🤖 **Bot:** ${client.user.tag}`,
        `⏱️ **Uptime:** ${hours}h ${minutes}m`,
        `📡 **Latency:** ${client.ws.ping}ms`,
        `📢 **Channel:** <#${CHANNEL_ID}>`,
        `🕒 **Last check:** ${lastCheckTime ? lastCheckTime.toLocaleString() : 'Not yet'}`,
        `🆕 **Games found last check:** ${lastCheckCount}`,
        `💾 **Total games tracked:** ${games.length}`,
        `⏰ **Checks:** Every hour at :00`,
      ].join('\n');

      await interaction.reply({
        embeds: [buildStatusEmbed(msg)],
        flags: 64,
      });
    } catch (err) {
      console.error('[Bot] /status error:', err.message);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ Error fetching status.', flags: 64 }).catch(() => {});
      }
    }
    return;
  }

  // /listgames
  if (interaction.commandName === 'listgames') {
    try {
      await interaction.deferReply({ flags: 64 });
      const games = getAllPostedGames(50);
      if (!games.length) {
        await interaction.editReply({
          embeds: [buildStatusEmbed('No games tracked yet. Use `/checkgames` to check now.')],
        });
        return;
      }
      await interaction.editReply({ embeds: [buildSummaryEmbed(games)] });
    } catch (err) {
      console.error('[Bot] /listgames error:', err.message);
      try {
        await interaction.editReply({
          embeds: [buildStatusEmbed(`❌ Error loading game list: ${err.message}`, true)],
        });
      } catch (_) {}
    }
    return;
  }

  // /upcoming
  if (interaction.commandName === 'upcoming') {
    try {
      await interaction.deferReply({ flags: 0 });
      const all      = await fetchAllFreeGames();
      const upcoming = all.filter(g => g.isUpcoming);
      await interaction.editReply({ embeds: [buildUpcomingEmbed(upcoming)] });
    } catch (err) {
      console.error('[Bot] /upcoming error:', err.message);
      try {
        await interaction.editReply({
          embeds: [buildStatusEmbed(`❌ Error fetching upcoming games: ${err.message}`, true)],
        });
      } catch (_) {}
    }
    return;
  }

  // /checkgames
  if (interaction.commandName === 'checkgames') {
    try {
      await interaction.deferReply({ flags: 64 });
      const { posted, errors } = await checkAndPost('slash-command');
      lastCheckTime  = new Date();
      lastCheckCount = posted;

      const msg = posted > 0
        ? `✅ Done! Posted **${posted}** new free game(s) to <#${CHANNEL_ID}>.`
        : errors > 0
          ? `⚠️ Check complete but encountered ${errors} error(s). Check Railway logs.`
          : '✅ Check complete — no new free games found right now.';

      await interaction.editReply({ embeds: [buildStatusEmbed(msg, errors > 0 && posted === 0)] });
    } catch (err) {
      console.error('[Bot] /checkgames error:', err.message);
      try {
        await interaction.editReply({
          embeds: [buildStatusEmbed(`❌ Error running check: ${err.message}`, true)],
        });
      } catch (_) {}
    }
    return;
  }
});

// ── Ready ─────────────────────────────────────────────────────────────────────
client.once('clientReady', async () => {
  console.log(`[Bot] Logged in as ${client.user.tag}`);
  console.log(`[Bot] Posting to channel: ${CHANNEL_ID}`);

  initDatabase();
  initScheduler(client, CHANNEL_ID);
  await registerCommands();

  console.log('[Bot] Running startup check...');
  const { posted } = await checkAndPost('startup');
  lastCheckTime  = new Date();
  lastCheckCount = posted;
});

// ── Error handling ────────────────────────────────────────────────────────────
client.on('error', err => console.error('[Discord]', err.message));
process.on('unhandledRejection', err => console.error('[Unhandled]', err));
process.on('uncaughtException',  err => {
  console.error('[Fatal]', err);
  process.exit(1);
});

client.login(DISCORD_TOKEN).catch(err => {
  console.error('[Bot] Login failed:', err.message);
  process.exit(1);
});
