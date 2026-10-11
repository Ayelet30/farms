type RecipientType = 'parent' | 'instructor';

type BuildSecretaryCancelOccurrenceEmailArgs = {
  recipientType: RecipientType;
  farmName: string;
  parentName: string;
  childName: string;
  occurDate: string;
  startTime: string | null;
  endTime: string | null;
  instructorName: string | null;
  note: string | null;
  isMakeupAllowed: boolean;
  isBillable: boolean;
};

function escapeHtml(value: any): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDateHeb(value: string): string {
  const [y, m, d] = String(value || '').slice(0, 10).split('-');

  if (!y || !m || !d) return value;

  return `${d}/${m}/${y.slice(2)}`;
}

function timeRange(startTime: string | null, endTime: string | null): string {
  const s = startTime ? startTime.slice(0, 5) : '';
  const e = endTime ? endTime.slice(0, 5) : '';

  if (s && e) return `${s}-${e}`;
  if (s) return s;
  if (e) return e;

  return 'לא צוינה שעה';
}

export function buildSecretaryCancelOccurrenceEmail(args: BuildSecretaryCancelOccurrenceEmailArgs) {
  const farmName = escapeHtml(args.farmName || 'החווה');
  const childName = escapeHtml(args.childName || 'הילד/ה');
  const parentName = escapeHtml(args.parentName || 'הורה');
  const instructorName = escapeHtml(args.instructorName || 'המדריך/ה');
  const note = escapeHtml(args.note || 'לא צוינה סיבה');
  const occurDate = escapeHtml(formatDateHeb(args.occurDate));
  const hours = escapeHtml(timeRange(args.startTime, args.endTime));

  const makeupText = args.isMakeupAllowed
    ? 'השיעור סומן כזכאי להשלמה.'
    : 'השיעור לא סומן כזכאי להשלמה.';

  const billableText = args.isBillable
    ? 'השיעור סומן כנדרש לחיוב.'
    : 'השיעור לא סומן כנדרש לחיוב.';

  const subject =
    args.recipientType === 'parent'
      ? `עדכון: שיעור של ${args.childName} בוטל`
      : `עדכון: שיעור בוטל על ידי המזכירות`;

  const greeting =
    args.recipientType === 'parent'
      ? `שלום ${parentName},`
      : `שלום ${instructorName},`;

  const mainLine =
    args.recipientType === 'parent'
      ? `השיעור של <strong>${childName}</strong> בוטל על ידי המזכירות.`
      : `השיעור של <strong>${childName}</strong> בוטל על ידי המזכירות.`;

  const html = `
<div dir="rtl" style="font-family:Arial, sans-serif; color:#2f3a28; line-height:1.7;">
  <h2 style="margin:0 0 12px; color:#2f3a28;">ביטול שיעור</h2>

  <p>${greeting}</p>

  <p>${mainLine}</p>

  <div style="background:#fbf7ef; border:1px solid #eadcc9; border-radius:14px; padding:14px 16px; margin:16px 0;">
    <p style="margin:0 0 8px;"><strong>חווה:</strong> ${farmName}</p>
    <p style="margin:0 0 8px;"><strong>ילד/ה:</strong> ${childName}</p>
    <p style="margin:0 0 8px;"><strong>תאריך:</strong> <span dir="ltr">${occurDate}</span></p>
    <p style="margin:0 0 8px;"><strong>שעה:</strong> <span dir="ltr">${hours}</span></p>
    <p style="margin:0;"><strong>מדריך/ה:</strong> ${instructorName}</p>
  </div>

  <p><strong>סיבת ביטול:</strong> ${note}</p>

  <div style="background:#f3f6e9; border:1px solid #dbe3cc; border-radius:14px; padding:12px 14px; margin-top:16px;">
    <p style="margin:0 0 6px;">${escapeHtml(makeupText)}</p>
    <p style="margin:0;">${escapeHtml(billableText)}</p>
  </div>

  <p style="margin-top:18px; color:#687160;">
    הודעה זו נשלחה אוטומטית ממערכת ${farmName}.
  </p>
</div>
`.trim();

  const text = [
    'ביטול שיעור',
    '',
    greeting.replace(/<[^>]+>/g, ''),
    '',
    `השיעור של ${args.childName} בוטל על ידי המזכירות.`,
    '',
    `חווה: ${args.farmName}`,
    `ילד/ה: ${args.childName}`,
    `תאריך: ${formatDateHeb(args.occurDate)}`,
    `שעה: ${timeRange(args.startTime, args.endTime)}`,
    `מדריך/ה: ${args.instructorName || 'לא צוין'}`,
    '',
    `סיבת ביטול: ${args.note || 'לא צוינה סיבה'}`,
    '',
    makeupText,
    billableText,
  ].join('\n');

  return {
    subject,
    html,
    text,
  };
}