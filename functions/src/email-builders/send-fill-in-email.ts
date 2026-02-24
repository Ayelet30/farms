function escapeHtml(s: any) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function fmtTime(t: string | null | undefined) {
  return t ? String(t).slice(0, 5) : '—';
}

export function buildFillInEmail(args: {
  kind: 'approved' | 'rejected';
  parentName: string;
  childName: string;
  farmName: string;
  target: {
    occur_date: string;
    day_of_week?: string | null;
    start_time: string;
    end_time: string;
    instructor_name?: string | null;
  };
  decisionNote?: string | null;
}) {
  const { kind, parentName, childName, farmName, target, decisionNote } = args;

  const title =
    kind === 'approved'
      ? 'אושר מילוי מקום'
      : 'נדחה מילוי מקום';

  const subject =
    kind === 'approved'
      ? `${farmName} – בקשת מילוי מקום אושרה`
      : `${farmName} – בקשת מילוי מקום נדחתה`;

  const noteHtml = decisionNote
    ? `<div style="margin-top:10px"><b>הערה:</b> ${escapeHtml(decisionNote)}</div>`
    : '';

  const html = `
  <div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.45">
    <h2 style="margin:0 0 8px 0">${escapeHtml(title)}</h2>
    <div>שלום ${escapeHtml(parentName)},</div>
    <div style="margin-top:8px">
      בקשת מילוי המקום עבור <b>${escapeHtml(childName)}</b> ${kind === 'approved' ? 'אושרה' : 'נדחתה'}.
    </div>

    <div style="margin-top:14px;padding:10px;border:1px solid #eee;border-radius:10px;background:#fafafa">
      <div><b>תאריך:</b> ${escapeHtml(target.occur_date)}</div>
      <div><b>יום:</b> ${escapeHtml(target.day_of_week ?? '—')}</div>
      <div><b>שעה:</b> ${escapeHtml(`${fmtTime(target.start_time)}–${fmtTime(target.end_time)}`)}</div>
      <div><b>מדריך/ה:</b> ${escapeHtml(target.instructor_name ?? '—')}</div>
    </div>

    ${noteHtml}

    <div style="margin-top:14px">
      תודה,<br/>${escapeHtml(farmName)}
    </div>
  </div>
  `.trim();

  const text = [
    title,
    `שלום ${parentName},`,
    `בקשת מילוי המקום עבור ${childName} ${kind === 'approved' ? 'אושרה' : 'נדחתה'}.`,
    `תאריך: ${target.occur_date}`,
    `יום: ${target.day_of_week ?? '—'}`,
    `שעה: ${fmtTime(target.start_time)}–${fmtTime(target.end_time)}`,
    `מדריך/ה: ${target.instructor_name ?? '—'}`,
    decisionNote ? `הערה: ${decisionNote}` : '',
    `תודה, ${farmName}`,
  ].filter(Boolean).join('\n');

  return { subject, html, text };
}
