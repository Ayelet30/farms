const { google } = require('googleapis');

function makeRawEmail({ from, to, subject, html }) {
  const raw =
    `From: ${from}\r\n` +
    `To: ${to}\r\n` +
    `Subject: ${subject}\r\n` +
    `MIME-Version: 1.0\r\n` +
    `Content-Type: text/html; charset="UTF-8"\r\n\r\n` +
    html;

  return Buffer.from(raw)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function main() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI
  );

  oauth2Client.setCredentials({
    refresh_token: process.env.GMAIL_REFRESH_TOKEN,
  });

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  const raw = makeRawEmail({
    from: `Smart Farm <${process.env.GMAIL_SENDER}>`,
    to: process.env.TEST_TO,
    subject: '✅ בדיקת Gmail API - Smart Farm',
    html: '<h2>עובד!</h2><p>המייל נשלח דרך Gmail API.</p>',
  });

  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw },
  });

  console.log('Sent message id:', res.data.id);
}

main().catch(console.error);
