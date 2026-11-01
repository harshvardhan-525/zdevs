// frontend/config.js : public settings only.
window.BHOOMI_CONFIG = {
  SUPABASE_URL: 'https://ukpavpspnvktoedhjqyp.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_qvKNEJ-b2UtugAjn0wauvg_M9gkteWO',
  API_BASE: (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'http://localhost:8000'
    : 'https://zdevs-6r52.vercel.app',
};