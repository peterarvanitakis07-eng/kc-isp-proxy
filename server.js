const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all origins (your GitHub Pages site can call this)
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Address Geocoding & ISP Lookup Proxy for KC ISP Navigator',
    description: 'Geocodes addresses and queries FCC for exact address-level ISP availability',
    endpoints: {
      geocode: '/api/geocode?address=STREET&city=CITY&state=STATE&zip=ZIP',
      isp_lookup: '/api/isp-lookup?address=STREET&city=CITY&state=STATE&zip=ZIP'
    },
    example: '/api/isp-lookup?address=1801%20Linwood%20Blvd&city=Kansas%20City&state=MO&zip=64109'
  });
});

// Main proxy endpoint for address geocoding
// Returns county/block info that can be used with local ISP data
app.get('/api/geocode', async (req, res) => {
  try {
    const { address, city, state, zip } = req.query;

    if (!address || !city || !state || !zip) {
      return res.status(400).json({ 
        error: 'Missing required parameters',
        required: ['address', 'city', 'state', 'zip']
      });
    }

    // Geocode the address using Census API (always works, no CORS)
    const geocodeUrl = `https://geocoding.geo.census.gov/geocoder/geographies/address`;
    const geocodeParams = {
      street: address,
      city: city,
      state: state,
      zip: zip,
      benchmark: 'Public_AR_Current',
      vintage: 'Current_Current',
      format: 'json'
    };

    console.log('Geocoding address:', { address, city, state, zip });
    
    const geocodeResponse = await axios.get(geocodeUrl, { params: geocodeParams });
    
    if (!geocodeResponse.data.result.addressMatches || 
        geocodeResponse.data.result.addressMatches.length === 0) {
      return res.status(404).json({ 
        error: 'Address not found',
        message: 'Could not geocode the provided address. Please verify the address is correct.'
      });
    }

    const match = geocodeResponse.data.result.addressMatches[0];
    const { x: longitude, y: latitude } = match.coordinates;
    const block = match.geographies['Census Blocks']?.[0];
    const county = match.geographies['Counties']?.[0];

    // Extract useful geography info
    const result = {
      success: true,
      address: {
        input: `${address}, ${city}, ${state} ${zip}`,
        matched: match.matchedAddress,
        latitude: parseFloat(latitude).toFixed(6),
        longitude: parseFloat(longitude).toFixed(6)
      },
      geography: {
        state: block?.STATE || county?.STATE || state,
        county: {
          name: county?.NAME,
          fips: county?.COUNTY
        },
        block: {
          fips: block?.GEOID,
          tract: block?.TRACT,
          block: block?.BLOCK
        }
      },
      fcc_verification_url: `https://broadbandmap.fcc.gov/location-summary?version=latest&lat=${latitude}&lon=${longitude}&zoom=17.00`
    };

    console.log('Geocoded successfully:', result);

    res.json(result);

  } catch (error) {
    console.error('Error in geocode:', error.message);
    
    res.status(500).json({ 
      error: 'Server error',
      message: error.message,
      details: error.response?.data || 'No additional details'
    });
  }
});

