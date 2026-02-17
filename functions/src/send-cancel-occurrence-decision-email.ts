// functions/src/send-cancel-occurrence-decision-email.ts

function escapeHtml(s: any) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function fmtTime(t: any) {
  const s = String(t ?? '');
  if (!s) return '—';
  return s.length >= 5 ? s.slice(0, 5) : s;
}

export type CancelOccurrenceDecisionEmailArgs = {
  kind: 'approved' | 'rejected';
  farmName: string;
  parentName: string;
  childName: string;

  occurDate: string;              // YYYY-MM-DD
  startTime: string | null;
  endTime: string | null;
  instructorName: string | null;

  decisionNote?: string | null;
};

export function buildCancelOccurrenceDecisionEmail(a: CancelOccurrenceDecisionEmailArgs) {
  const isApproved = a.kind === 'approved';

  const subject = isApproved
    ? `אישור בקשת ביטול שיעור – ${a.childName} (${a.farmName})`
    : `דחיית בקשת ביטול שיעור – ${a.childName} (${a.farmName})`;

  const header = isApproved ? 'הבקשה אושרה ✅' : 'הבקשה נדחתה ❌';
  const range = `${fmtTime(a.startTime)}–${fmtTime(a.endTime)}`;

  const actionLine = isApproved
    ? 'השיעור בוטל במערכת.'
    : 'השיעור נשאר כמתוכנן (לא בוטל).';

  const noteHtml = a.decisionNote
    ? `<div style="margin-top:12px;padding:10px;border:1px solid #eee;border-radius:10px">
         <b>הערה:</b> ${escapeHtml(a.decisionNote)}
       </div>`
    : '';

  const html = `
  <div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;line-height:1.5;color:#1f2937">
    <h2 style="margin:0 0 10px">${escapeHtml(header)}</h2>
    <div style="margin-bottom:10px">שלום ${escapeHtml(a.parentName)},</div>

    <div style="border:1px solid #e5e7eb;border-radius:12px;padding:12px;background:#fff">
      <div style="font-weight:700;margin-bottom:6px">פרטי השיעור:</div>
      <div>ילד/ה: <b>${escapeHtml(a.childName)}</b></div>
      <div>תאריך: <b>${escapeHtml(a.occurDate)}</b></div>
      <div>שעה: <b>${escapeHtml(range)}</b></div>
      <div>מדריך/ה: <b>${escapeHtml(a.instructorName ?? '—')}</b></div>
    </div>

    <div style="margin-top:12px;font-weight:700">${escapeHtml(actionLine)}</div>

    ${noteHtml}

    <div style="margin-top:14px;color:#6b7280;font-size:13px">
      נשלח ממערכת ${escapeHtml(a.farmName)}
    </div>
  </div>
  `.trim();

  const text = `${header}
שלום ${a.parentName}

פרטי השיעור:
ילד/ה: ${a.childName}
תאריך: ${a.occurDate}
שעה: ${range}
מדריך/ה: ${a.instructorName ?? '—'}

${actionLine}
${a.decisionNote ? `הערה: ${a.decisionNote}` : ''}
`.trim();

  return { subject, html, text };
}
