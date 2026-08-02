require('dotenv').config({ quiet: true });

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const session = require('express-session');
const SqliteSessionStore = require('better-sqlite3-session-store')(session);
const { Server } = require('socket.io');

const db = require('./db'); // ensure schema is applied before routes touch it
const bcrypt = require('bcryptjs');
const { dataDir } = require('./lib/paths');
const { resolveStore } = require('./middleware/resolveStore');
const { createOtp, verifyOtp, msUntilResendAllowed } = require('./lib/loginOtp');
const { sendLoginOtpEmail } = require('./lib/authEmails');
const { loginLimiter, forgotPasswordLimiter } = require('./middleware/rateLimit');

// Comma-separated list in dev (web app + Expo web preview run on different ports);
// a single origin (or the deployed site's domain) in production.
const allowedOrigins = (process.env.CORS_ORIGIN || '*').split(',').map((o) => o.trim());
const isWildcardOrigin = allowedOrigins.includes('*');
// Browsers reject the combination of a wildcard origin with credentialed
// requests outright, so these two must never be sent together - credentials
// only turn on once specific origins are configured.
const corsOptions = {
  origin: isWildcardOrigin ? '*' : allowedOrigins,
  credentials: !isWildcardOrigin,
};

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: corsOptions });
app.set('io', io);

const sessionMiddleware = session({
  store: new SqliteSessionStore({ client: db, expired: { clear: true, intervalMs: 1000 * 60 * 60 } }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 },
});

app.use(sessionMiddleware);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(dataDir, 'uploads')));

// Every store is reached via a path-based slug (e.g. /pizza-place/...), fully
// independent from every other store: its own menu, orders, customers, and admin
// login. resolveStore looks up the slug once and attaches req.store for everything
// downstream; a request for a slug that doesn't exist 404s before touching any data.
app.use('/api/:storeSlug/auth', resolveStore, require('./routes/auth'));
app.use('/api/:storeSlug', resolveStore, require('./routes/menu'));
app.use('/api/:storeSlug/orders', resolveStore, require('./routes/orders').router);
app.use('/api/:storeSlug/promotions', resolveStore, require('./routes/promotions'));

// Bare /admin (no store slug) is what the samwillmedia.com chooser's "/online" link
// points at. There's no single store anymore, so this is a generic gate: log in with
// the platform-admin login first, then pick which store to manage. Only platform
// admins can use this gate (it has no store context to check a per-store admin
// against) - a per-store admin still signs in at their own /<slug>/admin/login.
app.get('/admin', (req, res) => {
  if (!req.session.isPlatformAdmin) {
    return res.render('admin-gate-login', { error: null });
  }
  const stores = db.prepare('SELECT slug, name FROM stores WHERE is_active = 1 ORDER BY name').all();
  res.render('store-picker', { stores });
});

async function sendPendingGateOtp(platformAdmin) {
  const code = createOtp(null, 'platform', platformAdmin.id);
  try {
    await sendLoginOtpEmail(platformAdmin.email, code);
  } catch (err) {
    console.error('[email] platform admin login code failed:', err.message);
  }
}

app.post('/admin/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  const platformAdmin = db.prepare('SELECT * FROM platform_admins WHERE email = ?').get((email || '').toLowerCase());
  if (!platformAdmin || !bcrypt.compareSync(password || '', platformAdmin.password_hash)) {
    return res.render('admin-gate-login', { error: 'Invalid email or password' });
  }
  req.session.pendingAdminId = platformAdmin.id;
  req.session.pendingAdminEmail = platformAdmin.email;
  await sendPendingGateOtp(platformAdmin);
  res.redirect('/admin/login/verify');
});

app.get('/admin/login/verify', (req, res) => {
  if (!req.session.pendingAdminId) {
    return res.redirect('/admin');
  }
  res.render('admin-gate-verify-otp', { error: null });
});

