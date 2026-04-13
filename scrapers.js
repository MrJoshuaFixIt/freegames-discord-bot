// src/scrapers.js
// Fetches free games from Epic Games, Steam, GOG, Amazon Prime Gaming,
// Ubisoft Connect, Humble Bundle, and IndieGala.

import fetch from 'node-fetch';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function safeFetch(url, options = {}) {
  try {
    const res = await fetch(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FreeGamesBot/1.0)',
        'Accept': 'application/json',
        ...options.headers,
      },
      ...options,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } catch (err) {
    console.error(`[Scraper] Fetch failed for ${url}: ${err.message}`);
    return null;
  }
}

/**
 * Fetch RAWG rating + multiplayer info for a game title.
 * RAWG is free up to 20,000 req/month.
 */
async function fetchGameDetails(title) {
  const apiKey = process.env.RAWG_API_KEY;
  if (!apiKey) return { rating: null, multiplayer: null };

  try {
    const query = encodeURIComponent(title);
    const res = await safeFetch(
      `https://api.rawg.io/api/games?key=${apiKey}&search=${query}&page_size=1`
    );
    if (!res) return { rating: null, multiplayer: null };

    const data = await res.json();
    const game = data.results?.[0];
    if (!game) return { rating: null, multiplayer: null };

    // Fetch full game record for tags (multiplayer info lives in tags)
    const detailRes = await safeFetch(
      `https://api.rawg.io/api/games/${game.id}?key=${apiKey}`
    );
    if (!detailRes) return { rating: game.rating || null, multiplayer: null };

    const detail = await detailRes.json();
    const tags = detail.tags?.map(t => t.slug) || [];
    const multiplayer =
      tags.some(t =>
        ['multiplayer', 'co-op', 'online-co-op', 'local-co-op',
         'online-multiplayer', 'local-multiplayer'].includes(t)
      );

    return {
      rating: game.rating ? `${game.rating.toFixed(1)} / 5` : null,
      metacritic: game.metacritic ? `${game.metacritic} / 100 (Metacritic)` : null,
      multiplayer,
    };
  } catch (err) {
    console.error(`[RAWG] Error fetching details for "${title}": ${err.message}`);
    return { rating: null, multiplayer: null };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EPIC GAMES
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchEpicFreeGames() {
  const url =
    'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions' +
    '?locale=en-US&country=US&allowCountries=US';

  const res = await safeFetch(url);
  if (!res) return [];

  let data;
  try {
    data = await res.json();
  } catch {
    return [];
  }

  const elements = data?.data?.Catalog?.searchStore?.elements || [];
  const games = [];

  for (const item of elements) {
    const promos = item.promotions;
    if (!promos) continue;

    // Current free games
    const currentOffers = promos.promotionalOffers?.[0]?.promotionalOffers || [];
    // Upcoming free games
    const upcomingOffers = promos.upcomingPromotionalOffers?.[0]?.promotionalOffers || [];

    for (const offer of currentOffers) {
      if (offer.discountSetting?.discountPercentage !== 0) continue;

      const slug =
        item.productSlug ||
        item.catalogNs?.mappings?.[0]?.pageSlug ||
        slugify(item.title);

      const pageType =
        item.offerType === 'BASE_GAME' ? 'p' : 'bundles';

      const game = {
        id: `epic-${item.id || slugify(item.title)}`,
        platform: 'Epic Games',
        platformEmoji: '🎮',
        title: item.title,
        url: `https://store.epicgames.com/en-US/${pageType}/${slug}`,
        freeUntil: offer.endDate,
        imageUrl: item.keyImages?.find(i => i.type === 'OfferImageTall')?.url || null,
        description: item.description,
        isUpcoming: false,
      };

      const details = await fetchGameDetails(item.title);
      Object.assign(game, details);
      games.push(game);
    }

    // Also include upcoming so users know what's coming
    for (const offer of upcomingOffers) {
      const slug =
        item.productSlug ||
        item.catalogNs?.mappings?.[0]?.pageSlug ||
        slugify(item.title);

      games.push({
        id: `epic-upcoming-${item.id || slugify(item.title)}`,
        platform: 'Epic Games',
        platformEmoji: '🎮',
        title: item.title,
        url: `https://store.epicgames.com/en-US/p/${slug}`,
        freeUntil: offer.endDate,
        freeFrom: offer.startDate,
        description: item.description,
        isUpcoming: true,
        rating: null,
        multiplayer: null,
      });
    }
  }

  return games;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEAM (via IsThereAnyDeal API)
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchSteamFreeGames() {
  // IsThereAnyDeal free tier — no key required for basic free game lookup
  const url = 'https://api.isthereanydeal.com/games/search/v1?title=&limit=50';

  // Alternative: use the Steam featured endpoint which lists current deals
  const steamUrl = 'https://store.steampowered.com/api/featuredcategories?cc=US&l=en';
  const res = await safeFetch(steamUrl);
  if (!res) return [];

  let data;
  try {
    data = await res.json();
  } catch {
    return [];
  }

  const games = [];
  const freeWeekend = data?.specials?.items || [];
  const spotlight = data?.spotlight_items?.items || [];
  const allItems = [...freeWeekend, ...spotlight];

  for (const item of allItems) {
    // Only show 100% discounted (free) items
    if (item.discount_percent !== 100 && item.final_price !== 0) continue;

    const appId = item.id;
    const game = {
      id: `steam-${appId}`,
      platform: 'Steam',
      platformEmoji: '🎮',
      title: item.name,
      url: `https://store.steampowered.com/app/${appId}`,
      freeUntil: item.discount_expiration
        ? new Date(item.discount_expiration * 1000).toISOString()
        : null,
      imageUrl: item.header_image,
      isUpcoming: false,
    };

    const details = await fetchGameDetails(item.name);
    Object.assign(game, details);
    games.push(game);
  }

  // Also check Steam free-to-play games that are newly listed
  const f2pUrl =
    'https://store.steampowered.com/search/results/?query&start=0&count=10' +
    '&dynamic_data=&sort_by=Released_DESC&maxprice=free&category1=998' +
    '&snr=1_7_7_230_7&infinite=1';

  return games;
}

// ─────────────────────────────────────────────────────────────────────────────
// GOG (Galaxy)
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchGOGFreeGames() {
  const url =
    'https://catalog.gog.com/v1/catalog?limit=48&order=desc%3Atrendscore' +
    '&discounted=eq%3Atrue&priceTo=0&productType=in%3Agame%2Cpack' +
    '&page=1&countryCode=US&locale=en-US&currencyCode=USD';

  const res = await safeFetch(url);
  if (!res) return [];

  let data;
  try {
    data = await res.json();
  } catch {
    return [];
  }

  const games = [];
  for (const product of data?.products || []) {
    // Must be free (price == 0)
    const price = product.price?.finalMoney?.amount;
    if (price !== '0.00' && price !== '0') continue;

    const game = {
      id: `gog-${product.id || slugify(product.title)}`,
      platform: 'GOG',
      platformEmoji: '🎮',
      title: product.title,
      url: `https://www.gog.com${product.storeLink || `/game/${slugify(product.title)}`}`,
      freeUntil: product.price?.endDate || null,
      imageUrl: product.coverHorizontal || null,
      isUpcoming: false,
    };

    const details = await fetchGameDetails(product.title);
    Object.assign(game, details);
    games.push(game);
  }

  return games;
}

// ─────────────────────────────────────────────────────────────────────────────
// AMAZON PRIME GAMING
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchPrimeGamingFreeGames() {
  // Prime Gaming publishes a JSON feed
  const url =
    'https://gaming.amazon.com/home';

  // We use their internal Apollo/GraphQL API used by the website
  const apiUrl =
    'https://gaming.amazon.com/graphql?' +
    'operationName=getContentCards&variables=%7B%22pageType%22%3A%22home%22%7D' +
    '&extensions=%7B%22persistedQuery%22%3A%7B%22version%22%3A1%7D%7D';

  // Fallback: scrape their RSS-like JSON endpoint
  const feedUrl = 'https://gaming.amazon.com/api/offers?pageType=home';
  const res = await safeFetch(feedUrl, {
    headers: {
      'Accept': 'application/json',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });

  if (!res) return [];

  let data;
  try {
    data = await res.json();
  } catch {
    return [];
  }

  const games = [];
  const items = data?.offers || data?.items || [];

  for (const item of items) {
    if (item.offerType !== 'FREEBIE' && item.offerType !== 'GAME') continue;

    games.push({
      id: `prime-${item.id || slugify(item.title || item.gameTitle)}`,
      platform: 'Amazon Prime Gaming',
      platformEmoji: '👑',
      title: item.title || item.gameTitle,
      url: `https://gaming.amazon.com/home`,
      freeUntil: item.endTime || item.expirationDate || null,
      imageUrl: item.thumbnailUrl || null,
      isUpcoming: false,
      rating: null,
      multiplayer: null,
    });
  }

  return games;
}

// ─────────────────────────────────────────────────────────────────────────────
// HUMBLE BUNDLE (free games section)
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchHumbleFreeGames() {
  const url = 'https://www.humblebundle.com/store/api/search?request=1&sort=discount&genre=free&platform=windows';

  const res = await safeFetch(url);
  if (!res) return [];

  let data;
  try {
    data = await res.json();
  } catch {
    return [];
  }

  const games = [];
  const results = data?.results || [];

  for (const item of results) {
    if (item.current_price?.amount !== 0 && item.current_price?.amount !== '0') continue;

    const game = {
      id: `humble-${item.human_url || slugify(item.human_name)}`,
      platform: 'Humble Bundle',
      platformEmoji: '🤲',
      title: item.human_name,
      url: `https://www.humblebundle.com/store/${item.human_url}`,
      freeUntil: item.sale_end || null,
      imageUrl: item.image || null,
      isUpcoming: false,
    };

    const details = await fetchGameDetails(item.human_name);
    Object.assign(game, details);
    games.push(game);
  }

  return games;
}

// ─────────────────────────────────────────────────────────────────────────────
// INDIEGALA
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchIndieGalaFreeGames() {
  const url = 'https://freegames.indiegala.com/';
  // IndieGala serves a JSON payload on their freegames page
  const apiUrl = 'https://www.indiegala.com/store/ajax/showcase_giveaway_content?page=1';

  const res = await safeFetch(apiUrl);
  if (!res) return [];

  let data;
  try {
    data = await res.json();
  } catch {
    return [];
  }

  const games = [];
  const items = data?.html ? [] : (data?.items || data?.products || []);

  for (const item of items) {
    const game = {
      id: `indiegala-${item.prod_dev_namespace || slugify(item.prod_name)}`,
      platform: 'IndieGala',
      platformEmoji: '🎁',
      title: item.prod_name,
      url: item.prod_url || 'https://freegames.indiegala.com/',
      freeUntil: item.giveaway_expires || null,
      imageUrl: item.prod_cover || null,
      isUpcoming: false,
      rating: null,
      multiplayer: null,
    };

    games.push(game);
  }

  return games;
}

// ─────────────────────────────────────────────────────────────────────────────
// UBISOFT CONNECT
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchUbisoftFreeGames() {
  // Ubisoft doesn't have a public API but regularly posts free games
  // We use their store search filtered to free
  const url =
    'https://store.ubisoft.com/us/api/search?query=*&start=0&limit=20' +
    '&price_min=0&price_max=0&sort=pubdate+desc&view=grid';

  const res = await safeFetch(url);
  if (!res) return [];

  let data;
  try {
    data = await res.json();
  } catch {
    return [];
  }

  const games = [];
  for (const item of data?.items || data?.products || []) {
    const price = parseFloat(item.price || item.listPrice || '1');
    if (price !== 0) continue;

    const game = {
      id: `ubisoft-${item.id || slugify(item.name)}`,
      platform: 'Ubisoft Connect',
      platformEmoji: '🔷',
      title: item.name,
      url: item.url || 'https://store.ubisoft.com/us/',
      freeUntil: item.saleEndDate || null,
      imageUrl: item.image || null,
      isUpcoming: false,
    };

    const details = await fetchGameDetails(item.name);
    Object.assign(game, details);
    games.push(game);
  }

  return games;
}

// ─────────────────────────────────────────────────────────────────────────────
// Master function — runs all scrapers
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchAllFreeGames() {
  console.log('[Scrapers] Fetching free games from all platforms...');

  const scrapers = [
    { name: 'Epic Games',         fn: fetchEpicFreeGames },
    { name: 'Steam',              fn: fetchSteamFreeGames },
    { name: 'GOG',                fn: fetchGOGFreeGames },
    { name: 'Amazon Prime',       fn: fetchPrimeGamingFreeGames },
    { name: 'Humble Bundle',      fn: fetchHumbleFreeGames },
    { name: 'IndieGala',          fn: fetchIndieGalaFreeGames },
    { name: 'Ubisoft Connect',    fn: fetchUbisoftFreeGames },
  ];

  const results = await Promise.allSettled(
    scrapers.map(s =>
      s.fn().then(games => {
        console.log(`[Scrapers] ${s.name}: found ${games.length} free game(s)`);
        return games;
      }).catch(err => {
        console.error(`[Scrapers] ${s.name} error: ${err.message}`);
        return [];
      })
    )
  );

  const allGames = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
  console.log(`[Scrapers] Total free games found: ${allGames.length}`);
  return allGames;
}
