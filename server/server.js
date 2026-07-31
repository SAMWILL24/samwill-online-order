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
app.use('/api/webhooks', express.raw({ type: 'application/json' }), require('./routes/webhooks'));

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', require('./routes/auth'));
app.use('/api', require('./routes/menu'));
app.use('/api/orders', require('./routes/orders').router);
app.use('/api/promotions', require('./routes/promotions'));

app.use('/admin', require('./routes/admin'));

// In production the built customer web app (web/dist) is served by this same
// process, so the whole product is one deployable service. In local dev that
// folder doesn't exist (the web app runs via its own Vite dev server instead),
// so this falls back to a plain health-check response.
const webDistPath = path.join(__dirname, '..', 'web', 'dist');
if (fs.existsSync(webDistPath)) {
  app.use(express.static(webDistPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/admin') || req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
      return next();
    }
    res.sendFile(path.join(webDistPath, 'index.html'));
  });
} else {
  app.get('/', (req, res) => res.json({ ok: true, service: 'samwill-online-order-server' }));
}

// Share the express session with socket.io so admin sockets can be verified
// before joining the 'admin' room (which streams every incoming order).
io.engine.use(sessionMiddleware);

io.on('connection', (socket) => {
  socket.on('join-admin', () => {
    const session = socket.request.session;
    if (session && session.adminId) {
      socket.join('admin');
    }
  });

  socket.on('join-order', (orderId) => {
    if (orderId) socket.join(`order:${orderId}`);
  });
});

const port = process.env.PORT || 4000;
server.listen(port, () => {
  console.log(`SAMWILL Online Order server listening on http://localhost:${port}`);
});
