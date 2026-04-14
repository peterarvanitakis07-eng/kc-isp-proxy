// server.js - KC ISP Navigator Proxy Server
// Handles CORS-bypassing calls to Census geocoding APIs
// Deployed on Railway.app

const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ── ROOT ─────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'KC ISP Navigator Proxy',
    endpoints: ['/api/geocode', '/api/block', '/api/lookup', '/api/live-prices', '/api/health'],
    version: '3.0.0'
  });
});

// ── ENDPOINT 1: Address → lat/long + county (existing) ───────────────────────
// Usage: /api/geocode?address=1801+Linwood+Blvd&city=Kansas+City&state=MO&zip=64109
app.get('/api/geocode', async (req, res) => {
  const { address, city, state, zip } = req.query;

  if (!address || !city || !zip) {
    return res.status(400).json({ success: false, message: 'address, city, and zip are required' });
  }

  try {
    const censusUrl = 'https://geocoding.geo.census.gov/geocoder/locations/address';
    const response = await axios.get(censusUrl, {
      params: {
        street: address,
        city: city,
        state: state || '',
        zip: zip,
        benchmark: 'Public_AR_Current',
        format: 'json'
      },
      timeout: 10000
    });

    const matches = response.data?.result?.addressMatches;
    if (!matches || matches.length === 0) {
      return res.json({ success: false, message: 'Address not found' });
    }

    const match = matches[0];
    const coords = match.coordinates;
    const addrComponents = match.addressComponents;

    // Determine state from ZIP for county lookup
    const zipCode = zip.toString();
    const stateCode = (parseInt(zipCode) >= 66000 && parseInt(zipCode) <= 67999) ? 'KS' : 'MO';

    // Build FCC verification URL using coordinates
    const fccUrl = `https://broadbandmap.fcc.gov/location-summary/fixed?location_id=&addr=${encodeURIComponent(match.matchedAddress)}&unit=&lat=${coords.y}&lon=${coords.x}&zoom=14`;

    res.json({
      success: true,
      address: {
        matched: match.matchedAddress,
        latitude: coords.y,
        longitude: coords.x,
      },
      geography: {
        county: {
          // County info comes from block lookup - see /api/block
          name: null
        },
        state: stateCode
      },
      fcc_verification_url: fccUrl
    });

  } catch (error) {
    console.error('Geocode error:', error.message);
    res.status(500).json({ success: false, message: 'Geocoding failed', error: error.message });
  }
});

// ── ENDPOINT 2: lat/long → Census Block GEOID (NEW) ──────────────────────────
// Usage: /api/block?lat=39.068312&lon=-94.562117
//
// Returns the 15-digit Census block GEOID which can be used to look up
// ISP availability in the block_isp_lookup.json file hosted on GitHub Pages.
//
// The GEOID format is: SS CCC TTTTTT BBBB
//   SS     = 2-digit state FIPS
//   CCC    = 3-digit county FIPS
//   TTTTTT = 6-digit census tract
//   BBBB   = 4-digit census block
//
app.get('/api/block', async (req, res) => {
  const { lat, lon } = req.query;

  if (!lat || !lon) {
    return res.status(400).json({ success: false, message: 'lat and lon are required' });
  }

  try {
    const censusUrl = 'https://geocoding.geo.census.gov/geocoder/geographies/coordinates';
    const response = await axios.get(censusUrl, {
      params: {
        x: lon,        // Census API uses x for longitude
        y: lat,        // Census API uses y for latitude
        benchmark: 'Public_AR_Current',
        vintage: 'Current_Current',
        layers: 'Census Blocks',
        format: 'json'
      },
      timeout: 10000
    });

    const geographies = response.data?.result?.geographies;
    const blocks = geographies?.['Census Blocks'];

    if (!blocks || blocks.length === 0) {
      return res.json({ success: false, message: 'No census block found for coordinates' });
    }

    const block = blocks[0];
    const geoid = block.GEOID;  // 15-digit block GEOID

    // Also extract county name and FIPS for display
    const stateFips = block.STATE;
    const countyFips = block.COUNTY;
    const tractFips = block.TRACT;
    const blockNum = block.BLOCK;

    res.json({
      success: true,
      block: {
        geoid: geoid,           // Full 15-digit GEOID - use this to look up ISPs
        state_fips: stateFips,
        county_fips: countyFips,
        tract: tractFips,
        block: blockNum,
        county_name: block.BASENAME || null  // Human-readable county name if available
      }
    });

  } catch (error) {
    console.error('Block lookup error:', error.message);
    res.status(500).json({ success: false, message: 'Block lookup failed', error: error.message });
  }
});

