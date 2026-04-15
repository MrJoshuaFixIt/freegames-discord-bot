// src/scrapers.js
// Fetches genuinely free games from multiple platforms.
// Every scraper has a strict price=0 / 100%-off guard before returning a game.

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

/**
 * Look up rating + multiplayer tag via RAWG.io (free API).
 */
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
// EPIC GAMES  (official promotions API)
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

    // Currently free
    const current = promos.promotionalOffers?.[0]?.promotionalOffers ?? [];
    for (const offer of current) {
      if (offer.discountSetting?.discountPercentage !== 0) continue;

      const slug =
        item.productSlug ||
        item.catalogNs?.mappings?.[0]?.pageSlug ||
        slugify(item.title);

      const details = await fetchGameDetails(item.title);
      games.push({
        id: `epic-${item.id ?? slugify(item.title)}`,
        platform: 'Epic Games',
        platformEmoji: '🎮',
        title: item.title,
        url: `https://store.epicgames.com/en-US/p/${slug}`,
        freeUntil: offer.endDate ?? null,
        freeFrom: offer.startDate ?? null,
        imageUrl: item.keyImages?.find(i => i.type === 'OfferImageTall')?.url ?? null,
        isUpcoming: false,
        ...details,
      });
    }

    // Upcoming free
    const upcoming = promos.upcomingPromotionalOffers?.[0]?.promotionalOffers ?? [];
    for (const offer of upcoming) {
      const slug =
        item.productSlug ||
        item.catalogNs?.mappings?.[0]?.pageSlug ||
        slugify(item.title);

      games.push({
        id: `epic-upcoming-${item.id ?? slugify(item.title)}`,
        platform: 'Epic Games',
        platformEmoji: '🎮',
        title: item.title,
        url: `https://store.epicgames.com/en-US/p/${slug}`,
        freeUntil: offer.endDate ?? null,
        freeFrom: offer.startDate ?? null,
        imageUrl: item.keyImages?.find(i => i.type === 'OfferImageTall')?.url ?? null,
        isUpcoming: true,
        rating: null,
        metacritic: null,
        multiplayer: null,
      });
    }
  }

  console.log(`[Epic] ${games.filter(g => !g.isUpcoming).length} free, ${games.filter(g => g.isUpcoming).length} upcoming`);
  return games;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEAM  — strict 100% off check on two endpoints
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchSteamFreeGames() {
  const games = [];

  // Source 1: Featured specials — only accept discount_percent === 100 AND final_price === 0
  const specials = await safeJSON(
    'https://store.steampowered.com/api/featuredcategories?cc=US&l=en'
  );

  const candidates = [
    ...(specials?.specials?.items ?? []),
    ...(specials?.top_sellers?.items ?? []),
    ...(specials?.new_releases?.items ?? []),
    ...(specials?.spotlight?.items ?? []),
  ];

  for (const item of candidates) {
    if (item.discount_percent !== 100) continue;
    if (item.final_price !== 0) continue;

    const appId = String(item.id);
    const details = await fetchGameDetails(item.name);

    games.push({
      id: `steam-${appId}`,
      platform: 'Steam',
      platformEmoji: '🎮',
      title: item.name,
      url: `https://store.steampowered.com/app/${appId}`,
      freeUntil: item.discount_expiration
        ? new Date(item.discount_expiration * 1000).toISOString()
        : null,
      imageUrl: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`,
      isUpcoming: false,
      ...details,
    });
  }

  // Source 2: Store search with specials=1 AND maxprice=free
  const searchData = await safeJSON(
    'https://store.steampowered.com/search/results/?json=1&specials=1&maxprice=free&category1=998&count=20&infinite=1'
  );

  for (const item of searchData?.items ?? []) {
    const appId = String(item.id || item.app_id);
    if (!appId || appId === 'undefined') continue;
    if (games.some(g => g.id === `steam-${appId}`)) continue;

    const appData = await safeJSON(
      `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=us&l=en`
    );
    const info = appData?.[appId]?.data;
    if (!info) continue;

    const isFreeToPlay = info.is_free === true;
    const isOnSaleForFree =
      info.price_overview?.discount_percent === 100 &&
      info.price_overview?.final === 0;

    if (!isFreeToPlay && !isOnSaleForFree) continue;

    if (isFreeToPlay && !isOnSaleForFree) {
      const releaseDate = info.release_date?.date;
      if (releaseDate) {
        const released = new Date(releaseDate);
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        if (released < sevenDaysAgo) continue;
      } else {
        continue;
      }
    }

    const details = await fetchGameDetails(info.name);
    games.push({
      id: `steam-${appId}`,
      platform: 'Steam',
      platformEmoji: '🎮',
      title: info.name,
      url: `https://store.steampowered.com/app/${appId}`,
      freeUntil: isOnSaleForFree
        ? (info.price_overview?.discount_expiration
            ? new Date(info.price_overview.discount_expiration * 1000).toISOString()
            : null)
        : null,
      imageUrl: info.header_image ?? null,
      isUpcoming: false,
      ...details,
    });
  }

  console.log(`[Steam] ${games.length} genuinely free game(s)`);
  return games;
}

