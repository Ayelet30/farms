import fetch from 'node-fetch';

function escapeHtml(s: any) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
function fmtTime(t: string | null | undefined) { return t ? String(t).slice(0, 5) : '—'; }

function renderTable(rows: any[]) {
  if (!rows.length) return '';
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
    <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:14px">
      <thead><tr><th>תאריך</th><th>יום</th><th>שעה</th><th>סוג</th><th>מדריך/ה</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  `.trim();
}

export async function sendChildRemovalRejectedEmailViaGmailCF(params: {
  tenantSchema: string;
  to: string;
  parentName: string;
  childName: string;
  farmName: string;
  upcomingLessons: any[];

  sendEmailGmailUrl: string;
  internalCallSecret: string;
}) {
  const {
    tenantSchema, to, parentName, childName, farmName,
    upcomingLessons,
    sendEmailGmailUrl, internalCallSecret
  } = params;

  const subject = `דחיית הסרת ילד – ${childName}`.trim();

  const html = `
    <div dir="rtl" style="font-family: Arial, sans-serif; line-height:1.6">
      <p>שלום ${escapeHtml(parentName)},</p>

      <p>בקשת הסרת הילד/ה <b>${escapeHtml(childName)}</b> נדחתה.</p>
      <p><b>הילד/ה נשאר/ת פעיל/ה</b> במערכת, והשיעורים ממשיכים כרגיל.</p>

      <hr/>

      <h3 style="margin:12px 0 6px">שיעורים עתידיים (לידע כללי)</h3>
      ${renderTable(upcomingLessons) || `<p>לא נמצאו שיעורים עתידיים.</p>`}

      <p style="margin-top:16px">תודה,<br/>חוות ${escapeHtml(farmName)}</p>
    </div>
  `.trim();

  const payload: any = {
    tenantSchema,
    to: [to],
    subject,
    html,
  };

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
