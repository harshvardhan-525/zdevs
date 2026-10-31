// frontend/config.js : public settings only.
// The Supabase URL and anon / publishable key are SAFE to expose in the browser.
// NEVER put the service_role key (or any other secret) in this file.
window.BHOOMI_CONFIG = {
  SUPABASE_URL: 'http://ukpavpspnvktoedhjqyp.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_qvKNEJ-b2UtugAjn0wauvg_M9gkteWO',

  // '' = same origin (open the app at http://localhost:3000).
  // If you open the pages with VS Code Live Server instead, use 'http://localhost:3000'.
  API_BASE: '',
};