// NEW ENDPOINT: ISP Lookup - Geocodes address and queries FCC for exact ISP availability
app.get('/api/isp-lookup', async (req, res) => {
  try {
    const { address, city, state, zip } = req.query;

    if (!address || !city || !state || !zip) {
      return res.status(400).json({ 
        error: 'Missing required parameters',
        required: ['address', 'city', 'state', 'zip']
      });
    }

    // Step 1: Geocode the address
    const geocodeUrl = `https://geocoding.geo.census.gov/geocoder/geographies/address`;
    const geocodeParams = {
      street: address,
      city: city,
      state: state,
      zip: zip,
      benchmark: 'Public_AR_Current',
      vintage: 'Current_Current',
      format: 'json'
    };

    console.log('ISP Lookup - Geocoding address:', { address, city, state, zip });
    
    const geocodeResponse = await axios.get(geocodeUrl, { params: geocodeParams });
    
    if (!geocodeResponse.data.result.addressMatches || 
        geocodeResponse.data.result.addressMatches.length === 0) {
      return res.status(404).json({ 
        error: 'Address not found',
        message: 'Could not geocode the provided address. Please verify the address is correct.'
      });
    }

    const match = geocodeResponse.data.result.addressMatches[0];
    const { x: longitude, y: latitude } = match.coordinates;
    const block = match.geographies['Census Blocks']?.[0];
    const county = match.geographies['Counties']?.[0];

    console.log('Geocoded to:', { latitude, longitude, block: block?.GEOID });

    // Step 2: Query FCC BDC API for ISP availability at this location
    // FCC API endpoint for location-based provider lookup
    const fccApiUrl = 'https://broadbandmap.fcc.gov/api/public/map/location';
    const fccParams = {
      latitude: latitude,
      longitude: longitude,
      version: 'latest'
    };

    console.log('Querying FCC API for ISPs at location...');

    let providers = [];
    let fccError = null;

    try {
      const fccResponse = await axios.get(fccApiUrl, { 
        params: fccParams,
        timeout: 10000 // 10 second timeout
      });

      console.log('FCC API Response status:', fccResponse.status);

      // Parse FCC response to extract provider data
      if (fccResponse.data && fccResponse.data.features) {
        providers = parseFCCProviders(fccResponse.data.features);
        console.log(`Found ${providers.length} providers at this location`);
      }
    } catch (fccErr) {
      console.error('FCC API Error:', fccErr.message);
      fccError = fccErr.message;
      // Continue anyway - we'll return geocode data with empty provider list
    }

    // Build response
    const result = {
      success: true,
      address: {
        input: `${address}, ${city}, ${state} ${zip}`,
        matched: match.matchedAddress,
        latitude: parseFloat(latitude).toFixed(6),
        longitude: parseFloat(longitude).toFixed(6)
      },
      geography: {
        state: block?.STATE || county?.STATE || state,
        county: {
          name: county?.NAME,
          fips: county?.COUNTY
        },
        block: {
          fips: block?.GEOID,
          tract: block?.TRACT,
          block: block?.BLOCK
        }
      },
      providers: providers,
      providerCount: providers.length,
      fccApiStatus: fccError ? 'error' : 'success',
      fccApiError: fccError,
      fcc_verification_url: `https://broadbandmap.fcc.gov/location-summary?version=latest&lat=${latitude}&lon=${longitude}&zoom=17.00`
    };

    res.json(result);

  } catch (error) {
    console.error('Error in ISP lookup:', error.message);
    
    res.status(500).json({ 
      error: 'Server error',
      message: error.message,
      details: error.response?.data || 'No additional details'
    });
  }
});

// Helper function to parse FCC provider data
function parseFCCProviders(features) {
  const providers = [];
  const seen = new Set(); // Deduplicate by provider name

  for (const feature of features) {
    const props = feature.properties;
    
    if (!props || !props.provider_name) continue;

    const providerKey = props.provider_name.toLowerCase().trim();
    
    // Skip duplicates
    if (seen.has(providerKey)) continue;
    seen.add(providerKey);

    providers.push({
      name: props.provider_name,
      brand_name: props.brand_name || props.provider_name,
      technology: props.technology || 'Unknown',
      max_download_speed: props.max_advertised_download_speed || 'Unknown',
      max_upload_speed: props.max_advertised_upload_speed || 'Unknown',
      service_type: props.service_type || 'Unknown',
      is_residential: props.is_residential !== false, // Default to true
      is_business: props.is_business === true
    });
  }

  // Sort by max download speed (highest first)
  providers.sort((a, b) => {
    const speedA = parseFloat(a.max_download_speed) || 0;
    const speedB = parseFloat(b.max_download_speed) || 0;
    return speedB - speedA;
  });

  return providers;
}

app.listen(PORT, () => {
  console.log(`FCC Proxy Server running on port ${PORT}`);
  console.log(`Test at: http://localhost:${PORT}`);
});
