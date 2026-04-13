# 🆓 Free Games Discord Bot

A Discord bot that monitors **Epic Games, Steam, GOG, Amazon Prime Gaming, Humble Bundle, IndieGala, and Ubisoft Connect** for free games and announces them in your server — without ever repeating a post unless a game returns for free again.

---

## ✨ Features

- **7 platforms** monitored: Epic Games, Steam, GOG, Amazon Prime Gaming, Humble Bundle, IndieGala, Ubisoft Connect
- **No duplicate posts** — each game is posted exactly once per promotion period
- **Return detection** — if a game goes free again after a previous promotion ended, it gets re-announced
- **Rich embeds** — game name, link, rating (via RAWG), multiplayer info, and expiry date
- **Hourly checks** — runs automatically every hour
- **Slash commands** — `/checkgames`, `/listgames`, `/ping`, `/setchannel`
- **Role pings** — optional role mention on new posts
- **SQLite database** — lightweight, no external database needed
- **Railway-ready** — deploys in minutes with persistent storage

---

## 📋 Requirements

- Node.js 18+
- A Discord bot token
- A free [RAWG.io](https://rawg.io/apidocs) API key *(optional but recommended for ratings)*

---

## 🚀 Quick Start

### 1. Create a Discord Bot

1. Go to [https://discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application** → give it a name
3. Go to **Bot** → click **Add Bot** → copy the **Token**
4. Under **Privileged Gateway Intents**, enable **Server Members Intent** and **Message Content Intent**
5. Go to **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot permissions: `Send Messages`, `Embed Links`, `View Channels`
6. Copy the generated URL and open it to invite the bot to your server

### 2. Get Your IDs

Enable **Developer Mode** in Discord (User Settings → Advanced → Developer Mode), then:

- **Channel ID**: Right-click your announcement channel → Copy Channel ID
- **Application/Client ID**: Found on your app's OAuth2 page
- **Role ID** *(optional)*: Right-click a role in Server Settings → Copy Role ID

### 3. Clone & Configure

```bash
git clone https://github.com/YOUR_USERNAME/freegames-discord-bot.git
cd freegames-discord-bot
npm install
cp .env.example .env
```

Edit `.env`:

```env
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_application_id
CHANNEL_ID=your_channel_id
RAWG_API_KEY=your_rawg_key      # optional
NOTIFY_ROLE_ID=your_role_id     # optional
```

### 4. Run Locally

```bash
npm start
```

---

## ☁️ Deploy to Railway

Railway is the recommended hosting platform — it provides free hosting for small bots and supports persistent volumes for the SQLite database.

### Step-by-step

1. **Push to GitHub**

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/freegames-discord-bot.git
git push -u origin main
```

2. **Create a Railway project**

   - Go to [https://railway.app](https://railway.app) and sign in
   - Click **New Project** → **Deploy from GitHub repo**
   - Select your `freegames-discord-bot` repository

3. **Add environment variables**

   In your Railway project, go to **Variables** and add:

   | Variable             | Value                          |
   |----------------------|--------------------------------|
   | `DISCORD_TOKEN`      | Your bot token                 |
   | `DISCORD_CLIENT_ID`  | Your application ID            |
   | `CHANNEL_ID`         | Your channel ID                |
   | `RAWG_API_KEY`       | Your RAWG key *(optional)*     |
   | `NOTIFY_ROLE_ID`     | Your role ID *(optional)*      |

4. **Add a persistent volume** *(keeps the database between deploys)*

   - In Railway, click your service → **Volumes**
   - Add a volume mounted at `/data`
   - Add the variable: `RAILWAY_VOLUME_MOUNT_PATH=/data`

5. **Deploy**

   Railway auto-deploys on every push to `main`. Your bot will be live within a minute.

---

## 🎮 Slash Commands

| Command        | Description                                          | Permissions needed |
|---------------|------------------------------------------------------|--------------------|
| `/checkgames` | Force an immediate check for new free games          | Manage Messages    |
| `/listgames`  | Show all games the bot has tracked                   | Anyone             |
| `/ping`       | Check bot status and latency                         | Anyone             |
| `/setchannel` | Get the ID of the current channel (for setup)        | Manage Guild       |

---

## 🔧 Configuration Reference

| Variable                    | Required | Description                                                         |
|-----------------------------|----------|---------------------------------------------------------------------|
| `DISCORD_TOKEN`             | ✅       | Bot token from Discord Developer Portal                             |
| `DISCORD_CLIENT_ID`         | ✅       | Application ID from Discord Developer Portal                        |
| `CHANNEL_ID`                | ✅       | Channel to post announcements in                                    |
| `RAWG_API_KEY`              | ⬜       | RAWG.io key for ratings + multiplayer info. Free at rawg.io/apidocs|
| `NOTIFY_ROLE_ID`            | ⬜       | Role to @mention when new games are posted                          |
| `RAILWAY_VOLUME_MOUNT_PATH` | ⬜       | Set to `/data` on Railway for persistent SQLite storage             |

---

## 📁 Project Structure

```
freegames-discord-bot/
├── src/
│   ├── bot.js          # Entry point, Discord client, slash commands
│   ├── scrapers.js     # Fetches free games from all platforms
│   ├── scheduler.js    # Cron job, posts new games to Discord
│   ├── database.js     # SQLite — tracks what's been posted
│   └── embeds.js       # Builds Discord rich embeds
├── data/               # SQLite database (auto-created, gitignored)
├── .env.example        # Environment variable template
├── .gitignore
├── Dockerfile          # For Railway / Docker deployments
├── railway.toml        # Railway deployment config
├── package.json
└── README.md
```

---

## 🛠 Platforms Supported

| Platform              | Source                                  | Notes                                    |
|-----------------------|-----------------------------------------|------------------------------------------|
| Epic Games            | Official Epic Store API                 | Most reliable — official endpoint        |
| Steam                 | Steam featured categories API           | Shows 100%-off deals                     |
| GOG                   | GOG Catalog API                         | Free games and giveaways                 |
| Amazon Prime Gaming   | Prime Gaming offers API                 | Requires no account to view              |
| Humble Bundle         | Humble Store search API                 | Filters to free items only               |
| IndieGala             | IndieGala giveaway API                  | Regular indie game giveaways             |
| Ubisoft Connect       | Ubisoft Store API                       | Free Ubisoft titles                      |

---

## 🤝 Contributing

Pull requests welcome! To add a new platform:

1. Add a `fetchXxxFreeGames()` function in `src/scrapers.js`
2. Add it to the `scrapers` array in `fetchAllFreeGames()`
3. Test it with `npm start`

---

## 📜 License

MIT — free to use, modify, and distribute.
