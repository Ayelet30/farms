type Args = {
  tenantSchema: string;
  to: string;

  parentName: string;
  childName: string;
  farmName: string;

  instructorName: string | null;
  seriesStartDate: string | null;     // YYYY-MM-DD
  seriesEndDate: string | null;       // YYYY-MM-DD או null אם open-ended
  startTime: string | null;           // HH:MM
  isOpenEnded: boolean;
  repeatWeeks: number | null;

  ridingTypeName: string | null;
  paymentPlanName: string | null;

  seriesId: string | null;

  sendEmailGmailUrl: string;
  internalCallSecret: string;
};

function esc(s: any) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export async function sendSeriesApprovedEmailViaGmailCF(args: Args) {
  const subject = `אישור סדרה – ${args.farmName}`;

  const details: Array<[string, string]> = [
    ['הורה', args.parentName],
    ['ילד/ה', args.childName],
    ['מדריך/ה', args.instructorName ?? '—'],
    ['תאריך התחלה', args.seriesStartDate ?? '—'],
    ['שעה', args.startTime ?? '—'],
  ];

  if (args.isOpenEnded) {
    details.push(['סיום', 'ללא תאריך סיום (פתוח)']);
  } else {
    details.push(['תאריך סיום', args.seriesEndDate ?? '—']);
    if (args.repeatWeeks != null) details.push(['מספר שבועות', String(args.repeatWeeks)]);
  }

  if (args.ridingTypeName) details.push(['סוג רכיבה', args.ridingTypeName]);
  if (args.paymentPlanName) details.push(['תכנית תשלום', args.paymentPlanName]);
  if (args.seriesId) details.push(['מזהה סדרה', args.seriesId]);

  const rowsHtml = details
    .map(([k, v]) => `<tr><td style="padding:6px 10px;border:1px solid #ddd;"><b>${esc(k)}</b></td><td style="padding:6px 10px;border:1px solid #ddd;">${esc(v)}</td></tr>`)
    .join('');

  const html = `
    <div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.5">
      <h2 style="margin:0 0 12px">הסדרה אושרה ✅</h2>
      <p>שלום ${esc(args.parentName)},</p>
      <p>הסדרה עבור <b>${esc(args.childName)}</b> אושרה במערכת של ${esc(args.farmName)}.</p>

      <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:640px;margin-top:12px">
        ${rowsHtml}
      </table>

      <p style="margin-top:16px">אם יש שאלות – אפשר להשיב למייל הזה.</p>
      <p style="color:#666;font-size:12px;margin-top:18px">הודעה אוטומטית</p>
    </div>
  `.trim();

  // קריאה ל-sendEmailGmail עם internal secret
  const resp = await fetch(args.sendEmailGmailUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Secret': args.internalCallSecret,
    },
    body: JSON.stringify({
      tenantSchema: args.tenantSchema,
      to: args.to,
      subject,
      html,
    }),
  });

  const raw = await resp.text();
  let json: any = null;
  try { json = JSON.parse(raw); } catch {}

  if (!resp.ok || !json?.ok) {
    throw new Error(json?.message || json?.error || `sendEmailGmail HTTP ${resp.status}: ${raw?.slice(0, 300)}`);
  }

  return json;
}
