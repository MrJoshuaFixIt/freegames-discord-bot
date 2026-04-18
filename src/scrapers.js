// src/scrapers.js
// Fetches genuinely free games from multiple platforms.

import fetch from 'node-fetch';

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

function slugify(title = '') {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function safeFetch(url, options = {}) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'application/json, text/html, */*',
        ...options.headers,
      },
      ...options,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      console.warn(`[Scraper] ${url} → HTTP ${res.status}`);
      return null;
    }
    return res;
  } catch (err) {
    console.warn(`[Scraper] fetch failed (${url}): ${err.message}`);
    return null;
  }
}

async function safeJSON(url, options = {}) {
  const res = await safeFetch(url, options);
  if (!res) return null;
  try {
    return await res.json();
  } catch (err) {
    console.warn(`[Scraper] JSON parse failed (${url}): ${err.message}`);
    return null;
  }
}

async function fetchGameDetails(title) {
  const key = process.env.RAWG_API_KEY;
  if (!key) return { rating: null, metacritic: null, multiplayer: null };

  try {
    const search = await safeJSON(
      `https://api.rawg.io/api/games?key=${key}&search=${encodeURIComponent(title)}&page_size=1`
    );
    const game = search?.results?.[0];
    if (!game) return { rating: null, metacritic: null, multiplayer: null };

    const detail = await safeJSON(`https://api.rawg.io/api/games/${game.id}?key=${key}`);
    const tags = (detail?.tags ?? []).map(t => t.slug);
    const multiplayer = tags.some(t =>
      ['multiplayer', 'co-op', 'online-co-op', 'local-co-op',
       'online-multiplayer', 'local-multiplayer', 'co-operative'].includes(t)
    );

    return {
      rating: game.rating ? `${game.rating.toFixed(1)} / 5` : null,
      metacritic: game.metacritic ? `${game.metacritic} / 100` : null,
      multiplayer,
    };
  } catch (err) {
    console.warn(`[RAWG] "${title}": ${err.message}`);
    return { rating: null, metacritic: null, multiplayer: null };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EPIC GAMES
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchEpicFreeGames() {
  const url =
    'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions' +
    '?locale=en-US&country=US&allowCountries=US';

  const data = await safeJSON(url);
  if (!data) return [];

  const elements = data?.data?.Catalog?.searchStore?.elements ?? [];
  const games = [];

  for (const item of elements) {
    const promos = item.promotions;
    if (!promos) continue;

    const current = promos.promotionalOffers?.[0]?.promotionalOffers ?? [];
    for (const offer of current) {
      if (offer.discountSetting?.discountPercentage !== 0) continue;
      const slug = item.productSlug || item.catalogNs?.mappings?.[0]?.pageSlug || slugify(item.title);
      const details = await fetchGameDetails(item.title);
      games.push({
        id: `epic-${item.id ?? slugify(item.title)}`,
        platform: 'Epic Games', platformEmoji: '🎮',
        title: item.title,
        url: `https://store.epicgames.com/en-US/p/${slug}`,
        freeUntil: offer.endDate ?? null, freeFrom: offer.startDate ?? null,
        imageUrl: item.keyImages?.find(i => i.type === 'OfferImageTall')?.url ?? null,
        isUpcoming: false, ...details,
      });
    }

    const upcoming = promos.upcomingPromotionalOffers?.[0]?.promotionalOffers ?? [];
    for (const offer of upcoming) {
      const slug = item.productSlug || item.catalogNs?.mappings?.[0]?.pageSlug || slugify(item.title);
      games.push({
        id: `epic-upcoming-${item.id ?? slugify(item.title)}`,
        platform: 'Epic Games', platformEmoji: '🎮',
        title: item.title,
        url: `https://store.epicgames.com/en-US/p/${slug}`,
        freeUntil: offer.endDate ?? null, freeFrom: offer.startDate ?? null,
        imageUrl: item.keyImages?.find(i => i.type === 'OfferImageTall')?.url ?? null,
        isUpcoming: true, rating: null, metacritic: null, multiplayer: null,
      });
    }
  }

  console.log(`[Epic] ${games.filter(g => !g.isUpcoming).length} free, ${games.filter(g => g.isUpcoming).length} upcoming`);
  return games;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEAM
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchSteamFreeGames() {
  const games = [];

  const specials = await safeJSON('https://store.steampowered.com/api/featuredcategories?cc=US&l=en');
  const candidates = [
    ...(specials?.specials?.items ?? []),
    ...(specials?.top_sellers?.items ?? []),
    ...(specials?.new_releases?.items ?? []),
    ...(specials?.spotlight?.items ?? []),
  ];

  for (const item of candidates) {
    if (item.discount_percent !== 100 || item.final_price !== 0) continue;
    const appId = String(item.id);
    const details = await fetchGameDetails(item.name);
    games.push({
      id: `steam-${appId}`, platform: 'Steam', platformEmoji: '🎮',
      title: item.name, url: `https://store.steampowered.com/app/${appId}`,
      freeUntil: item.discount_expiration ? new Date(item.discount_expiration * 1000).toISOString() : null,
      imageUrl: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`,
      isUpcoming: false, ...details,
    });
  }

  const searchData = await safeJSON(
    'https://store.steampowered.com/search/results/?json=1&specials=1&maxprice=free&category1=998&count=20&infinite=1'
  );

  for (const item of searchData?.items ?? []) {
    const appId = String(item.id || item.app_id);
    if (!appId || appId === 'undefined') continue;
    if (games.some(g => g.id === `steam-${appId}`)) continue;

    const appData = await safeJSON(`https://store.steampowered.com/api/appdetails?appids=${appId}&cc=us&l=en`);
    const info = appData?.[appId]?.data;
    if (!info) continue;

    const isFreeToPlay = info.is_free === true;
    const isOnSaleForFree = info.price_overview?.discount_percent === 100 && info.price_overview?.final === 0;
    if (!isFreeToPlay && !isOnSaleForFree) continue;

    if (isFreeToPlay && !isOnSaleForFree) {
      const releaseDate = info.release_date?.date;
      if (!releaseDate) continue;
      if (new Date(releaseDate) < new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)) continue;
    }

    const details = await fetchGameDetails(info.name);
    games.push({
      id: `steam-${appId}`, platform: 'Steam', platformEmoji: '🎮',
      title: info.name, url: `https://store.steampowered.com/app/${appId}`,
      freeUntil: isOnSaleForFree && info.price_overview?.discount_expiration
        ? new Date(info.price_overview.discount_expiration * 1000).toISOString() : null,
      imageUrl: info.header_image ?? null, isUpcoming: false, ...details,
    });
  }

  console.log(`[Steam] ${games.length} genuinely free game(s)`);
  return games;
}

// ─────────────────────────────────────────────────────────────────────────────
// GOG
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchGOGFreeGames() {
  const data = await safeJSON(
    'https://catalog.gog.com/v1/catalog?limit=48&order=desc%3Atrendscore' +
    '&priceTo=0&productType=in%3Agame%2Cpack&page=1&countryCode=US&locale=en-US&currencyCode=USD'
  );
  if (!data) return [];

  const games = [];
  for (const product of data.products ?? []) {
    const amount = product.price?.finalMoney?.amount;
    if (amount !== '0.00' && amount !== '0') continue;
    const details = await fetchGameDetails(product.title);
    games.push({
      id: `gog-${product.id ?? slugify(product.title)}`, platform: 'GOG', platformEmoji: '🎮',
      title: product.title,
      url: product.storeLink ? `https://www.gog.com${product.storeLink}` : `https://www.gog.com/game/${slugify(product.title)}`,
      freeUntil: product.price?.endDate ?? null, imageUrl: product.coverHorizontal ?? null,
      isUpcoming: false, ...details,
    });
  }

  console.log(`[GOG] ${games.length} free game(s)`);
  return games;
}

// ─────────────────────────────────────────────────────────────────────────────
// AMAZON PRIME GAMING
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchPrimeGamingFreeGames() {
  const games = [];
  try {
    const res = await safeFetch('https://gaming.amazon.com/home', {
      headers: { 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9' },
    });
    if (!res) { console.log('[Prime Gaming] 0 free game(s)'); return []; }

    const html = await res.text();
    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>(\{.+?\})<\/script>/s);
    if (match) {
      const state = JSON.parse(match[1]);
      const offers = state?.props?.pageProps?.offers ?? state?.props?.pageProps?.primeGamingData?.offers ?? [];
      for (const offer of offers) {
        const title = offer.title ?? offer.gameTitle;
        if (!title) continue;
        games.push({
          id: `prime-${offer.asin ?? slugify(title)}`, platform: 'Amazon Prime Gaming', platformEmoji: '👑',
          title, url: offer.claimUrl ?? offer.externalUrl ?? 'https://gaming.amazon.com/home',
          freeUntil: offer.endTime ?? null, imageUrl: offer.imageUrl ?? null,
          isUpcoming: false, rating: null, metacritic: null, multiplayer: null,
        });
      }
    }
  } catch (err) {
    console.warn(`[Prime Gaming] error: ${err.message}`);
  }
  console.log(`[Prime Gaming] ${games.length} free game(s)`);
  return games;
}

// ─────────────────────────────────────────────────────────────────────────────
// HUMBLE BUNDLE
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchHumbleFreeGames() {
  const res = await safeFetch(
    'https://www.humblebundle.com/store/api/search?request=1&sort=discount&genre=free&platform=windows&page_size=20',
    {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Referer': 'https://www.humblebundle.com/store?sort=discount&genre=free',
        'X-Requested-With': 'XMLHttpRequest',
        'Origin': 'https://www.humblebundle.com',
        'Sec-Fetch-Dest': 'empty', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Site': 'same-origin',
      },
    }
  );

  if (!res) { console.log('[Humble] 0 free game(s)'); return []; }
  let data;
  try { data = await res.json(); } catch (_) { console.log('[Humble] 0 free game(s)'); return []; }

  const games = [];
  for (const item of data.results ?? []) {
    const price = item.current_price?.amount ?? item.sale_price ?? 1;
    if (Number(price) !== 0) continue;
    const details = await fetchGameDetails(item.human_name);
    games.push({
      id: `humble-${item.human_url ?? slugify(item.human_name)}`, platform: 'Humble Bundle', platformEmoji: '🤲',
      title: item.human_name, url: `https://www.humblebundle.com/store/${item.human_url}`,
      freeUntil: item.sale_end ?? null, imageUrl: item.image ?? null, isUpcoming: false, ...details,
    });
  }

  console.log(`[Humble] ${games.length} free game(s)`);
  return games;
}

// ─────────────────────────────────────────────────────────────────────────────
// INDIEGALA
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchIndieGalaFreeGames() {
  const res = await safeFetch('https://freebies.indiegala.com/', {
    headers: { 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.9', 'Referer': 'https://www.indiegala.com/' },
  });
  if (!res) { console.log('[IndieGala] 0 free game(s)'); return []; }

  const html = await res.text();
  const games = [];
  const seen = new Set();

  for (const m of [...html.matchAll(/alt="([^"]{3,80}) product image"/gi)]) {
    const title = m[1].trim();
    if (!title || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    games.push({
      id: `indiegala-${slugify(title)}`, platform: 'IndieGala', platformEmoji: '🎁',
      title, url: 'https://freebies.indiegala.com/', freeUntil: null, imageUrl: null,
      isUpcoming: false, rating: null, metacritic: null, multiplayer: null,
    });
  }

  console.log(`[IndieGala] ${games.length} free game(s)`);
  return games;
}

// ─────────────────────────────────────────────────────────────────────────────
// ITCH.IO
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchItchFreeGames() {
  const data = await safeJSON('https://itch.io/games/on-sale?format=json&page=1');
  if (!data) return [];

  const games = [];
  for (const item of data.games ?? []) {
    if (item.sale?.rate !== 100) continue;
    games.push({
      id: `itch-${item.id ?? slugify(item.title)}`, platform: 'Itch.io', platformEmoji: '🕹️',
      title: item.title, url: item.url ?? 'https://itch.io',
      freeUntil: item.sale?.end_date ?? null, imageUrl: item.cover_url ?? null,
      isUpcoming: false, rating: null, metacritic: null, multiplayer: null,
    });
  }

  console.log(`[Itch.io] ${games.length} free game(s)`);
  return games;
}

// ─────────────────────────────────────────────────────────────────────────────
// GAMERPOWER
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchGamerPowerFreeGames() {
  const data = await safeJSON(
    'https://www.gamerpower.com/api/giveaways?platform=pc&type=game&sort-by=date',
    { headers: { 'Accept': 'application/json' } }
  );
  if (!data || !Array.isArray(data)) { console.log('[GamerPower] 0 free game(s)'); return []; }

  const games = [];
  const seen = new Set();
  for (const item of data) {
    if (item.status && item.status !== 'Active') continue;
    const title = item.title;
    if (!title || seen.has(slugify(title))) continue;
    seen.add(slugify(title));
    games.push({
      id: `gamerpower-${item.id ?? slugify(title)}`, platform: 'GamerPower', platformEmoji: '⚡',
      title, url: item.open_giveaway_url ?? item.giveaway_url ?? 'https://www.gamerpower.com/giveaways',
      freeUntil: item.end_date && item.end_date !== 'N/A' ? item.end_date : null,
      imageUrl: item.image ?? item.thumbnail ?? null,
      isUpcoming: false, rating: null, metacritic: null, multiplayer: null,
    });
  }

  console.log(`[GamerPower] ${games.length} free game(s)`);
  return games;
}

// ─────────────────────────────────────────────────────────────────────────────
// REDDIT — r/FreeGameFindings + r/Freegamestuff
// Uses old.reddit.com which allows unauthenticated JSON access from servers.
// ─────────────────────────────────────────────────────────────────────────────

const REDDIT_EXCLUDE = [
  'discussion', 'meta', 'question', 'looking for', ' lf ', 'trade',
  'trading', 'want', 'wtb', 'sold out', 'expired', 'ended', 'over',
  'no longer', 'not free', 'asking', 'help', 'request',
];

const REDDIT_INCLUDE = [
  'free', 'giveaway', 'claim', 'grab', '100% off', 'steam key',
  'drm-free', 'drm free', 'indiegala', 'humble', 'itch', 'gog', 'epic',
  'prime gaming', 'key',
];

function isValidRedditPost(post) {
  const title = (post.title ?? '').toLowerCase();
  const flair = (post.link_flair_text ?? '').toLowerCase();
  const combined = title + ' ' + flair;

  // Must be posted within the last 48 hours
  const ageHours = (Date.now() / 1000 - post.created_utc) / 3600;
  if (ageHours > 48) return false;

  if (REDDIT_EXCLUDE.some(w => combined.includes(w))) return false;
  if (!REDDIT_INCLUDE.some(w => combined.includes(w))) return false;

  return true;
}

async function fetchSubreddit(subreddit) {
  // old.reddit.com still serves unauthenticated JSON without rate-limiting bots
  const url = `https://old.reddit.com/r/${subreddit}/new.json?limit=50`;
  const data = await safeJSON(url, {
    headers: {
      'User-Agent': 'FreeGameNotifier:v1.0 (Discord bot; contact via GitHub)',
      'Accept': 'application/json',
    },
  });
  if (!data) return [];

  const games = [];
  for (const child of data?.data?.children ?? []) {
    const post = child.data;
    if (!post || post.stickied) continue;
    if (!isValidRedditPost(post)) continue;

    const claimUrl = (!post.is_self && post.url && !post.url.includes('reddit.com'))
      ? post.url
      : `https://www.reddit.com${post.permalink}`;

    games.push({
      id: `reddit-${post.id}`,
      platform: `Reddit r/${subreddit}`,
      platformEmoji: '🟠',
      title: post.title.trim(),
      url: claimUrl,
      freeUntil: null,
      imageUrl: post.thumbnail?.startsWith('http') ? post.thumbnail : null,
      isUpcoming: false,
      rating: null, metacritic: null, multiplayer: null,
    });
  }

  return games;
}

export async function fetchRedditFreeGames() {
  const subreddits = ['FreeGameFindings', 'Freegamestuff'];
  const seen = new Set();
  const games = [];

  for (const sub of subreddits) {
    const posts = await fetchSubreddit(sub);
    for (const game of posts) {
      if (seen.has(game.id)) continue;
      seen.add(game.id);
      games.push(game);
    }
  }

  console.log(`[Reddit] ${games.length} free game post(s)`);
  return games;
}

// ─────────────────────────────────────────────────────────────────────────────
// Master aggregator
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchAllFreeGames() {
  console.log('[Scrapers] Starting fetch across all platforms...');

  const scrapers = [
    { name: 'Epic Games',    fn: fetchEpicFreeGames },
    { name: 'Steam',         fn: fetchSteamFreeGames },
    { name: 'GOG',           fn: fetchGOGFreeGames },
    { name: 'Amazon Prime',  fn: fetchPrimeGamingFreeGames },
    { name: 'Humble Bundle', fn: fetchHumbleFreeGames },
    { name: 'IndieGala',     fn: fetchIndieGalaFreeGames },
    { name: 'Itch.io',       fn: fetchItchFreeGames },
    { name: 'GamerPower',    fn: fetchGamerPowerFreeGames },
    { name: 'Reddit',        fn: fetchRedditFreeGames },
  ];

  const results = await Promise.allSettled(
    scrapers.map(s =>
      s.fn().catch(err => {
        console.error(`[Scrapers] ${s.name} threw: ${err.message}`);
        return [];
      })
    )
  );

  const allGames = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
  console.log(`[Scrapers] Total: ${allGames.length} game(s) across all platforms`);
  return allGames;
}
