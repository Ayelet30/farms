export type BuildSeriesRejectedEmailArgs = {
  parentName: string;
  childName: string;
  farmName: string;

  instructorName: string | null;
  seriesStartDate: string | null; // YYYY-MM-DD
  seriesEndDate: string | null;   // YYYY-MM-DD או null אם open-ended
  startTime: string | null;       // HH:MM
  isOpenEnded: boolean;
  repeatWeeks: number | null;

  ridingTypeName: string | null;
  paymentPlanName: string | null;

  rejectReason: string | null;    // decision_note
};

export function buildSeriesRejectedEmail(args: BuildSeriesRejectedEmailArgs) {
  const subject = `הסדרה לא אושרה – ${args.farmName}`;

  const reasonText = (args.rejectReason ?? '').trim() || 'לא נמסרה סיבה.';

  const details: Array<[string, string]> = [
    ['הורה', args.parentName],
    ['ילד/ה', args.childName],
    ['מדריך/ה', args.instructorName ?? '—'],
    ['תאריך התחלה', args.seriesStartDate ?? '—'],
    ['שעה', args.startTime ?? '—'],
    ['סיבת דחייה', reasonText],
  ];

  if (args.isOpenEnded) {
    details.push(['סיום', 'פתוח (ללא תאריך סיום)']);
  } else {
    details.push(['סיום', args.seriesEndDate ?? '—']);
    if (args.repeatWeeks != null) details.push(['מספר שבועות', String(args.repeatWeeks)]);
  }

  if (args.ridingTypeName) details.push(['סוג רכיבה', args.ridingTypeName]);
  if (args.paymentPlanName) details.push(['תכנית תשלום', args.paymentPlanName]);

  const rowsHtml = details
    .map(
      ([k, v]) =>
        `<tr>
          <td style="padding:6px 10px;border:1px solid #ddd;white-space:nowrap"><b>${esc(k)}</b></td>
          <td style="padding:6px 10px;border:1px solid #ddd;">${esc(v)}</td>
        </tr>`
    )
    .join('');

  const html = `
    <div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.6">
      <h2 style="margin:0 0 12px">הסדרה לא אושרה ❌</h2>
      <p>שלום ${esc(args.parentName)},</p>
      <p>בקשת הסדרה עבור <b>${esc(args.childName)}</b> לא אושרה במערכת של ${esc(args.farmName)}.</p>

      <p><b>סיבת דחייה:</b> ${esc(reasonText)}</p>

      <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:640px;margin-top:12px">
        ${rowsHtml}
      </table>

      <p style="margin-top:16px">ניתן לבצע הזמנה חדשה באתר או ליצור קשר עם המשרד לתאם חלופה.</p>
      <p style="color:#666;font-size:12px;margin-top:18px">הודעה אוטומטית</p>
    </div>
  `.trim();

  const text = buildTextFromDetails(subject, details, args.farmName);

  return { subject, html, text };
}

/** ---- helpers ---- */

function buildTextFromDetails(subject: string, details: Array<[string, string]>, farmName: string) {
  const lines = details.map(([k, v]) => `${k}: ${v}`);
  return `${subject}\n\n${lines.join('\n')}\n\n${farmName}`;
}

function esc(s: any) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
