// Sends transactional SMS via Twilio's REST API (plain HTTPS + Basic Auth,
// same "no SDK needed" approach already used for email via Resend).
const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01';

function isConfigured() {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER);
}

async function sendSms({ to, body }) {
  if (!isConfigured() || !to) return;
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const auth = Buffer.from(`${accountSid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
  const params = new URLSearchParams({ To: to, From: process.env.TWILIO_FROM_NUMBER, Body: body });

  const response = await fetch(`${TWILIO_API_BASE}/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`Twilio API ${response.status}: ${errBody.slice(0, 300)}`);
  }
}

module.exports = { isConfigured, sendSms };
