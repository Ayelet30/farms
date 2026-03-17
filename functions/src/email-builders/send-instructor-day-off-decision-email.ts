function esc(s: any) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function fmtDateIL(d: string) {
  try { return new Date(d).toLocaleDateString('he-IL'); } catch { return d; }
}

type CancelItem = { occurDate: string; startTime?: string; endTime?: string; childName: string };

type Args =
  | {
      kind: 'approved_parent';
      farmName: string;
      parentName: string;
      instructorName: string;
      fromDate: string;
      toDate: string;
      allDay: boolean;
      startTime: string | null;
      endTime: string | null;
      decisionNote: string | null;
      cancellations: CancelItem[];
    }
    | {
      kind: 'created_by_secretary_instructor';
      farmName: string;
      instructorName: string;
      fromDate: string;
      toDate: string;
      allDay: boolean;
      startTime: string | null;
      endTime: string | null;
      decisionNote: string | null;
      impactCount: number;
      requestTypeLabel: string;
    }
  | {
      kind: 'approved_instructor';
      farmName: string;
      instructorName: string;
      fromDate: string;
      toDate: string;
      allDay: boolean;
      startTime: string | null;
      endTime: string | null;
      decisionNote: string | null;
      impactCount: number;
    }
  | {
      kind: 'rejected_instructor';
      farmName: string;
      instructorName: string;
      fromDate: string;
      toDate: string;
      allDay: boolean;
      startTime: string | null;
      endTime: string | null;
      decisionNote: string | null;
    };

function windowText(a: { fromDate: string; toDate: string; allDay: boolean; startTime: string | null; endTime: string | null }) {
  const from = a.fromDate;
  const to = a.toDate || from;

  if (from === to) {
    if (a.allDay) return `${fmtDateIL(from)} — יום חופש מלא`;
    if (a.startTime && a.endTime) return `${fmtDateIL(from)} — ${a.startTime}–${a.endTime}`;
    if (a.startTime && !a.endTime) return `${fmtDateIL(from)} — החל מ־${a.startTime}`;
    return `${fmtDateIL(from)} — יום חופש`;
  }

  if (a.allDay) return `${fmtDateIL(from)}–${fmtDateIL(to)} — חופשה מלאה`;
  if (a.startTime && a.endTime) return `${fmtDateIL(from)}–${fmtDateIL(to)} — בכל יום ${a.startTime}–${a.endTime}`;
  if (a.startTime && !a.endTime) return `${fmtDateIL(from)}–${fmtDateIL(to)} — בכל יום החל מ־${a.startTime}`;
  return `${fmtDateIL(from)}–${fmtDateIL(to)} — חופשה`;
}

