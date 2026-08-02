const { sendEmail } = require('./email');

function resetUrl(store, accountType, rawToken) {
  const base = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
  const path = accountType === 'admin' ? `/${store.slug}/admin/reset-password` : `/${store.slug}/reset-password`;
  return `${base}${path}?token=${rawToken}`;
}

async function sendPasswordResetEmail(store, accountType, email, rawToken) {
  const url = resetUrl(store, accountType, rawToken);
  await sendEmail({
    to: email,
    subject: `${store.name}: Reset your password`,
    text: `We received a request to reset your password.\n\nReset it here (link expires in 1 hour): ${url}\n\nIf you didn't request this, you can ignore this email.`,
    html:
      `<p>We received a request to reset your password.</p>` +
      `<p><a href="${url}">Reset your password</a> (link expires in 1 hour)</p>` +
      `<p>If you didn't request this, you can ignore this email.</p>`,
  });
}

async function sendStaffInviteEmail(store, email, rawToken) {
  const url = resetUrl(store, 'admin', rawToken);
  await sendEmail({
    to: email,
    subject: `${store.name}: You've been added as a staff member`,
    text: `You've been given staff access to ${store.name}'s admin dashboard.\n\nSet up your password here (link expires in 1 hour): ${url}`,
    html:
      `<p>You've been given staff access to <strong>${store.name}</strong>'s admin dashboard.</p>` +
      `<p><a href="${url}">Set up your password</a> (link expires in 1 hour)</p>`,
  });
}

// label is a store's name for a per-store admin login, or omitted for the
// store-less platform-admin gate login (server.js's bare /admin).
async function sendLoginOtpEmail(email, code, label = 'SAMWILL') {
  await sendEmail({
    to: email,
    subject: `${label}: Your login code`,
    text: `Your login code is ${code}.\n\nIt expires in 10 minutes. If you didn't try to log in, you can ignore this email.`,
    html:
      `<p>Your login code is <strong>${code}</strong>.</p>` +
      `<p>It expires in 10 minutes. If you didn't try to log in, you can ignore this email.</p>`,
  });
}

module.exports = { sendPasswordResetEmail, sendStaffInviteEmail, sendLoginOtpEmail };
