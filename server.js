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

// ── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'KC ISP Navigator Proxy',
    endpoints: ['/api/geocode', '/api/block'],
    version: '2.0.0'
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
        vintage: 'Current_Current',
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
    const blocks = match.geographies?.['Census Blocks'];

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

// ── START ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`KC ISP Navigator Proxy running on port ${PORT}`);
});
