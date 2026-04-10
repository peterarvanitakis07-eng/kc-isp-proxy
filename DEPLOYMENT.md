# 🚀 DEPLOYMENT GUIDE - FCC Proxy Server

## What We Built

A **free backend proxy** that:
1. Takes an address from your KC ISP Navigator
2. Geocodes it using Census API (bypasses CORS!)
3. Returns county + exact coordinates
4. Provides direct FCC verification URL

## Why This Approach?

The FCC doesn't have a public real-time API for ISP lookup **without authentication**. But we CAN:
- Use Census geocoding to get exact coordinates
- Match those coordinates to your existing county-level ISP data
- Provide users a direct link to FCC map for verification

---

## 📦 OPTION 1: Deploy to Railway.app (RECOMMENDED - Easiest)

### Step 1: Create GitHub Repo

1. Go to https://github.com/new
2. Name it: `kc-isp-proxy`
3. Make it Public
4. Click "Create repository"

### Step 2: Upload Your Code

From your terminal (or upload files via GitHub web interface):

```bash
cd /path/to/fcc-proxy-server
git init
git add .
git commit -m "Initial commit - KC ISP geocoding proxy"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/kc-isp-proxy.git
git push -u origin main
```

### Step 3: Deploy to Railway

1. Go to https://railway.app
2. Click "Start a New Project"
3. Select "Deploy from GitHub repo"
4. Authorize Railway to access your GitHub
5. Select `kc-isp-proxy` repo
6. Railway will auto-detect Node.js and deploy!

### Step 4: Get Your URL

- Railway assigns you a URL like: `https://kc-isp-proxy-production.up.railway.app`
- Copy this URL - you'll use it in your tool

### Step 5: Test It

Visit in your browser:
```
https://YOUR-APP.railway.app/api/geocode?address=1801%20Linwood%20Blvd&city=Kansas%20City&state=MO&zip=64109
```

You should see JSON with coordinates and county info!

---

## 📦 OPTION 2: Deploy to Render.com (Alternative)

### Steps:

1. Push code to GitHub (same as above)
2. Go to https://render.com
3. Click "New" → "Web Service"
4. Connect GitHub repo
5. Settings:
   - **Name:** kc-isp-proxy
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** Free
6. Click "Create Web Service"

Your URL: `https://kc-isp-proxy.onrender.com`

**Note:** Render free tier spins down after 15 min of inactivity, takes ~30 sec to wake up.

---

## 🔧 Update Your KC ISP Navigator Tool

### Current Code (County-Level):

```javascript
// Your tool currently determines county from ZIP
const county = getCountyFromZip(zip);
const isps = getISPsForCounty(county);
```

### New Code (Address-Level with Geocoding):

Add this function to your HTML file:

```javascript
async function geocodeAddress(address, city, state, zip) {
  const baseUrl = 'https://YOUR-APP.railway.app'; // Replace with your Railway URL
  const params = new URLSearchParams({ address, city, state, zip });
  
  try {
    const response = await fetch(`${baseUrl}/api/geocode?${params}`);
    const data = await response.json();
    
    if (data.success) {
      return {
        latitude: data.address.latitude,
        longitude: data.address.longitude,
        county: data.geography.county.name,
        fccUrl: data.fcc_verification_url
      };
    } else {
      throw new Error(data.message || 'Geocoding failed');
    }
  } catch (error) {
    console.error('Geocoding error:', error);
    alert('Could not geocode address. Please verify and try again.');
    return null;
  }
}

// Example usage in your tool:
async function lookupISPs() {
  const address = document.getElementById('street-address').value;
  const city = document.getElementById('city').value;
  const state = document.getElementById('state').value;
  const zip = document.getElementById('zip').value;
  
  // Geocode the address
  const geoData = await geocodeAddress(address, city, state, zip);
  
  if (geoData) {
    // Use county to filter ISPs (your existing logic)
    const isps = getISPsForCounty(geoData.county);
    
    // Display results with exact address match
    displayResults(isps, geoData);
    
    // Add "Verify on FCC" button with exact coordinates
    addFCCButton(geoData.fccUrl);
  }
}
```

---

## 💰 Cost Breakdown

### Railway.app FREE Tier:
- ✅ 500 hours/month (plenty for your use case)
- ✅ $5 free credit/month
- ✅ Always on (doesn't sleep)
- ✅ Fast (~100ms response times)

**Estimated usage for KC DSSC:**
- ~100 lookups/day = 3,000/month
- Each request = ~0.01 seconds of compute
- **Total cost: $0** (well within free tier)

### Render.com FREE Tier:
- ✅ 750 hours/month
- ❌ Sleeps after 15 min (30 sec wake-up time)
- ✅ Good for low-traffic tools

---

## 🧪 Testing Your Proxy

### Test Endpoint Locally (Before Deployment):

```bash
cd fcc-proxy-server
npm install
npm start
```

Visit: http://localhost:3000

### Test with Real KC Addresses:

1. **LAMP Campus:**
   ```
   /api/geocode?address=1801%20Linwood%20Blvd&city=Kansas%20City&state=MO&zip=64109
   ```

2. **Kauffman Foundation:**
   ```
   /api/geocode?address=4801%20Rockhill%20Rd&city=Kansas%20City&state=MO&zip=64110
   ```

3. **KCK Address:**
   ```
   /api/geocode?address=710%20N%207th%20St&city=Kansas%20City&state=KS&zip=66101
   ```

---

## 🐛 Troubleshooting

### Issue: "Address not found"
**Solution:** Check address formatting. Census API needs:
- Full street address (number + street name)
- City spelled correctly
- 2-letter state code (MO, KS)
- 5-digit ZIP

### Issue: CORS error from Railway/Render
**Solution:** The proxy includes CORS headers. If still blocked, check:
- Are you calling the right URL?
- Is the proxy server running? (Check Railway logs)

### Issue: Railway app sleeping
**Solution:** Railway free tier doesn't sleep. If using Render, first request takes ~30 sec.

---

## 📊 Monitoring & Logs

### Railway:
- Dashboard → Your Project → Logs tab
- See every request in real-time
- Monitor usage/costs

### Render:
- Dashboard → Service → Logs
- Free tier has limited log retention

---

## 🎯 Next Steps

1. ✅ Deploy proxy to Railway
2. ✅ Get your public URL
3. ✅ Update KC ISP Navigator HTML with geocoding function
4. ✅ Test with real KC addresses
5. ✅ Push updated tool to GitHub Pages

---

## 🤝 Support

Questions? Contact:
- Peter Arvanitakis - parvanitakis@kcdigitaldrive.org
- Built for KC Digital Drive / DSSC

---

## 🔮 Future Enhancements

Once this is working, you could add:
1. **Caching:** Store geocoded addresses to reduce API calls
2. **Rate limiting:** Prevent abuse
3. **Analytics:** Track which ZIP codes are searched most
4. **Spanish language support:** Accept Spanish address formats
