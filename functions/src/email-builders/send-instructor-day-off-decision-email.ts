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
  const subject = `הודעה חשובה מ${args.farmName}`;

  const treatmentLines = (args.cancellations ?? []).map(item => {
    const time = String(item.startTime ?? '').trim().slice(0, 5);
    const timeText = time ? ` בשעה ${time}` : '';

    return (
      `הטיפול של ${item.childName}, שנקבע לתאריך ` +
      `${fmtDateIL(item.occurDate)}${timeText}, מבוטל ואינו מחויב.`
    );
  });

  const scopeText =
    `הביטול תקף לתאריכים ולשעות המצוינים בלבד ` +
    `ולמטופלים של המדריך/ה ${args.instructorName} בלבד.`;

  const alternativeText =
    'ככל שיתאפשר ובהתאם לזמינות הקיימת במערכת, ' +
    'החווה תיצור עמכם קשר לצורך הצעת מועד חלופי.';

  const html = `
    <div dir="rtl"
         style="font-family:Arial,sans-serif;line-height:1.7;text-align:right">
      <p>הורים יקרים, שלום וברכה 🌿</p>

      ${treatmentLines
        .map(line => `<p><strong>${esc(line)}</strong></p>`)
        .join('')}

      <p>
        <strong>שימו לב:</strong><br>
        <strong>${esc(scopeText)}</strong>
        טיפולים אצל מדריכים אחרים מתקיימים כרגיל.
      </p>

      <p>הביטול נובע עקב היעדרות המדריך/ה המטפל/ת.</p>

      <p>${esc(alternativeText)}</p>

      <p><strong>טיפול חלופי שיתקיים יחויב כרגיל.</strong></p>

      <p>בברכה,<br>${farmName} 🐴🌿</p>
    </div>
  `.trim();

  const text = [
    'הורים יקרים, שלום וברכה 🌿',
    '',
    treatmentLines.join('\n\n'),
    '',
    'שימו לב:',
    scopeText,
    'טיפולים אצל מדריכים אחרים מתקיימים כרגיל.',
    '',
    'הביטול נובע עקב היעדרות המדריך/ה המטפל/ת.',
    '',
    alternativeText,
    '',
    'טיפול חלופי שיתקיים יחויב כרגיל.',
    '',
    'בברכה,',
    `${args.farmName} 🐴🌿`,
  ].join('\n');

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
