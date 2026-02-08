// functions/src/send-makeup-lesson-decision-email.ts

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

export type MakeupDecisionEmailArgs = {
  kind: 'approved' | 'rejected';
  farmName: string;
  parentName: string;
  childName: string;

  // מתי ההשלמה המבוקשת
  requestedDate: string;          // YYYY-MM-DD
  requestedStart: string | null;  // HH:MM(:SS)
  requestedEnd: string | null;    // HH:MM(:SS)
  requestedInstructorName: string | null;

  // איזה שיעור משלימים (השיעור המקורי)
  originalDate: string | null;    // YYYY-MM-DD
  originalStart: string | null;
  originalEnd: string | null;
  originalInstructorName: string | null;

  decisionNote?: string | null;
};

export function buildMakeupLessonDecisionEmail(a: MakeupDecisionEmailArgs) {
  const isApproved = a.kind === 'approved';

  const subject = isApproved
    ? `אישור בקשת שיעור השלמה – ${a.childName} (${a.farmName})`
    : `דחיית בקשת שיעור השלמה – ${a.childName} (${a.farmName})`;

  const header = isApproved ? 'הבקשה אושרה ✅' : 'הבקשה נדחתה ❌';

  const requestedRange = `${fmtTime(a.requestedStart)}–${fmtTime(a.requestedEnd)}`;
  const originalRange = `${fmtTime(a.originalStart)}–${fmtTime(a.originalEnd)}`;

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
      <div style="font-weight:700;margin-bottom:6px">פרטי השיעור המבוקש (השלמה):</div>
      <div>ילד/ה: <b>${escapeHtml(a.childName)}</b></div>
      <div>תאריך: <b>${escapeHtml(a.requestedDate)}</b></div>
      <div>שעה: <b>${escapeHtml(requestedRange)}</b></div>
      <div>מדריך/ה: <b>${escapeHtml(a.requestedInstructorName ?? '—')}</b></div>
    </div>

    <div style="height:10px"></div>

    <div style="border:1px solid #e5e7eb;border-radius:12px;padding:12px;background:#f9fafb">
      <div style="font-weight:700;margin-bottom:6px">משלים את השיעור:</div>
      <div>תאריך: <b>${escapeHtml(a.originalDate ?? '—')}</b></div>
      <div>שעה: <b>${escapeHtml(originalRange)}</b></div>
      <div>מדריך/ה: <b>${escapeHtml(a.originalInstructorName ?? '—')}</b></div>
    </div>

    ${noteHtml}

    <div style="margin-top:14px;color:#6b7280;font-size:13px">
      נשלח ממערכת ${escapeHtml(a.farmName)}
    </div>
  </div>
  `.trim();

  const text = `${header}
שלום ${a.parentName}

פרטי השיעור המבוקש (השלמה):
ילד/ה: ${a.childName}
תאריך: ${a.requestedDate}
שעה: ${requestedRange}
מדריך/ה: ${a.requestedInstructorName ?? '—'}

משלים את השיעור:
תאריך: ${a.originalDate ?? '—'}
שעה: ${originalRange}
מדריך/ה: ${a.originalInstructorName ?? '—'}

${a.decisionNote ? `הערה: ${a.decisionNote}` : ''}
`.trim();

  return { subject, html, text };
}
