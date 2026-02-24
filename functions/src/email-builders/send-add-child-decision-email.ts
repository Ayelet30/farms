// functions/src/send-add-child-decision-email.ts

type AddChildDecisionEmailInput = {
  kind: 'approved' | 'rejected';
  parentName: string;
  childName: string;
  farmName: string;
  decisionNote?: string | null;
};

export function buildAddChildDecisionEmail(input: AddChildDecisionEmailInput) {
  const parentName = input.parentName?.trim() || 'הורה';
  const childName = input.childName?.trim() || 'הילד/ה';
  const farmName = input.farmName?.trim() || 'החווה';
  const note = (input.decisionNote ?? '').trim();

  const isApproved = input.kind === 'approved';

  const subject = isApproved
    ? `אישור בקשת הצטרפות – ${childName}`
    : `דחיית בקשת הצטרפות – ${childName}`;

  const headline = isApproved ? 'הבקשה אושרה ✅' : 'הבקשה נדחתה ❌';

  const bodyLine = isApproved
    ? `בקשת ההוספה של <b>${escapeHtml(childName)}</b> אושרה, והסטטוס עודכן במערכת.`
    : `בקשת ההוספה של <b>${escapeHtml(childName)}</b> נדחתה, והסטטוס עודכן במערכת.`;

  const noteHtml = note
    ? `<p style="margin:12px 0 0 0;"><b>הערה:</b> ${escapeHtml(note)}</p>`
    : '';

  const html = `
<div style="direction:rtl;font-family:Arial,Helvetica,sans-serif;font-size:16px;color:#111827;">
  <h2 style="margin:0 0 6px 0;">${escapeHtml(farmName)}</h2>
  <p style="margin:0 0 12px 0;color:#374151;">היי ${escapeHtml(parentName)},</p>

  <p style="margin:0 0 10px 0;font-weight:700;">${headline}</p>
  <p style="margin:0 0 12px 0;">${bodyLine}</p>
  ${noteHtml}

  <hr style="margin:18px 0;border:none;border-top:1px solid #e5e7eb;" />
  <p style="margin:0;color:#6b7280;font-size:13px;">הודעה אוטומטית ממערכת החווה.</p>
</div>
`.trim();

  const text = `${farmName}\nהיי ${parentName}\n${isApproved ? 'הבקשה אושרה' : 'הבקשה נדחתה'}\n${childName}\n${
    note ? `הערה: ${note}` : ''
  }`.trim();

  return { subject, html, text };
}

function escapeHtml(s: string) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}