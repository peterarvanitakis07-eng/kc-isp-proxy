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
    message: 'Address Geocoding Proxy for KC ISP Navigator',
    description: 'Geocodes addresses and provides county/block data for ISP lookup',
    endpoints: {
      geocode: '/api/geocode?address=STREET&city=CITY&state=STATE&zip=ZIP'
    },
    example: '/api/geocode?address=1801%20Linwood%20Blvd&city=Kansas%20City&state=MO&zip=64109'
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

app.listen(PORT, () => {
  console.log(`FCC Proxy Server running on port ${PORT}`);
  console.log(`Test at: http://localhost:${PORT}`);
});