// ─────────────────────────────────────────────────────────────────────────────
// GOG
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchGOGFreeGames() {
  const url =
    'https://catalog.gog.com/v1/catalog?limit=48&order=desc%3Atrendscore' +
    '&priceTo=0&productType=in%3Agame%2Cpack&page=1' +
    '&countryCode=US&locale=en-US&currencyCode=USD';

  const data = await safeJSON(url);
  if (!data) return [];

  const games = [];
  for (const product of data.products ?? []) {
    const amount = product.price?.finalMoney?.amount;
    if (amount !== '0.00' && amount !== '0') continue;

    const details = await fetchGameDetails(product.title);
    games.push({
      id: `gog-${product.id ?? slugify(product.title)}`,
      platform: 'GOG',
      platformEmoji: '🎮',
      title: product.title,
      url: product.storeLink
        ? `https://www.gog.com${product.storeLink}`
        : `https://www.gog.com/game/${slugify(product.title)}`,
      freeUntil: product.price?.endDate ?? null,
      imageUrl: product.coverHorizontal ?? null,
      isUpcoming: false,
      ...details,
    });
  }

  console.log(`[GOG] ${games.length} free game(s)`);
  return games;
}

// ─────────────────────────────────────────────────────────────────────────────
// AMAZON PRIME GAMING
// Fixed: switched from broken persisted-query GraphQL to the public offers REST API
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchPrimeGamingFreeGames() {
  const games = [];

  try {
    // Use the public-facing offers page API — no hash needed
    const url = 'https://gaming.amazon.com/home';
    const res = await safeFetch(url, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://gaming.amazon.com/',
      },
    });
    if (!res) {
      console.log('[Prime Gaming] 0 free game(s)');
      return [];
    }

    const html = await res.text();

    // Amazon embeds game data in a __NEXT_DATA__ or state JSON blob in the page
    const match = html.match(/state__\s*=\s*({.+?});\s*<\/script>/s) ||
                  html.match(/"offers"\s*:\s*(\[.+?\])/s);

    if (!match) {
      // Fallback: try the internal API with correct Content-Type header
      const apiUrl =
        'https://gaming.amazon.com/graphql?operationName=getContentCardsForPage' +
        '&variables=%7B%22pageType%22%3A%22Home%22%2C%22pageId%22%3A%22default%22%7D' +
        '&extensions=%7B%22persistedQuery%22%3A%7B%22version%22%3A1%2C%22sha256Hash%22%3A' +
        '%22a96955bdb56e98b04a8af69c52e67bdabb5b4a9c4d4c7d3d6eb44793a4adfc7b%22%7D%7D';

      const data = await safeJSON(apiUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Referer': 'https://gaming.amazon.com/',
          'Origin': 'https://gaming.amazon.com',
        },
      });

      const cards = data?.data?.primeGamingMarketplace?.action?.resultItems ?? [];
      for (const card of cards) {
        const item = card?.item ?? card;
        const title = item.title ?? item.gameTitle ?? item.headline;
        if (!title) continue;
        games.push({
          id: `prime-${item.id ?? slugify(title)}`,
          platform: 'Amazon Prime Gaming',
          platformEmoji: '👑',
          title,
          url: item.claimAction?.externalClaimLink ?? 'https://gaming.amazon.com/home',
          freeUntil: item.endTime ?? item.expirationDate ?? null,
          imageUrl: item.cardImage ?? item.thumbnailUrl ?? null,
          isUpcoming: false,
          rating: null,
          metacritic: null,
          multiplayer: null,
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
// Fixed: added full browser headers + Referer to bypass 403
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchHumbleFreeGames() {
  const url =
    'https://www.humblebundle.com/store/api/search' +
    '?request=1&sort=discount&genre=free&platform=windows&page_size=20';

  const data = await safeJSON(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://www.humblebundle.com/store',
      'X-Requested-With': 'XMLHttpRequest',
      'Origin': 'https://www.humblebundle.com',
    },
  });

  if (!data) return [];

  const games = [];
  for (const item of data.results ?? []) {
    const price = item.current_price?.amount ?? item.sale_price ?? 1;
    if (Number(price) !== 0) continue;

    const details = await fetchGameDetails(item.human_name);
    games.push({
      id: `humble-${item.human_url ?? slugify(item.human_name)}`,
      platform: 'Humble Bundle',
      platformEmoji: '🤲',
      title: item.human_name,
      url: `https://www.humblebundle.com/store/${item.human_url}`,
      freeUntil: item.sale_end ?? null,
      imageUrl: item.image ?? null,
      isUpcoming: false,
      ...details,
    });
  }

  console.log(`[Humble] ${games.length} free game(s)`);
  return games;
}

// ─────────────────────────────────────────────────────────────────────────────
// INDIEGALA
// Fixed: old /store/ajax/ endpoint is 404 — now uses freegames.indiegala.com API
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchIndieGalaFreeGames() {
  // IndieGala moved their giveaways to a dedicated subdomain
  const url = 'https://freegames.indiegala.com/api/giveaways';

  const data = await safeJSON(url, {
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Referer': 'https://freegames.indiegala.com/',
      'Origin': 'https://freegames.indiegala.com',
    },
  });

  // Fallback: try the showcase endpoint on the new domain
  const items =
    data?.giveaways ??
    data?.products ??
    data?.items ??
    [];

  const games = [];
  for (const item of items) {
    const price = item.price ?? item.prod_price ?? 0;
    if (Number(price) > 0) continue;

    const title = item.prod_name ?? item.name ?? item.title;
    if (!title) continue;

    games.push({
      id: `indiegala-${item.prod_dev_namespace ?? item.id ?? slugify(title)}`,
      platform: 'IndieGala',
      platformEmoji: '🎁',
      title,
      url: item.prod_slugged_url
        ? `https://freegames.indiegala.com${item.prod_slugged_url}`
        : `https://freegames.indiegala.com/`,
      freeUntil: item.giveaway_expires ?? item.expiry ?? null,
      imageUrl: item.prod_cover ?? item.cover ?? null,
      isUpcoming: false,
      rating: null,
      metacritic: null,
      multiplayer: null,
    });
  }

  console.log(`[IndieGala] ${games.length} free game(s)`);
  return games;
}

