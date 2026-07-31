const path = require('path');

// Shared with db/index.js: DATA_DIR should point at a mounted persistent Volume
// in production (Railway wipes the app's own filesystem on every redeploy).
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');

module.exports = { dataDir };
