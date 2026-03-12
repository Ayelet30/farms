export type BuildSingleLessonStatusEmailArgs = {
  status: 'approved' | 'rejected';

  parentName: string;
  childName: string;
  farmName: string;

  instructorName: string | null;
  lessonDate: string | null;      // YYYY-MM-DD
  startTime: string | null;       // HH:MM
  endTime: string | null;         // HH:MM

  ridingTypeName: string | null;
  paymentPlanName: string | null;

  rejectReason?: string | null;   // רק בדחייה
  lessonId?: string | null;       // רק באישור אם רוצים
};

export function buildSingleLessonStatusEmail(args: BuildSingleLessonStatusEmailArgs) {
  const isApproved = args.status === 'approved';

  const subject = isApproved
    ? `אישור שיעור בודד – ${args.farmName}`
    : `השיעור הבודד לא אושר – ${args.farmName}`;

  const details: Array<[string, string]> = [
    ['הורה', args.parentName],
    ['ילד/ה', args.childName],
    ['מדריך/ה', args.instructorName ?? '—'],
    ['תאריך שיעור', args.lessonDate ?? '—'],
    ['שעת התחלה', args.startTime ?? '—'],
    ['שעת סיום', args.endTime ?? '—'],
  ];

  if (args.ridingTypeName) details.push(['סוג רכיבה', args.ridingTypeName]);
  if (args.paymentPlanName) details.push(['תכנית תשלום', args.paymentPlanName]);

  if (isApproved && args.lessonId) {
    details.push(['מזהה שיעור', args.lessonId]);
  }

  const reasonText = String(args.rejectReason ?? '').trim() || 'לא נמסרה סיבה.';
  if (!isApproved) {
    details.push(['סיבת דחייה', reasonText]);
  }

  const rowsHtml = details
    .map(
      ([k, v]) => `
        <tr>
          <td style="padding:6px 10px;border:1px solid #ddd;white-space:nowrap"><b>${esc(k)}</b></td>
          <td style="padding:6px 10px;border:1px solid #ddd;">${esc(v)}</td>
        </tr>
      `
    )
    .join('');

  const html = isApproved
    ? `
      <div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.5">
        <h2 style="margin:0 0 12px">השיעור אושר ✅</h2>
        <p>שלום ${esc(args.parentName)},</p>
        <p>השיעור עבור <b>${esc(args.childName)}</b> אושר במערכת של ${esc(args.farmName)}.</p>

        <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:640px;margin-top:12px">
          ${rowsHtml}
        </table>

        <p style="margin-top:16px">אם יש שאלות – אפשר להשיב למייל הזה.</p>
        <p style="color:#666;font-size:12px;margin-top:18px">הודעה אוטומטית</p>
      </div>
    `.trim()
    : `
      <div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.6">
        <h2 style="margin:0 0 12px">השיעור לא אושר ❌</h2>
        <p>שלום ${esc(args.parentName)},</p>
        <p>בקשת השיעור עבור <b>${esc(args.childName)}</b> לא אושרה במערכת של ${esc(args.farmName)}.</p>

        <p><b>סיבת דחייה:</b> ${esc(reasonText)}</p>

        <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:640px;margin-top:12px">
          ${rowsHtml}
        </table>

        <p style="margin-top:16px">ניתן לבצע הזמנה חדשה באתר או ליצור קשר עם המשרד לתיאום חלופה.</p>
        <p style="color:#666;font-size:12px;margin-top:18px">הודעה אוטומטית</p>
      </div>
    `.trim();

  const text = buildTextFromDetails(subject, details, args.farmName);

  return { subject, html, text };
}

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