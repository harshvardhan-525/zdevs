// frontend/auth.js : shared Supabase client + helper for calling your backend
(() => {
  const cfg = window.BHOOMI_CONFIG || {};
  const missing = !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY ||
                  /YOUR-/.test(cfg.SUPABASE_URL + cfg.SUPABASE_ANON_KEY);

  if (missing || !window.supabase) {
    console.error('Supabase is not set up: check config.js and that the supabase-js script loads first.');
    return;
  }

  window.sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  // fetch() for your own backend: adds "Authorization: Bearer <token>" automatically
  window.apiFetch = async (path, options = {}) => {
    const { data: { session } } = await window.sb.auth.getSession();
    if (!session) throw new Error('You are signed out. Please sign in again.');
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${session.access_token}`);
    return fetch((cfg.API_BASE || '') + path, { ...options, headers });
  };
})();