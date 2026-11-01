/* bhoomi-cache.js
   Caches keyless API answers in localStorage so moving between pages is instant.
   Load this in <head> on every page, before any other script that calls fetch().
   Only the hosts listed in RULES are cached. Supabase, your /api/ai/chat backend
   and map tiles are never touched. */
(() => {
  if (window.__bhoomiCache) return;
  window.__bhoomiCache = true;

  const PREFIX = 'bhoomi.cache.';
  const MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR;
  const MAX_BODY = 1500000; /* skip answers bigger than ~1.5 MB */

  /* How long each source stays fresh. Lower a number if you want fresher data. */
  const RULES = [
    { host: 'open-meteo.com', ttl: 10 * MIN },                 /* weather, soil moisture, flood */
    { host: 'earth-search.aws.element84.com', ttl: 6 * HOUR },  /* Sentinel-2 catalogue */
    { host: 'rest.isric.org', ttl: 7 * DAY },                   /* SoilGrids */
    { host: 'nominatim.openstreetmap.org', ttl: 7 * DAY },      /* district names */
  ];

  const origFetch = window.fetch.bind(window);

  const ttlFor = (url) => {
    try {
      const h = new URL(url, location.href).hostname;
      for (const r of RULES) if (h === r.host || h.endsWith('.' + r.host)) return r.ttl;
    } catch (e) { /* ignore */ }
    return 0;
  };

  const hash = (s) => {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  };

  const read = (key) => {
    try {
      const o = JSON.parse(localStorage.getItem(PREFIX + hash(key)));
      if (o && o.k === key && Date.now() - o.t < o.ttl) return o.body;
    } catch (e) { /* ignore */ }
    return null;
  };

  const clearAll = (onlyExpired) => {
    try {
      Object.keys(localStorage).forEach((k) => {
        if (!k.startsWith(PREFIX)) return;
        if (!onlyExpired) { localStorage.removeItem(k); return; }
        try {
          const o = JSON.parse(localStorage.getItem(k));
          if (!o || Date.now() - o.t >= o.ttl) localStorage.removeItem(k);
        } catch (e) { localStorage.removeItem(k); }
      });
    } catch (e) { /* ignore */ }
  };

  const write = (key, body, ttl) => {
    if (body.length > MAX_BODY) return;
    const item = JSON.stringify({ k: key, t: Date.now(), ttl, body });
    try { localStorage.setItem(PREFIX + hash(key), item); }
    catch (e) {
      /* storage full: clear the cache once and try again */
      clearAll(false);
      try { localStorage.setItem(PREFIX + hash(key), item); } catch (e2) { /* give up */ }
    }
  };

  clearAll(true); /* remove expired entries on every page load */

  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input instanceof URL ? input.href : '');
    const method = ((init && init.method) || 'GET').toUpperCase();
    const body = init && typeof init.body === 'string' ? init.body : '';
    const ttl = url ? ttlFor(url) : 0;
    const cacheable = ttl > 0
      && (method === 'GET' || (method === 'POST' && body))
      && !(init && init.cache === 'no-store');
    if (!cacheable) return origFetch(input, init);

    const key = method + ' ' + url + ' ' + body;
    const hit = read(key);
    if (hit !== null) {
      return new Response(hit, { status: 200, headers: { 'Content-Type': 'application/json', 'X-BHOOMI-Cache': 'hit' } });
    }

    const res = await origFetch(input, init);
    if (res.ok && /json/i.test(res.headers.get('content-type') || '')) {
      res.clone().text().then((t) => write(key, t, ttl)).catch(() => {});
    }
    return res;
  };

  /* Handy for testing: BHOOMI_CACHE_CLEAR() in the console forces fresh data. */
  window.BHOOMI_CACHE_CLEAR = () => clearAll(false);
})();