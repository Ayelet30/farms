// functions/src/gmail/mime.ts
function encodeSubjectUtf8(subject: string) {
  const b64 = Buffer.from(subject, 'utf8').toString('base64');
  return `=?UTF-8?B?${b64}?=`;
}

function toBase64Url(buf: Buffer) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export type GmailAttachment = {
  filename: string;
  contentType?: string;
  content: Buffer;
};

export function buildRawEmail(args: {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  attachments?: GmailAttachment[];
}) {
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  const headers: string[] = [
    `From: ${args.from}`,
    `To: ${args.to.join(', ')}`,
    args.cc?.length ? `Cc: ${args.cc.join(', ')}` : '',
    args.bcc?.length ? `Bcc: ${args.bcc.join(', ')}` : '',
    `Subject: ${encodeSubjectUtf8(args.subject)}`,
    args.replyTo ? `Reply-To: ${args.replyTo}` : '',
    'MIME-Version: 1.0',
  ].filter(Boolean);

  const hasAttachments = (args.attachments?.length || 0) > 0;

  if (!hasAttachments) {
    if (args.html) {
      headers.push('Content-Type: text/html; charset="UTF-8"');
      return toBase64Url(Buffer.from(headers.join('\r\n') + '\r\n\r\n' + args.html, 'utf8'));
    } else {
      headers.push('Content-Type: text/plain; charset="UTF-8"');
      return toBase64Url(Buffer.from(headers.join('\r\n') + '\r\n\r\n' + (args.text || ''), 'utf8'));
    }
  }

  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);

  const parts: string[] = [];
  const bodyContent =
    args.html
      ? `Content-Type: text/html; charset="UTF-8"\r\n\r\n${args.html}`
      : `Content-Type: text/plain; charset="UTF-8"\r\n\r\n${args.text || ''}`;

  parts.push(`--${boundary}\r\n${bodyContent}\r\n`);

  for (const a of args.attachments || []) {
    const ct = a.contentType || 'application/octet-stream';
    const b64 = a.content.toString('base64');
    parts.push(
      `--${boundary}\r\n` +
      `Content-Type: ${ct}; name="${a.filename}"\r\n` +
      `Content-Disposition: attachment; filename="${a.filename}"\r\n` +
      `Content-Transfer-Encoding: base64\r\n\r\n` +
      `${b64}\r\n`
    );
  }

  parts.push(`--${boundary}--`);

  const raw = headers.join('\r\n') + '\r\n\r\n' + parts.join('');
  return toBase64Url(Buffer.from(raw, 'utf8'));
}
