// backend/server.js : BHOOMI API
//
// Email + Google sign-in are handled by Supabase Auth (the browser talks to Supabase directly).
// This server does two jobs:
//   1. serves ../frontend, so the whole app runs from one origin: http://localhost:3000
//   2. protects API routes by verifying the Supabase access token (requireAuth)

require('dotenv').config();

const path    = require('path');
const express = require('express');
const cors    = require('cors');
const { createClient } = require('@supabase/supabase-js');

const PORT = Number(process.env.PORT) || 3000;
const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
const ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',').map((o) => o.trim()).filter(Boolean);

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_URL.includes('YOUR-')) {
  console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

// Stateless client, used only to ask Supabase "is this token valid, and whose is it?"
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: (origin, cb) => cb(null, !origin || ORIGINS.includes(origin)) }));
app.use(express.json({ limit: '100kb' }));

/* ------------------------------------------------------------------
   Auth middleware: use it on every route that needs a signed-in user
   Expects:  Authorization: Bearer <supabase access token>
   ------------------------------------------------------------------ */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return res.status(401).json({ error: 'Missing access token.' });

  try {
    const { data, error } = await supabase.auth.getUser(token);   // verified by Supabase itself
    if (error || !data || !data.user) {
      const down = error && (error.name === 'AuthRetryableFetchError' || error.status >= 500);
      return res.status(down ? 503 : 401).json({
        error: down ? 'Auth service unreachable. Try again.' : 'Invalid or expired session.',
      });
    }
    req.user = data.user;
    req.token = token;
    next();
  } catch (err) {
    console.error('requireAuth failed:', err);
    res.status(503).json({ error: 'Auth service unreachable. Try again.' });
  }
}

/* ------------------------------------------------------------------
   API routes
   ------------------------------------------------------------------ */
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Who is signed in? Works for both email and Google users.
app.get('/api/me', requireAuth, (req, res) => {
  const u = req.user;
  const meta = u.user_metadata || {};
  const app_meta = u.app_metadata || {};
  res.json({
    id: u.id,
    email: u.email || null,
    name: meta.full_name || meta.name || null,
    avatar_url: meta.avatar_url || meta.picture || null,
    providers: app_meta.providers || (app_meta.provider ? [app_meta.provider] : []),
    email_confirmed: Boolean(u.email_confirmed_at),
  });
});

// Add the next protected routes the same way, e.g.:
// app.post('/api/ai/chat', requireAuth, async (req, res) => { ... req.user.id ... });

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

/* ------------------------------------------------------------------
   Frontend (static files) so everything shares one origin
   ------------------------------------------------------------------ */
const FRONTEND = path.join(__dirname, '..', 'frontend');
app.use(express.static(FRONTEND, { dotfiles: 'deny' }));            // never serves frontend/.env
app.get('/', (_req, res) => res.sendFile(path.join(FRONTEND, 'login.html')));
app.get('/login', (_req, res) => res.sendFile(path.join(FRONTEND, 'login.html')));
app.get('/dashboard', (_req, res) => res.sendFile(path.join(FRONTEND, 'dashboard.html')));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Server error.' });
});

app.listen(PORT, () => {
  console.log(`BHOOMI running at http://localhost:${PORT}`);
});
