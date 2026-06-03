function esc(s: any) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function fmtDateIL(d: any) {
    if (!d) return '—';
    try {
        return new Date(String(d)).toLocaleDateString('he-IL');
    } catch {
        return String(d);
    }
}

type Args = {
    kind: 'approved' | 'rejected';
    farmName: string;
    riderName: string;
    horseName?: string | null;
    serviceName: string;
    serviceModeLabel: string;
    fromDate?: string | null;
    toDate?: string | null;
    decisionNote?: string | null;
};

export function buildRiderServiceDecisionEmail(args: Args) {
    const approved = args.kind === 'approved';

    const subject = approved
        ? `בקשת השירות אושרה`
        : `בקשת השירות נדחתה`;

    const noteTitle = approved ? 'הערה מהמזכירות' : 'סיבת דחייה';

    const note = args.decisionNote
        ? `<p><b>${noteTitle}:</b> ${esc(args.decisionNote)}</p>`
        : '';

    const html = `
    <div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.6">
      <h2>${esc(args.farmName)}</h2>
      <p>שלום ${esc(args.riderName)},</p>
      <p>
        בקשת השירות שלך
        <b>${esc(args.serviceName)}</b>
        ${approved ? 'אושרה' : 'נדחתה'}.
      </p>

      <p><b>סוג שירות:</b> ${esc(args.serviceModeLabel)}</p>
      ${args.horseName ? `<p><b>סוס/ה:</b> ${esc(args.horseName)}</p>` : ''}
      <p><b>מתאריך:</b> ${esc(fmtDateIL(args.fromDate))}</p>
      ${args.toDate ? `<p><b>עד תאריך:</b> ${esc(fmtDateIL(args.toDate))}</p>` : ''}

      ${note}
    </div>
  `.trim();

    const text =
        `${args.farmName}\n` +
        `שלום ${args.riderName},\n` +
        `בקשת השירות "${args.serviceName}" ${approved ? 'אושרה' : 'נדחתה'}.\n` +
        `סוג שירות: ${args.serviceModeLabel}\n` +
        (args.horseName ? `סוס/ה: ${args.horseName}\n` : '') +
        `מתאריך: ${fmtDateIL(args.fromDate)}\n` +
        (args.toDate ? `עד תאריך: ${fmtDateIL(args.toDate)}\n` : '') +
        (args.decisionNote ? `${noteTitle}: ${args.decisionNote}\n` : '');

    return { subject, html, text };
}