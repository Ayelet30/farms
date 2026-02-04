

import fetch from 'node-fetch';

type RemovalEmailKind = 'approved' | 'rejected';

function escapeHtml(s: any) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
function fmtTime(t: string | null | undefined) { return t ? String(t).slice(0, 5) : '—'; }

function renderTable(rows: any[]) {
  if (!rows?.length) return '';
  const body = rows.map(r => `
    <tr>
      <td>${escapeHtml(r.occur_date)}</td>
      <td>${escapeHtml(r.day_of_week || '—')}</td>
      <td>${escapeHtml(`${fmtTime(r.start_time)}–${fmtTime(r.end_time)}`)}</td>
      <td>${escapeHtml(r.lesson_type ?? '—')}</td>
      <td>${escapeHtml(r.instructorName ?? '—')}</td>
    </tr>
  `).join('');

  return `
    <table border="1" cellpadding="6" cellspacing="0"
           style="border-collapse:collapse;width:100%;font-size:14px">
      <thead><tr><th>תאריך</th><th>יום</th><th>שעה</th><th>סוג</th><th>מדריך/ה</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  `.trim();
}

export async function sendChildRemovalEmailViaGmailCF(params: {
  kind: RemovalEmailKind;

  tenantSchema: string;
  to: string;
  parentName: string;
  childName: string;
  farmName: string;

  // אופציונלי (רלוונטי בעיקר לאישור)
  scheduledDeletionAtIso?: string | null;
  willHappen?: any[];
  willCancel?: any[];
  graceDays?: number | null;

  // אופציונלי (רלוונטי לדחייה)
  decisionNote?: string | null;

  sendEmailGmailUrl: string;
  internalCallSecret: string;
}) {
  const {
    kind, tenantSchema, to, parentName, childName, farmName,
    scheduledDeletionAtIso, willHappen = [], willCancel = [], graceDays = null,
    decisionNote,
    sendEmailGmailUrl, internalCallSecret
  } = params;

  const isApproved = kind === 'approved';

  const subject = isApproved
    ? `אישור הסרת ילד – ${childName}`.trim()
    : `דחיית בקשת הסרת ילד – ${childName}`.trim();

  const approvedExtra = isApproved && scheduledDeletionAtIso
    ? (() => {
        const scheduledDate = scheduledDeletionAtIso.slice(0, 10);
        const deletionHuman = new Date(scheduledDeletionAtIso).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' });
        const graceLine =
          graceDays != null
            ? `<p><b>המחיקה תתבצע בפועל בעוד:</b> ${escapeHtml(graceDays)} ימים</p>`
            : '';

        return `
          <p>בקשת הסרת הילד/ה <b>${escapeHtml(childName)}</b> אושרה.</p>
          <p><b>תאריך מחיקה בפועל:</b> ${escapeHtml(deletionHuman)}<br/>
          (מתאריך ${escapeHtml(scheduledDate)} והלאה השיעורים יבוטלו)</p>
          ${graceLine}
          <hr/>
          <h3 style="margin:12px 0 6px">שיעורים שעדיין ניתן להגיע אליהם</h3>
          ${renderTable(willHappen) || `<p>אין שיעורים נוספים לפני תאריך המחיקה.</p>`}
          <h3 style="margin:12px 0 6px">שיעורים שיתבטלו החל מתאריך המחיקה</h3>
          ${renderTable(willCancel) || `<p>אין שיעורים שיתבטלו.</p>`}
        `.trim();
      })()
    : '';

  const rejectedExtra = !isApproved
    ? `
      <p>בקשת הסרת הילד/ה <b>${escapeHtml(childName)}</b> נדחתה.</p>
      ${decisionNote ? `<p><b>הערה:</b> ${escapeHtml(decisionNote)}</p>` : ''}
      <p>הילד/ה נשאר/ת פעיל/ה במערכת והשיעורים אינם מבוטלים.</p>
    `.trim()
    : '';

  const html = `
    <div dir="rtl" style="font-family: Arial, sans-serif; line-height:1.6">
      <p>שלום ${escapeHtml(parentName)},</p>
      ${isApproved ? approvedExtra : rejectedExtra}
      <p style="margin-top:16px">תודה,<br/>חוות ${escapeHtml(farmName)}</p>
    </div>
  `.trim();

  const payload: any = { tenantSchema, to: [to], subject, html };

  const resp = await fetch(sendEmailGmailUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': internalCallSecret,
    },
    body: JSON.stringify(payload),
  });

  const json: any = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(`sendEmailGmail failed: ${json?.message || json?.error || resp.statusText}`);
  }
  return json;
}
