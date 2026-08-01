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

module.exports = { sendPasswordResetEmail };
