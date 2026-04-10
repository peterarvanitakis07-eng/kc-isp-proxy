# FCC Broadband API Proxy Server

A simple Node.js proxy server that bypasses CORS restrictions to enable browser-based lookups of ISP availability by address using FCC Broadband Map data.

## What This Does

- Takes a street address as input
- Geocodes it using Census API
- Queries FCC Broadband Map for available ISPs
- Returns ISP data to your browser app (no CORS errors!)

## Quick Start (Local Testing)

1. **Install dependencies:**
   ```bash
   cd fcc-proxy-server
   npm install
   ```

2. **Run the server:**
   ```bash
   npm start
   ```

3. **Test it:**
   ```
   http://localhost:3000/api/lookup?address=1801%20Linwood%20Blvd&city=Kansas%20City&state=MO&zip=64109
   ```

## Deploy to Railway.app (FREE)

Railway offers a generous free tier perfect for this use case.

### Steps:

1. **Create Railway account:**
   - Go to https://railway.app
   - Sign up with GitHub

2. **Create new project:**
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Connect your GitHub account
   - Create a new repo with this code

3. **Deploy:**
   - Railway auto-detects Node.js
   - Automatically installs dependencies
   - Assigns you a public URL like: `https://your-app.railway.app`

4. **Update your KC ISP Navigator:**
   - Replace FCC API calls with: `https://your-app.railway.app/api/lookup?address=...`

## Alternative: Deploy to Render.com (FREE)

Render also has a free tier.

1. **Create Render account:**
   - Go to https://render.com
   - Sign up with GitHub

2. **Create Web Service:**
   - New → Web Service
   - Connect GitHub repo
   - Build Command: `npm install`
   - Start Command: `npm start`

3. **Deploy:**
   - Free tier gives you: `https://your-app.onrender.com`

## API Endpoints

### `GET /`
Health check - returns server status

### `GET /api/lookup`
Lookup ISPs by address

**Parameters:**
- `address` - Street address (required)
- `city` - City name (required)
- `state` - State code (required, 2 letters)
- `zip` - ZIP code (required)

**Example:**
```
/api/lookup?address=1801%20Linwood%20Blvd&city=Kansas%20City&state=MO&zip=64109
```

**Response:**
```json
{
  "success": true,
  "address": {
    "matched": "1801 Linwood Blvd, Kansas City, MO, 64109",
    "latitude": 39.0842,
    "longitude": -94.5606,
    "blockFips": "290950245001008"
  },
  "providers": [
    {
      "name": "AT&T",
      "technology": "fiber",
      "speeds": "1000/1000"
    }
  ]
}
```

## Updating Your KC ISP Navigator

Replace your current FCC API call with:

```javascript
async function lookupISPs(address, city, state, zip) {
  const url = `https://your-app.railway.app/api/lookup`;
  const params = new URLSearchParams({ address, city, state, zip });
  
  const response = await fetch(`${url}?${params}`);
  const data = await response.json();
  
  return data.providers;
}
```

## Cost

**Railway.app FREE tier:**
- $5 free credit/month
- ~500 hours of uptime/month
- More than enough for your use case

**Render.com FREE tier:**
- 750 hours/month
- Spins down after 15 min of inactivity
- Takes ~30 seconds to wake up on first request

## Environment Variables

None required! Everything works out of the box.

## Troubleshooting

**Issue:** Server returns "Address not found"
- **Fix:** Make sure address is properly formatted (street number, street name, city, state, ZIP)

**Issue:** FCC API returns no data
- **Fix:** The FCC API endpoint may have changed. Check latest FCC API docs.

## Next Steps

1. Deploy this to Railway or Render
2. Get your public URL
3. Update your KC ISP Navigator HTML to use this proxy
4. Test with real KC addresses

## Questions?

This was built for Peter Arvanitakis at KC Digital Drive.
Contact: parvanitakis@kcdigitaldrive.org