export function buildInstructorDayOffDecisionEmail(args: Args) {
  const farmName = esc(args.farmName);

  if (args.kind === 'approved_parent') {
    const subject = `עדכון מהחווה: שיעורים בוטלו`;
    const list = (args.cancellations ?? []).map(x => {
      const line = `${fmtDateIL(x.occurDate)} • ${esc(x.childName)} • ${esc(x.startTime ?? '')}-${esc(x.endTime ?? '')}`;
      return `<li>${line}</li>`;
    }).join('');

    const note = args.decisionNote ? `<p><b>הערה מהמזכירות:</b> ${esc(args.decisionNote)}</p>` : '';

    const html = `
      <div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.5">
        <h2>${farmName}</h2>
        <p>שלום ${esc(args.parentName)},</p>
        ${note}
        <p עקב חופשת מדריך השיעורים הבאים בוטלו:</p>
        <ul>${list || '<li>(לא נמצאו שיעורים לשיוך)</li>'}</ul>
        <p>שיעור מילוי מקום יש לקבוע דרך דף זימון תור באתר או באפליקציה. לחילופין - ניתן ליצור קשר עם המזכירות</p>
      </div>
    `.trim();

    const textLines = (args.cancellations ?? []).map(x =>
      `${fmtDateIL(x.occurDate)} | ${x.childName} | ${(x.startTime ?? '')}-${(x.endTime ?? '')}`
    );

    const text =
      `${args.farmName}\n` +
      `שלום ${args.parentName},\n` +
      `אושרה בקשת חופש למדריך/ה ${args.instructorName}.\n` +
      `חלון החופש: ${windowText(args)}\n` +
      (args.decisionNote ? `הערה: ${args.decisionNote}\n` : '') +
      `השיעורים שבוטלו:\n` +
      (textLines.length ? textLines.join('\n') : '(לא נמצאו שיעורים לשיוך)') +
      `\n`;

    return { subject, html, text };
  }

  if (args.kind === 'approved_instructor') {
    const subject = `הבקשה לחופש אושרה`;
    const note = args.decisionNote ? `<p><b>הערה מהמזכירות:</b> ${esc(args.decisionNote)}</p>` : '';

    const html = `
      <div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.5">
        <h2>${farmName}</h2>
        <p>שלום ${esc(args.instructorName)},</p>
        <p>הבקשה שלך לחופש אושרה.</p>
        <p><b>חלון החופש:</b> ${esc(windowText(args))}</p>
        ${note}
        <p><b>מספר שיעורים שבוטלו:</b> ${esc(args.impactCount)}</p>
      </div>
    `.trim();

    const text =
      `${args.farmName}\n` +
      `שלום ${args.instructorName},\n` +
      `הבקשה שלך לחופש אושרה.\n` +
      `חלון החופש: ${windowText(args)}\n` +
      (args.decisionNote ? `הערה: ${args.decisionNote}\n` : '') +
      `מספר שיעורים שבוטלו: ${args.impactCount}\n`;

    return { subject, html, text };
  }
  if (args.kind === 'created_by_secretary_instructor') {
    const subject = `עודכן עבורך ${args.requestTypeLabel} במערכת`;
    const note = args.decisionNote ? `<p><b>הערה מהמזכירות:</b> ${esc(args.decisionNote)}</p>` : '';

    const html = `
      <div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.5">
        <h2>${farmName}</h2>
        <p>שלום ${esc(args.instructorName)},</p>
        <p>המזכירות עדכנה עבורך <b>${esc(args.requestTypeLabel)}</b> במערכת.</p>
        <p><b>חלון ההיעדרות:</b> ${esc(windowText(args))}</p>
        ${note}
        <p><b>מספר שיעורים שהושפעו:</b> ${esc(args.impactCount)}</p>
      </div>
    `.trim();

    const text =
      `${args.farmName}\n` +
      `שלום ${args.instructorName},\n` +
      `המזכירות עדכנה עבורך ${args.requestTypeLabel} במערכת.\n` +
      `חלון ההיעדרות: ${windowText(args)}\n` +
      (args.decisionNote ? `הערה מהמזכירות: ${args.decisionNote}\n` : '') +
      `מספר שיעורים שהושפעו: ${args.impactCount}\n`;

    return { subject, html, text };
  }
  // rejected_instructor
  const subject = `הבקשה לחופש נדחתה`;
  const note = args.decisionNote ? `<p><b>סיבת דחייה:</b> ${esc(args.decisionNote)}</p>` : '';

  const html = `
    <div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.5">
      <h2>${farmName}</h2>
      <p>שלום ${esc(args.instructorName)},</p>
      <p>הבקשה שלך לחופש נדחתה.</p>
      <p><b>חלון שביקשת:</b> ${esc(windowText(args))}</p>
      ${note}
    </div>
  `.trim();

  const text =
    `${args.farmName}\n` +
    `שלום ${args.instructorName},\n` +
    `הבקשה שלך לחופש נדחתה.\n` +
    `חלון שביקשת: ${windowText(args)}\n` +
    (args.decisionNote ? `סיבה: ${args.decisionNote}\n` : '');

  return { subject, html, text };
}
