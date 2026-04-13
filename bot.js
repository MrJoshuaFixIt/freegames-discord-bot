// src/bot.js
// Entry point — boots the Discord bot, registers commands, starts the scheduler.

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
import { buildSummaryEmbed, buildStatusEmbed, buildGameEmbed } from './embeds.js';
import { fetchAllFreeGames } from './scrapers.js';

// ─── Validate environment ────────────────────────────────────────────────────
const REQUIRED_ENV = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'CHANNEL_ID'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`[Bot] Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const { DISCORD_TOKEN, DISCORD_CLIENT_ID, CHANNEL_ID } = process.env;

// ─── Discord Client ──────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ],
  partials: [Partials.Channel],
});

// ─── Slash Commands ──────────────────────────────────────────────────────────
const commands = [
  new SlashCommandBuilder()
    .setName('checkgames')
    .setDescription('Manually check for new free games right now.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  new SlashCommandBuilder()
    .setName('listgames')
    .setDescription('Show all free games that have been posted.'),

  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check if the bot is alive.'),

  new SlashCommandBuilder()
    .setName('setchannel')
    .setDescription('Set this channel as the free games announcement channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
].map(cmd => cmd.toJSON());

// ─── Register Commands on Boot ───────────────────────────────────────────────
async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  try {
    console.log('[Bot] Registering slash commands...');
    await rest.put(
      Routes.applicationCommands(DISCORD_CLIENT_ID),
      { body: commands }
    );
    console.log('[Bot] Slash commands registered.');
  } catch (err) {
    console.error('[Bot] Failed to register commands:', err.message);
  }
}

// ─── Interaction Handler ─────────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  // ── /ping ──────────────────────────────────────────────────────────────────
  if (commandName === 'ping') {
    await interaction.reply({
      embeds: [buildStatusEmbed(`🏓 Pong! Latency: **${client.ws.ping}ms**`)],
      ephemeral: true,
    });
    return;
  }

  // ── /listgames ─────────────────────────────────────────────────────────────
  if (commandName === 'listgames') {
    await interaction.deferReply({ ephemeral: true });
    const games = getAllPostedGames(40);

    if (!games.length) {
      await interaction.editReply({
        embeds: [buildStatusEmbed('No games have been posted yet. Use `/checkgames` to check now.')],
      });
      return;
    }

    await interaction.editReply({ embeds: [buildSummaryEmbed(games)] });
    return;
  }

  // ── /checkgames ────────────────────────────────────────────────────────────
  if (commandName === 'checkgames') {
    await interaction.deferReply({ ephemeral: true });

    const count = await checkAndPost('slash-command');

    const message = count > 0
      ? `✅ Done! Posted **${count}** new free game(s) to <#${CHANNEL_ID}>.`
      : '✅ Check complete — no new free games found right now.';

    await interaction.editReply({ embeds: [buildStatusEmbed(message)] });
    return;
  }

  // ── /setchannel ───────────────────────────────────────────────────────────
  if (commandName === 'setchannel') {
    const channelId = interaction.channelId;
    // In a real multi-server setup you'd persist this per-guild.
    // For single-server use, instruct user to set CHANNEL_ID env var.
    await interaction.reply({
      embeds: [buildStatusEmbed(
        `To use this channel (\`${channelId}\`), set your \`CHANNEL_ID\` environment variable to:\n\`\`\`\n${channelId}\n\`\`\``
      )],
      ephemeral: true,
    });
    return;
  }
});

// ─── Ready ───────────────────────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`[Bot] Logged in as ${client.user.tag}`);
  console.log(`[Bot] Announcing to channel: ${CHANNEL_ID}`);

  initDatabase();
  initScheduler(client, CHANNEL_ID);
  await registerCommands();

  // Run an immediate check on startup
  console.log('[Bot] Running startup check...');
  await checkAndPost('startup');
});

// ─── Error Handling ───────────────────────────────────────────────────────────
client.on('error', err => console.error('[Discord] Error:', err));
process.on('unhandledRejection', err => console.error('[Process] Unhandled rejection:', err));
process.on('uncaughtException',  err => {
  console.error('[Process] Uncaught exception:', err);
  process.exit(1);
});

// ─── Connect ─────────────────────────────────────────────────────────────────
client.login(DISCORD_TOKEN).catch(err => {
  console.error('[Bot] Login failed:', err.message);
  process.exit(1);
});
