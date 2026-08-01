// Sends transactional email via Resend's HTTPS API - same choice already made
// for the signage server's device alerts, since Railway blocks outbound SMTP
// (ports 465/587) entirely, so a plain HTTPS API call is what actually works.
const RESEND_API_URL = 'https://api.resend.com/emails';

function isConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

async function sendEmail({ to, subject, html, text }) {
  if (!isConfigured()) return;
  const response = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || 'SAMWILL Online <orders@samwillmedia.com>',
      to,
      subject,
      html,
      text,
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Resend API ${response.status}: ${body.slice(0, 300)}`);
  }
}

module.exports = { isConfigured, sendEmail };
