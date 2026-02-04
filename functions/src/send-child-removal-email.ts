type BuildArgs = {
  kind: 'approved' | 'rejected';
  parentName: string;
  childName: string;
  farmName: string;

  // approved
  scheduledDeletionAtIso?: string;
  willHappen?: Array<any>;
  willCancel?: Array<any>;
  graceDays?: number | null;

  // rejected
  decisionNote?: string | null;
};

export function buildChildRemovalEmail(args: BuildArgs) {
  const scheduledDate =
    args.scheduledDeletionAtIso ? String(args.scheduledDeletionAtIso).slice(0, 10) : null;

  const subject =
    args.kind === 'approved'
      ? `עדכון מהחווה ${args.farmName}: מחיקת ילד/ה נקבעה`
      : `עדכון מהחווה ${args.farmName}: בקשת מחיקת ילד/ה נדחתה`;

  const decisionNoteHtml =
    args.kind === 'rejected' && args.decisionNote
      ? `<p><b>סיבת דחייה:</b> ${escapeHtml(args.decisionNote)}</p>`
      : '';

  const approvedBlock =
    args.kind === 'approved'
      ? `
        <p>
          תאריך מחיקה מתוכנן: <b>${escapeHtml(scheduledDate || '')}</b>${
            args.graceDays != null ? ` ( ${args.graceDays} ימים)` : ''
          }
        </p>

        <h4>שיעורים שיתקיימו עד המחיקה:</h4>
        ${renderRows(args.willHappen ?? [])}

        <h4>שיעורים שיבוטלו החל מהמחיקה:</h4>
        ${renderRows(args.willCancel ?? [])}
      `
      : '';

  const html = `
  <div dir="rtl" style="font-family:Arial,sans-serif">
    <p>שלום ${escapeHtml(args.parentName)},</p>

    <p>
      ${
        args.kind === 'approved'
          ? `בקשת מחיקת הילד/ה <b>${escapeHtml(args.childName)}</b> אושרה.`
          : `בקשת מחיקת הילד/ה <b>${escapeHtml(args.childName)}</b> נדחתה.`
      }
    </p>

    ${decisionNoteHtml}
    ${approvedBlock}

    <p>בברכה,<br/>${escapeHtml(args.farmName)}</p>
  </div>`.trim();

  const decisionNoteText =
    args.kind === 'rejected' && args.decisionNote ? `סיבת דחייה: ${args.decisionNote}\n` : '';

  const text =
    `${subject}\n\n` +
    `שלום ${args.parentName}\n` +
    (args.kind === 'approved'
      ? `בקשת מחיקת הילד/ה ${args.childName} אושרה.${
          scheduledDate ? ` תאריך מחיקה: ${scheduledDate}` : ''
        }\n`
      : `בקשת מחיקת הילד/ה ${args.childName} נדחתה.\n`) +
    decisionNoteText +
    `\n${args.farmName}`;

  return { subject, html, text };
}

function renderRows(rows: any[]) {
  if (!rows?.length) return `<p>—</p>`;
  const lis = rows
    .map(
      r =>
        `<li>${escapeHtml(String(r.occur_date))} ${escapeHtml(String(r.start_time))}-${escapeHtml(
          String(r.end_time)
        )} | ${escapeHtml(String(r.lesson_type ?? '—'))} | ${escapeHtml(String(r.instructorName ?? '—'))}</li>`
    )
    .join('');
  return `<ul>${lis}</ul>`;
}

function escapeHtml(s: string) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
