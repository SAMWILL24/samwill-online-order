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
const { dataDir } = require('./lib/paths');
const { resolveStore } = require('./middleware/resolveStore');

// Comma-separated list in dev (web app + Expo web preview run on different ports);
// a single origin (or the deployed site's domain) in production.
const allowedOrigins = (process.env.CORS_ORIGIN || '*').split(',').map((o) => o.trim());
const corsOptions = {
  origin: allowedOrigins.includes('*') ? '*' : allowedOrigins,
  credentials: true,
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

// Stripe webhook needs the raw body for signature verification, so it's mounted
// before the JSON body parser (which would otherwise consume/reformat the body).
// Stripe metadata carries the storeId, so this route resolves it itself rather
// than needing a :storeSlug prefix.
app.use('/api/webhooks', express.raw({ type: 'application/json' }), require('./routes/webhooks'));

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

// Bare /admin (no store slug) is what old links/bookmarks and the samwillmedia.com
// chooser's "/online" redirect point at. There's no single store anymore, so this
// just lists active stores and links to each one's real admin login.
app.get('/admin', (req, res) => {
  const stores = db.prepare('SELECT slug, name FROM stores WHERE is_active = 1 ORDER BY name').all();
  res.render('store-picker', { stores });
});

app.use('/:storeSlug/admin', resolveStore, require('./routes/admin'));

app.get('/', (req, res) => res.json({ ok: true, service: 'samwill-online-order-server' }));

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
});

const port = process.env.PORT || 4000;
server.listen(port, () => {
  console.log(`SAMWILL Online Order server listening on http://localhost:${port}`);
});
