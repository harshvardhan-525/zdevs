// frontend/auth.js : shared Supabase client + a helper that calls the BHOOMI API with the user's token.
// Load order on every page: supabase-js (CDN) -> config.js -> auth.js
(() => {
  const cfg = window.BHOOMI_CONFIG || {};
  const missing = !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY ||
                  /YOUR-/.test(cfg.SUPABASE_URL + cfg.SUPABASE_ANON_KEY);

  if (missing || !window.supabase) {
    console.error('Supabase is not set up: fill in frontend/config.js and make sure the supabase-js script loads before auth.js.');
    return;
  }

  window.sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  // fetch() for your own backend: adds "Authorization: Bearer <token>" automatically.
  window.apiFetch = async (path, options = {}) => {
    const { data: { session } } = await window.sb.auth.getSession();
    if (!session) throw new Error('You are signed out. Please sign in again.');
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${session.access_token}`);
    return fetch((cfg.API_BASE || '') + path, { ...options, headers });
  };
})();
