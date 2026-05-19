export function buildAvailabilityLessonActionEmail(args: {
  kind: 'parent' | 'instructor';
  farmName: string;
  parentName?: string;
  instructorName: string;
  childName: string;
  actionType: 'move_lesson' | 'cancel_lesson_with_makeup' | 'end_series';
  originalDate?: string | null;
  originalStartTime?: string | null;
  originalEndTime?: string | null;
  newDate?: string | null;
  newStartTime?: string | null;
  newEndTime?: string | null;
}) {
  const actionLabel =
    args.actionType === 'move_lesson'
      ? 'שיעור הוזז'
      : args.actionType === 'cancel_lesson_with_makeup'
        ? 'שיעור בוטל עם אפשרות השלמה'
        : 'סדרה הסתיימה';

  const subject = `עדכון מהחווה: ${actionLabel}`;

  const html = `
    <div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.6">
      <h2>${args.farmName}</h2>
      <p>שלום ${args.kind === 'parent' ? args.parentName || 'הורה' : args.instructorName},</p>
      <p><b>${actionLabel}</b> עבור ${args.childName}.</p>

      ${
        args.originalDate
          ? `<p><b>מועד קודם:</b> ${args.originalDate} ${args.originalStartTime || ''}-${args.originalEndTime || ''}</p>`
          : ''
      }

      ${
        args.newDate
          ? `<p><b>מועד חדש:</b> ${args.newDate} ${args.newStartTime || ''}-${args.newEndTime || ''}</p>`
          : ''
      }

      ${
        args.actionType === 'cancel_lesson_with_makeup'
          ? '<p>ניתן לקבוע שיעור השלמה דרך המערכת או מול המזכירות.</p>'
          : ''
      }
    </div>
  `.trim();

  const text =
    `${args.farmName}\n` +
    `שלום ${args.kind === 'parent' ? args.parentName || 'הורה' : args.instructorName},\n` +
    `${actionLabel} עבור ${args.childName}.\n` +
    (args.originalDate ? `מועד קודם: ${args.originalDate} ${args.originalStartTime || ''}-${args.originalEndTime || ''}\n` : '') +
    (args.newDate ? `מועד חדש: ${args.newDate} ${args.newStartTime || ''}-${args.newEndTime || ''}\n` : '');

  return { subject, html, text };
}