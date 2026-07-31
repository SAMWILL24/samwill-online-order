// Uploaded images are stored as relative paths ("/uploads/menu/...") since the admin
// panel is served from the same origin as the API. The customer web/mobile apps run on
// a different origin though, so relative <img src> there resolve against the wrong host
// and 404. Public API responses must return fully-qualified URLs instead.
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 4000}`;

function toAbsoluteUrl(path) {
  if (!path) return path;
  // Already absolute (http/https) or a data: URI (used for seeded placeholder images) - leave as-is.
  if (/^(https?:)?\/\//i.test(path) || path.startsWith('data:')) return path;
  return `${PUBLIC_URL}${path}`;
}

module.exports = { toAbsoluteUrl };
