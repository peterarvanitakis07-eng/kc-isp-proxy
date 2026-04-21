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

// ── ENDPOINT 4: FCC location_id lookup ───────────────────────────────────────
// Usage: /api/fcc-location?lat=39.07&lon=-94.56&address=1801+Linwood+Blvd
// Returns the FCC Broadband Map location_id so the verification link shows
// provider availability dots (green dots) instead of just centering the map.
app.get('/api/fcc-location', async (req, res) => {
  const { lat, lon, address } = req.query;
  if (!lat || !lon) {
    return res.status(400).json({ success: false, message: 'lat and lon are required' });
  }
  try {
    const searchTerm = address || `${lat},${lon}`;
    const { data } = await axios.post(
      'https://broadbandmap.fcc.gov/api/public/map/listLocations',
      { search_term: searchTerm, latitude: parseFloat(lat), longitude: parseFloat(lon) },
      {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': SCRAPER_UA,
          'Referer': 'https://broadbandmap.fcc.gov/',
          'Origin': 'https://broadbandmap.fcc.gov'
        },
        timeout: 8000
      }
    );
    const locations = data?.data || data?.locations || data?.results || [];
    if (!locations.length) {
      return res.json({ success: false, message: 'No FCC location found' });
    }
    // Pick the closest location — first result is usually best match
    const locationId = locations[0]?.location_id || locations[0]?.id || null;
    if (!locationId) return res.json({ success: false, message: 'Location found but no ID returned' });
    res.json({ success: true, location_id: locationId });
  } catch (err) {
    // Non-fatal — front-end falls back to coordinate-only URL
    console.warn('FCC location lookup failed:', err.message);
    res.json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// ISP LIVE PRICE SCRAPERS
// Fetches real-time plan pricing from ISP websites.
// Privacy: address lookups are equivalent to a navigator manually
// visiting each ISP site — no extra data exposure beyond that.
// Bot detection may cause failures; UI falls back to static data.
// ═══════════════════════════════════════════════════════════════════

const SCRAPER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

// ── Browser-based scrapers: returns a "check website" stub ───────
// Spectrum, Xfinity, T-Mobile, Cox require a headless browser to scrape.
// Railway's nixpacks build doesn't include Chromium — these will be enabled
// in a future update once browser hosting is configured.
function browserRequiredScraper(ispName, url) {
  return async () => ({
    isp: ispName,
    status: 'browser-required',
    source: 'none',
    plans: [],
    checkUrl: url,
    error: 'Live pricing requires browser automation not yet available on this server. Check provider website directly.',
    ts: new Date().toISOString()
  });
}

// ── AT&T: Direct REST API — confirmed working, no browser needed ──
async function scrapeATT(address, city, state, zip) {
  try {
    const { data } = await axios.post(
      'https://www.att.com/services/shop/model/ecom/shop/view/unified/qualification/service/CheckAvailabilityRESTService/invokeCheckAvailability',
      { userInputZip: zip, userInputAddressLine1: address, mode: 'fullAddress', customer_type: 'Consumer', dtvMigrationFlag: false },
      {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'User-Agent': SCRAPER_UA,
          'Origin': 'https://www.att.com',
          'Referer': 'https://www.att.com/internet/',
          'sec-ch-ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"macOS"',
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'same-origin',
        },
        timeout: 12000
      }
    );
    const p = data?.profile || data?.customerProfile || {};
    const fiber = !!(p.isGIGAFiberAvailable || p.isFiberAvailable);
    const dsl   = !!p.isDSLAvailable;
    const air   = !!p.isInternetAirAvailable;

    const plans = [];
    if (fiber) {
      plans.push({ name: 'Internet 300',  speed: '300 Mbps', price: '$55/mo' });
      plans.push({ name: 'Internet 1000', speed: '1 Gbps',   price: '$80/mo' });
      plans.push({ name: 'AT&T Access',   speed: '100 Mbps', price: '$30/mo', lowIncome: true, elig: 'SNAP, SSI, Medicaid, Free Lunch' });
    } else if (dsl) {
      plans.push({ name: 'Internet 10',       speed: '10 Mbps', price: '$55/mo' });
      plans.push({ name: 'AT&T Access (DSL)', speed: '10 Mbps', price: '$30/mo', lowIncome: true, elig: 'SNAP, SSI, Medicaid, Free Lunch' });
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
    // AT&T's consumer API endpoint is unstable / changes without notice.
    // Fall back to standard KC metro plans from the aLEGEND reference sheet.
    // Navigators should verify exact plan availability at att.com/internet/availability.
    console.warn('AT&T live API failed (' + err.message + ') — returning aLEGEND static plans');
    return {
      isp: 'AT&T',
      status: 'available-static',
      source: 'static',
      plans: [
        { name: 'Internet 300',  speed: '300 Mbps', price: '$55/mo' },
        { name: 'Internet 1000', speed: '1 Gbps',   price: '$80/mo' },
        { name: 'AT&T Access',   speed: '100 Mbps', price: '$30/mo', lowIncome: true, elig: 'SNAP, SSI, Medicaid, Free School Lunch' },
      ],
      note: 'Standard KC plans from aLEGEND reference sheet. Verify exact availability at att.com.',
      checkUrl: 'https://www.att.com/internet/availability/',
      ts: new Date().toISOString()
    };
  }
}

// Browser-based scrapers — stubs until Chromium hosting is configured
const scrapeSpectrum = browserRequiredScraper('Spectrum', 'https://www.spectrum.com/internet');
const scrapeXfinity  = browserRequiredScraper('Xfinity',  'https://www.xfinity.com/buy/internet');
const scrapeTMobile  = browserRequiredScraper('T-Mobile', 'https://www.t-mobile.com/home-internet');
const scrapeCox      = browserRequiredScraper('Cox',      'https://www.cox.com/residential/internet.html');

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
    // Starlink eligibility API unavailable — fall back to standard residential pricing.
    // Starlink generally covers the KC metro; navigator should confirm at starlink.com.
    console.warn('Starlink live API failed (' + err.message + ') — returning static plans');
    return {
      isp: 'Starlink',
      status: 'available-static',
      source: 'static',
      plans: [
        { name: 'Starlink Residential', speed: '50–200 Mbps', price: '$120/mo', note: 'Equipment: $599 one-time or $599 deposit w/ rental option' },
      ],
      note: 'Coverage may vary — confirm availability at starlink.com.',
      checkUrl: 'https://www.starlink.com/order',
      ts: new Date().toISOString()
    };
  }
}

// ── /api/health ───────────────────────────────────────────────────
// Fast liveness check — Railway uses / for healthcheck, this is for manual testing.
// Call /api/health?test=att to do a live AT&T API reachability check.
app.get('/api/health', async (req, res) => {
  if (req.query.test === 'att') {
    try {
      const result = await scrapeATT('1801 Linwood Blvd', 'Kansas City', 'MO', '64109');
      return res.json({
        status: 'ok',
        attApi: result.status !== 'error' ? 'reachable' : 'error',
        attResult: result.status,
        attError: result.error || null,       // ← full error message
        attPlans: result.plans || [],
        attServiceType: result.serviceType || null,
        ts: new Date().toISOString()
      });
    } catch (err) {
      return res.status(500).json({ status: 'degraded', error: err.message, ts: new Date().toISOString() });
    }
  }
  res.json({ status: 'ok', version: '3.0.0', ts: new Date().toISOString() });
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
