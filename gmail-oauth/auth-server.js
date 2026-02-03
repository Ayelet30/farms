const express = require('express');
const { google } = require('googleapis');

const app = express();

const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const REDIRECT_URI = process.env.GMAIL_REDIRECT_URI; // http://localhost:3000/oauth2callback

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

console.log('CLIENT_ID:', process.env.GMAIL_CLIENT_ID);
console.log('CLIENT_SECRET exists:', !!process.env.GMAIL_CLIENT_SECRET);
console.log('REDIRECT_URI:', process.env.GMAIL_REDIRECT_URI);


app.get('/auth', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/gmail.send'],
  });
  res.redirect(url);
});

app.get('/oauth2callback', async (req, res) => {
  const code = req.query.code;
  const { tokens } = await oauth2Client.getToken(code);
  res.json(tokens);
});

app.listen(3000, () => console.log('Open: http://localhost:3000/auth'));
