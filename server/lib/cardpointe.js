// CardPointe Gateway integration. Each store boards its own CardPointe merchant
// account (site/merchid/username/password), so a card charged on one store's
// checkout is authorized and settled entirely within that store's own merchant
// account - SAMWILL's servers only relay the request, they never hold the funds.
//
// The Gateway's auth/refund/void endpoints are synchronous REST calls (no
// webhook round-trip like Stripe): a single "auth" request with "capture":"Y"
// both authorizes and captures the charge in one call, so the API response
// itself tells us whether the charge succeeded before we ever write the order.
// See https://developer.cardpointe.com/cardconnect-api for the full reference.

function isConfigured(store) {
  return Boolean(
    store.cardpointe_site && store.cardpointe_merchid && store.cardpointe_username && store.cardpointe_password
  );
}

function baseUrl(store) {
  const host = store.cardpointe_testmode ? `${store.cardpointe_site}-uat` : store.cardpointe_site;
  return `https://${host}.cardconnect.com/cardconnect/rest`;
}

function authHeader(store) {
  const creds = Buffer.from(`${store.cardpointe_username}:${store.cardpointe_password}`).toString('base64');
  return `Basic ${creds}`;
}

function centsToDecimalString(cents) {
  return (cents / 100).toFixed(2);
}

async function request(store, method, path, body) {
  const res = await fetch(`${baseUrl(store)}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: authHeader(store) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.resptext || `CardPointe request failed (${res.status})`);
    err.cardpointe = json;
    throw err;
  }
  return json;
}

// A single auth request with capture:"Y" both authorizes and captures the
// charge - there's no separate confirm/webhook step to wait on.
async function authAndCapture(store, { token, amountCents, orderId }) {
  const json = await request(store, 'PUT', '/auth', {
    merchid: store.cardpointe_merchid,
    account: token,
    amount: centsToDecimalString(amountCents),
    capture: 'Y',
    orderid: String(orderId),
  });
  return {
    approved: json.respstat === 'A',
    retref: json.retref,
    respstat: json.respstat,
    respcode: json.respcode,
    resptext: json.resptext,
    raw: json,
  };
}

// Only valid once the transaction has settled; use voidTransaction for same-day cancellations instead.
async function refund(store, { retref, amountCents, orderId }) {
  const json = await request(store, 'POST', '/refund', {
    merchid: store.cardpointe_merchid,
    retref,
    amount: centsToDecimalString(amountCents),
    orderid: orderId ? String(orderId) : undefined,
  });
  return { approved: json.respstat === 'A', resptext: json.resptext, raw: json };
}

// Cancels a transaction that hasn't settled yet (status "Authorized" or "Queued for Capture").
async function voidTransaction(store, { retref, amountCents }) {
  const json = await request(store, 'POST', '/void', {
    merchid: store.cardpointe_merchid,
    retref,
    amount: amountCents != null ? centsToDecimalString(amountCents) : undefined,
  });
  return { approved: json.respstat === 'A' || json.authcode === 'REVERS', resptext: json.resptext, raw: json };
}

async function inquire(store, { retref }) {
  const res = await fetch(`${baseUrl(store)}/inquire/${retref}/${store.cardpointe_merchid}`, {
    headers: { Authorization: authHeader(store) },
  });
  return res.json();
}

module.exports = { isConfigured, authAndCapture, refund, voidTransaction, inquire };