app.post('/admin/login/verify', loginLimiter, (req, res) => {
  const { pendingAdminId, pendingAdminEmail } = req.session;
  if (!pendingAdminId) {
    return res.redirect('/admin');
  }

  const result = verifyOtp(null, 'platform', pendingAdminId, req.body.code);

  if (!result.ok) {
    if (result.reason === 'locked' || result.reason === 'no_code' || result.reason === 'expired') {
      delete req.session.pendingAdminId;
      delete req.session.pendingAdminEmail;
      return res.render('admin-gate-login', {
        error: 'That code expired or had too many wrong attempts. Please log in again.',
      });
    }
    return res.render('admin-gate-verify-otp', { error: 'Incorrect code. Please try again.' });
  }

  req.session.adminId = pendingAdminId;
  req.session.isPlatformAdmin = true;
  req.session.adminEmail = pendingAdminEmail;
  delete req.session.pendingAdminId;
  delete req.session.pendingAdminEmail;

  res.redirect('/admin');
});

app.post('/admin/login/verify/resend', forgotPasswordLimiter, async (req, res) => {
  const { pendingAdminId, pendingAdminEmail } = req.session;
  if (!pendingAdminId) {
    return res.redirect('/admin');
  }

  const waitMs = msUntilResendAllowed(null, 'platform', pendingAdminId);
  if (waitMs > 0) {
    return res.render('admin-gate-verify-otp', {
      error: `Please wait ${Math.ceil(waitMs / 1000)}s before requesting another code.`,
    });
  }

  await sendPendingGateOtp({ id: pendingAdminId, email: pendingAdminEmail });
  res.render('admin-gate-verify-otp', { error: 'A new code has been sent.' });
});

app.use('/:storeSlug/admin', resolveStore, require('./routes/admin'));
app.use('/:storeSlug/kitchen', resolveStore, require('./routes/kitchen'));
app.use('/api/:storeSlug/print', resolveStore, require('./routes/print'));

app.get('/', (req, res) => res.json({ ok: true, service: 'samwill-online-order-server' }));

// For uptime monitors / Railway healthchecks - confirms the process is up
// AND the database file is actually reachable, not just that Express is alive.
app.get('/healthz', (req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ ok: true });
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

// In production the built customer web app (web/dist) is served by this same
// process, so the whole product is one deployable service. In local dev that
// folder doesn't exist (the web app runs via its own Vite dev server instead).
// The client-side router reads the store slug from the URL itself, so this stays
// a single static shell for every store.
const webDistPath = path.join(__dirname, '..', 'web', 'dist');
if (fs.existsSync(webDistPath)) {
  app.use(express.static(webDistPath));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.sendFile(path.join(webDistPath, 'index.html'));
  });
}

// Share the express session with socket.io so admin sockets can be verified
// before joining a store's admin room (which streams that store's incoming orders).
io.engine.use(sessionMiddleware);

io.on('connection', (socket) => {
  socket.on('join-admin', (payload) => {
    const session = socket.request.session;
    const storeId = payload && payload.storeId;
    if (session && session.adminId && (session.isPlatformAdmin || session.storeId === storeId)) {
      socket.join(`admin:${storeId}`);
    }
  });

  socket.on('join-order', (payload) => {
    const storeId = payload && payload.storeId;
    const orderId = payload && payload.orderId;
    if (storeId && orderId) socket.join(`order:${storeId}:${orderId}`);
  });

  // The kitchen display authenticates with its own long-lived token instead
  // of a real admin session, but streams the same admin:{storeId} room the
  // regular dashboard uses - both see every order the moment it comes in.
  socket.on('join-kitchen', (payload) => {
    const storeId = payload && payload.storeId;
    const token = payload && payload.token;
    if (!storeId || !token) return;
    const store = db.prepare('SELECT kitchen_display_token FROM stores WHERE id = ?').get(storeId);
    if (store && store.kitchen_display_token && store.kitchen_display_token === token) {
      socket.join(`admin:${storeId}`);
    }
  });
});

const port = process.env.PORT || 4000;
server.listen(port, () => {
  console.log(`SAMWILL Online Order server listening on http://localhost:${port}`);
});

require('./lib/backup').scheduleBackups();