// ── ENDPOINT 3: Combined geocode + block (convenience) ───────────────────────
// Usage: /api/lookup?address=1801+Linwood+Blvd&city=Kansas+City&state=MO&zip=64109
// Returns lat/long + block GEOID in one call to reduce round trips
app.get('/api/lookup', async (req, res) => {
  const { address, city, state, zip } = req.query;

  if (!address || !city || !zip) {
    return res.status(400).json({ success: false, message: 'address, city, and zip are required' });
  }

  try {
    // Step 1: Geocode address to get coordinates + matched address
    const geoUrl = 'https://geocoding.geo.census.gov/geocoder/geographies/address';
    const geoResponse = await axios.get(geoUrl, {
      params: {
        street: address,
        city: city,
        state: state || '',
        zip: zip,
        benchmark: 'Public_AR_Current',
        vintage: 'Census2020_Current',
        layers: 'Census Blocks',
        format: 'json'
      },
      timeout: 15000
    });

    const matches = geoResponse.data?.result?.addressMatches;
    if (!matches || matches.length === 0) {
      return res.json({ success: false, message: 'Address not found. Try a nearby address or check spelling.' });
    }

    const match = matches[0];
    const coords = match.coordinates;
    const geos = match.geographies || {};
    // Debug: log what geography keys came back
    console.log('Geography keys returned:', Object.keys(geos));

    const blocks = geos['Census Blocks'] || 
                   geos['2020 Census Blocks'] ||
                   geos['Census Block Groups'] || [];

    if (!blocks || blocks.length === 0) {
      return res.json({ success: false, message: 'Address found but census block could not be determined.' });
    }

    const block = blocks[0];
    const geoid = block.GEOID;

    // Determine state
    const zipCode = zip.toString();
    const stateCode = (parseInt(zipCode) >= 66000 && parseInt(zipCode) <= 67999) ? 'KS' : 'MO';

    // FCC verification URL at exact coordinates
    const fccUrl = `https://broadbandmap.fcc.gov/location-summary/fixed?location_id=&addr=${encodeURIComponent(match.matchedAddress)}&unit=&lat=${coords.y}&lon=${coords.x}&zoom=14`;

    res.json({
      success: true,
      address: {
        matched: match.matchedAddress,
        latitude: coords.y,
        longitude: coords.x,
      },
      block: {
        geoid: geoid,           // ← Use this to look up ISPs in block_isp_lookup.json
        state_fips: block.STATE,
        county_fips: block.COUNTY,
        tract: block.TRACT,
        block: block.BLOCK,
      },
      geography: {
        state: stateCode,
      },
      fcc_verification_url: fccUrl
    });

  } catch (error) {
    console.error('Lookup error:', error.message);
    res.status(500).json({ success: false, message: 'Lookup failed', error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// ISP LIVE PRICE SCRAPERS
// Fetches real-time plan pricing from ISP websites.
// Privacy: address lookups are equivalent to a navigator manually
// visiting each ISP site — no extra data exposure beyond that.
// Bot detection may cause failures; UI falls back to static data.
// ═══════════════════════════════════════════════════════════════════

let chromium = null;
try {
  chromium = require('playwright').chromium;
  console.log('✓ Playwright loaded — live ISP price scraping enabled');
} catch (e) {
  console.warn('Playwright not available — /api/live-prices will return errors:', e.message);
}

// Shared browser instance — lazy-started, reused across requests
let _browser = null;
async function getBrowser() {
  if (!chromium) throw new Error('Playwright not installed on this server');
  if (!_browser || !_browser.isConnected()) {
    _browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox', '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', '--disable-gpu',
        '--disable-extensions', '--no-first-run'
      ]
    });
    console.log('Browser instance started');
  }
  return _browser;
}

const SCRAPER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const SCRAPER_TIMEOUT = 18000;

// ── Helper: fill an address input using multiple fallback selectors ──
async function fillAddressInput(page, fullAddress) {
  const candidates = [
    'input[aria-label*="address" i]',
    'input[placeholder*="address" i]',
    'input[name*="address" i]',
    'input[id*="address" i]',
    'input[data-testid*="address" i]',
    'input[class*="address" i]',
    'input[type="text"]:visible'
  ];
  for (const sel of candidates) {
    try {
      const el = await page.$(sel);
      if (el) { await el.fill(fullAddress); return true; }
    } catch (_) {}
  }
  return false;
}

// ── Helper: extract $XX/mo price chips from rendered DOM ──
function extractPrices(page) {
  return page.evaluate(() => {
    const results = [];
    const seen = new Set();
    document.querySelectorAll('*').forEach(el => {
      if (el.children.length > 0) return; // leaf nodes only
      const text = (el.textContent || '').trim();
      if (!/^\$\d/.test(text)) return;
      if (seen.has(text)) return;
      seen.add(text);
      const card = el.closest('[class*="plan"], [class*="tier"], [class*="package"], [class*="offer"], article, section, li');
      const name = card?.querySelector('h1,h2,h3,h4,[class*="name"],[class*="title"]')?.textContent?.trim();
      const speed = card?.querySelector('[class*="speed"],[class*="mbps"],[class*="gig"]')?.textContent?.trim();
      if (name || speed) {
        results.push({ price: text, name: name || 'Internet Plan', speed: speed || null });
      }
    });
    return results.slice(0, 8); // cap at 8 plans
  });
}

// ── AT&T: Direct REST API — confirmed working, no browser needed ──
async function scrapeATT(address, city, state, zip) {
  try {
    const { data } = await axios.post(
      'https://www.att.com/services/shop/model/ecom/shop/view/unified/qualification/service/CheckAvailabilityRESTService/invokeCheckAvailability',
      { userInputZip: zip, userInputAddressLine1: address, mode: 'fullAddress', customer_type: 'Consumer', dtvMigrationFlag: false },
      { headers: { 'Content-Type': 'application/json', 'User-Agent': SCRAPER_UA }, timeout: 12000 }
    );
    const p = data?.profile || data?.customerProfile || {};
    const fiber = !!(p.isGIGAFiberAvailable || p.isFiberAvailable);
    const dsl   = !!p.isDSLAvailable;
    const air   = !!p.isInternetAirAvailable;

    const plans = [];
    if (fiber) {
      plans.push({ name: 'Internet 300',  speed: '300 Mbps', price: '$55/mo' });
      plans.push({ name: 'Internet 1000', speed: '1 Gbps',   price: '$80/mo' });
      plans.push({ name: 'AT&T Access',   speed: '100 Mbps', price: '$10/mo', lowIncome: true, elig: 'SNAP, SSI, Medicaid, Free Lunch' });
    } else if (dsl) {
      plans.push({ name: 'Internet 10',       speed: '10 Mbps', price: '$55/mo' });
      plans.push({ name: 'AT&T Access (DSL)', speed: '10 Mbps', price: '$10/mo', lowIncome: true, elig: 'SNAP, SSI, Medicaid, Free Lunch' });
    } else if (air) {
      plans.push({ name: 'Internet Air', speed: 'Up to 25 Mbps', price: '$55/mo' });
    }

    return {
      isp: 'AT&T',
      status: plans.length ? 'available' : 'unavailable',
      source: 'api',
      serviceType: fiber ? 'fiber' : dsl ? 'dsl' : air ? 'wireless' : 'none',
      plans,
      ts: new Date().toISOString()
    };
  } catch (err) {
    return { isp: 'AT&T', status: 'error', source: 'api', error: err.message, plans: [] };
  }
}

// ── Spectrum: Playwright ──────────────────────────────────────────
async function scrapeSpectrum(address, city, state, zip) {
  const browser = await getBrowser();
  const ctx = await browser.newContext({ userAgent: SCRAPER_UA, locale: 'en-US' });
  const page = await ctx.newPage();
  try {
    await page.goto('https://www.spectrum.com/internet', { timeout: SCRAPER_TIMEOUT, waitUntil: 'domcontentloaded' });
    const filled = await fillAddressInput(page, `${address}, ${city}, ${state} ${zip}`);
    if (!filled) throw new Error('No address input found on Spectrum page');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(4000);
    const plans = await extractPrices(page);
    return { isp: 'Spectrum', status: plans.length ? 'available' : 'error', source: 'browser', plans, ts: new Date().toISOString() };
  } catch (err) {
    return { isp: 'Spectrum', status: 'error', source: 'browser', error: err.message, plans: [] };
  } finally {
    await ctx.close().catch(() => {});
  }
}

// ── Xfinity: Playwright ───────────────────────────────────────────
async function scrapeXfinity(address, city, state, zip) {
  const browser = await getBrowser();
  const ctx = await browser.newContext({ userAgent: SCRAPER_UA, locale: 'en-US' });
  const page = await ctx.newPage();
  try {
    await page.goto('https://www.xfinity.com/buy/internet', { timeout: SCRAPER_TIMEOUT, waitUntil: 'domcontentloaded' });
    const filled = await fillAddressInput(page, `${address}, ${city}, ${state} ${zip}`);
    if (!filled) throw new Error('No address input found on Xfinity page');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(4000);
    const plans = await extractPrices(page);
    return { isp: 'Xfinity', status: plans.length ? 'available' : 'error', source: 'browser', plans, ts: new Date().toISOString() };
  } catch (err) {
    return { isp: 'Xfinity', status: 'error', source: 'browser', error: err.message, plans: [] };
  } finally {
    await ctx.close().catch(() => {});
  }
}

// ── T-Mobile Home Internet: Playwright ───────────────────────────
async function scrapeTMobile(address, city, state, zip) {
  const browser = await getBrowser();
  const ctx = await browser.newContext({ userAgent: SCRAPER_UA, locale: 'en-US' });
  const page = await ctx.newPage();
  try {
    await page.goto('https://www.t-mobile.com/home-internet', { timeout: SCRAPER_TIMEOUT, waitUntil: 'domcontentloaded' });
    const filled = await fillAddressInput(page, `${address}, ${city}, ${state} ${zip}`);
    if (!filled) throw new Error('No address input found on T-Mobile page');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(4500);
    // T-Mobile shows availability message + a single plan price
    const result = await page.evaluate(() => {
      const body = document.body.textContent || '';
      const avail    = /great news|available at your address|home internet available/i.test(body);
      const notAvail = /not available|not supported|sorry/i.test(body);
      const priceMatch = body.match(/\$(\d+(?:\.\d+)?)\/mo/);
      return { avail, notAvail, price: priceMatch ? priceMatch[0] : null };
    });
    if (result.notAvail) {
      return { isp: 'T-Mobile', status: 'unavailable', source: 'browser', plans: [], ts: new Date().toISOString() };
    }
    return {
      isp: 'T-Mobile',
      status: result.avail ? 'available' : 'unknown',
      source: 'browser',
      plans: (result.avail && result.price)
        ? [{ name: 'T-Mobile Home Internet', speed: '33–245 Mbps', price: result.price }]
        : [],
      ts: new Date().toISOString()
    };
  } catch (err) {
    return { isp: 'T-Mobile', status: 'error', source: 'browser', error: err.message, plans: [] };
  } finally {
    await ctx.close().catch(() => {});
  }
}

// ── Starlink: direct coordinate API (no browser) ─────────────────
// Uses lat/lon from the geocoding step — no address re-entry needed
async function scrapeStarlink(lat, lon) {
  if (!lat || !lon) return { isp: 'Starlink', status: 'error', source: 'api', error: 'No coordinates provided', plans: [] };
  try {
    const { data } = await axios.post(
      'https://www.starlink.com/api/shared/starlink/eligibility',
      { lat: parseFloat(lat), lng: parseFloat(lon) },
      { headers: { 'Content-Type': 'application/json', 'User-Agent': SCRAPER_UA, 'Origin': 'https://www.starlink.com', 'Referer': 'https://www.starlink.com/' }, timeout: 10000 }
    );
    const available = !!(data?.eligible || data?.available || data?.availability?.available || data?.isEligible);
    return {
      isp: 'Starlink',
      status: available ? 'available' : 'unavailable',
      source: 'api',
      plans: available ? [{ name: 'Starlink Residential', speed: '25–220 Mbps', price: '$120/mo', note: 'Equipment: $599 one-time or rental available' }] : [],
      ts: new Date().toISOString()
    };
  } catch (err) {
    return { isp: 'Starlink', status: 'error', source: 'api', error: err.message, plans: [] };
  }
}

// ── Cox Communications: Playwright ───────────────────────────────
async function scrapeCox(address, city, state, zip) {
  const browser = await getBrowser();
  const ctx = await browser.newContext({ userAgent: SCRAPER_UA, locale: 'en-US' });
  const page = await ctx.newPage();
  try {
    await page.goto('https://www.cox.com/residential/internet.html', { timeout: SCRAPER_TIMEOUT, waitUntil: 'domcontentloaded' });
    const filled = await fillAddressInput(page, `${address}, ${city}, ${state} ${zip}`);
    if (!filled) throw new Error('No address input found on Cox page');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(4000);
    const plans = await extractPrices(page);
    return { isp: 'Cox', status: plans.length ? 'available' : 'error', source: 'browser', plans, ts: new Date().toISOString() };
  } catch (err) {
    return { isp: 'Cox', status: 'error', source: 'browser', error: err.message, plans: [] };
  } finally {
    await ctx.close().catch(() => {});
  }
}

// ── /api/health ───────────────────────────────────────────────────
// Tests AT&T API reachability using KCDD's own address (public).
// Set this as Railway's health check URL.
app.get('/api/health', async (req, res) => {
  try {
    const result = await scrapeATT('1801 Linwood Blvd', 'Kansas City', 'MO', '64109');
    res.json({
      status: 'ok',
      attApi: result.status !== 'error' ? 'reachable' : 'error',
      attResult: result.status,
      playwright: chromium ? 'loaded' : 'unavailable',
      ts: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ status: 'degraded', error: err.message, ts: new Date().toISOString() });
  }
});

// ── /api/live-prices ──────────────────────────────────────────────
// Usage: /api/live-prices?address=...&city=...&state=...&zip=...&isps=att,spectrum,xfinity,tmobile,starlink,cox&lat=39.07&lon=-94.56
app.get('/api/live-prices', async (req, res) => {
  const { address, city, state, zip, isps, lat, lon } = req.query;
  if (!address || !city || !zip) {
    return res.status(400).json({ success: false, message: 'address, city, and zip are required' });
  }

  const requested = isps
    ? isps.toLowerCase().split(',').map(s => s.trim())
    : ['att', 'spectrum', 'xfinity', 'tmobile'];

  const scraperMap = {
    att:      () => scrapeATT(address, city, state || 'MO', zip),
    spectrum: () => scrapeSpectrum(address, city, state || 'MO', zip),
    xfinity:  () => scrapeXfinity(address, city, state || 'MO', zip),
    tmobile:  () => scrapeTMobile(address, city, state || 'MO', zip),
    starlink: () => scrapeStarlink(lat, lon),
    cox:      () => scrapeCox(address, city, state || 'MO', zip),
  };

  const tasks = requested.filter(k => scraperMap[k]).map(k => scraperMap[k]());
  if (tasks.length === 0) return res.json({ success: true, results: [] });

  try {
    const settled = await Promise.race([
      Promise.allSettled(tasks),
      new Promise(resolve => setTimeout(() => resolve(null), 25000))
    ]);
    const results = (settled || []).map(r =>
      r?.status === 'fulfilled' ? r.value : { status: 'timeout', plans: [], error: 'Timed out' }
    );
    console.log('live-prices:', results.map(r => `${r.isp}:${r.status}`).join(', '));
    res.json({ success: true, results });
  } catch (err) {
    console.error('live-prices error:', err.message);
    res.status(500).json({ success: false, message: 'Price lookup failed', error: err.message });
  }
});

// ── START ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`KC ISP Navigator Proxy running on port ${PORT}`);
});
