const Papa = require('papaparse');
const { CACHE_TTL } = require('../config');

const cache = new Map();
function getCached(key, ttl) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > ttl) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}
function setCache(key, data) {
  cache.set(key, { data, timestamp: Date.now() });
}

function toCsvUrl(pubhtmlUrl) {
  return pubhtmlUrl.replace('/pubhtml?', '/pub?') + '&output=csv';
}

async function fetchCsv(url, { cacheKey = null, ttl = CACHE_TTL } = {}) {
  if (cacheKey && ttl > 0) {
    const cached = getCached(cacheKey, ttl);
    if (cached) {
      console.log(`✅ Cache hit: ${cacheKey}`);
      return cached;
    }
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error('Fetch error: ' + res.status);
    const text = await res.text();
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
    if (cacheKey && ttl > 0) {
      setCache(cacheKey, parsed.data);
      console.log(`💾 Cached: ${cacheKey}`);
    }
    return parsed.data;
  } catch (err) {
    console.error(`❌ Error fetching CSV (${cacheKey}):`, err.message);
    if (cacheKey && cache.has(cacheKey)) {
      console.log(`⚠️ Using stale cache for ${cacheKey}`);
      return cache.get(cacheKey).data;
    }
    throw err;
  }
}

module.exports = { toCsvUrl, fetchCsv };