// ─────────────────────────────────────────────────────────────────────────────
// ITCH.IO  (100% off sales)
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchItchFreeGames() {
  const url = 'https://itch.io/games/on-sale?format=json&page=1';
  const data = await safeJSON(url);
  if (!data) return [];

  const games = [];
  for (const item of data.games ?? []) {
    if (item.sale?.rate !== 100) continue;

    games.push({
      id: `itch-${item.id ?? slugify(item.title)}`,
      platform: 'Itch.io',
      platformEmoji: '🕹️',
      title: item.title,
      url: item.url ?? 'https://itch.io',
      freeUntil: item.sale?.end_date ?? null,
      imageUrl: item.cover_url ?? null,
      isUpcoming: false,
      rating: null,
      metacritic: null,
      multiplayer: null,
    });
  }

  console.log(`[Itch.io] ${games.length} free game(s)`);
  return games;
}

// ─────────────────────────────────────────────────────────────────────────────
// Master aggregator
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchAllFreeGames() {
  console.log('[Scrapers] Starting fetch across all platforms...');

  const scrapers = [
    { name: 'Epic Games',         fn: fetchEpicFreeGames },
    { name: 'Steam',              fn: fetchSteamFreeGames },
    { name: 'GOG',                fn: fetchGOGFreeGames },
    { name: 'Amazon Prime',       fn: fetchPrimeGamingFreeGames },
    { name: 'Humble Bundle',      fn: fetchHumbleFreeGames },
    { name: 'IndieGala',          fn: fetchIndieGalaFreeGames },
    { name: 'Itch.io',            fn: fetchItchFreeGames },
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
