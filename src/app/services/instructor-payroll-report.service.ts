import { Injectable, inject } from '@angular/core';
import { PayrollApiService } from './payroll-api.service';

@Injectable({
  providedIn: 'root',
})
export class InstructorPayrollReportService {
  private readonly api = inject(PayrollApiService);

  async exportMonth(
    year: number,
    month: number,
    ownReport = false,
  ): Promise<number> {
    if (
      !Number.isInteger(year) ||
      !Number.isInteger(month) ||
      month < 1 ||
      month > 12
    ) {
      throw new Error('חודש הדוח אינו תקין');
    }

    const monthText =
      `${year}-${String(month).padStart(2, '0')}`;

    const data = await this.api.call<any>(
      ownReport ? 'ownMonth' : 'month',
      {
        month: `${monthText}-01`,
      },
    );

    data.month = monthText;

    const report = buildPayroll(data);

    const module: any = await import('xlsx');
    const XLSX = module.default ?? module;

    const workbook = XLSX.utils.book_new();

    const sheets: Array<[string, any[]]> = [
      ['סיכום מדריכים', report.summary],
      ['פירוט שעות מדריכים', report.details],
      ['חישוב שכר', report.salary],
      ['פירוט תעריפים', report.rateDetails],
      [
        'בדיקות',
        report.warnings.length
          ? report.warnings
          : [{ 'בדיקה נדרשת': 'לא נמצאו חוסרים בשיוכים ובתעריפים' }],
      ],
    ];

    for (const [name, rows] of sheets) {
      const headers = Array.from(
        new Set<string>(
          rows.flatMap(row => Object.keys(row)),
        ),
      );

      const worksheet = XLSX.utils.json_to_sheet(
        rows,
        { header: headers },
      );

      worksheet['!cols'] = headers.map(header => ({
        wch: Math.min(
          30,
          Math.max(16, header.length + 3),
        ),
      }));

      if (rows.length && headers.length) {
        worksheet['!autofilter'] = {
          ref: XLSX.utils.encode_range({
            s: { r: 0, c: 0 },
            e: {
              r: rows.length,
              c: headers.length - 1,
            },
          }),
        };
      }

      for (let column = 0; column < headers.length; column++) {
        const header = headers[column];

        for (let row = 1; row <= rows.length; row++) {
          const address = XLSX.utils.encode_cell({
            r: row,
            c: column,
          });

          const cell = worksheet[address];

          if (!cell || cell.t !== 'n') {
            continue;
          }

          if (
            header.includes('תעריף') ||
            header.includes('סכום') ||
            header.includes('שכר')
          ) {
            cell.z = '#,##0.00 "₪"';
          } else if (header.includes('שעות')) {
            cell.z = '0.00';
          }
        }
      }

      XLSX.utils.book_append_sheet(
        workbook,
        worksheet,
        name,
      );
    }

    applyPayrollFormulas(XLSX, workbook, report);
    appendAccountantSheet(XLSX, workbook, report, year, month);

    XLSX.writeFile(
      workbook,
      `instructors_payroll_${monthText}.xlsx`,
    );

    return report.warnings.length;
  }
}

export function buildPayroll(data: any) {
  const reference = data?.reference;

  if (
    !reference ||
    !Array.isArray(reference.paymentTypes) ||
    !Array.isArray(reference.paymentRules)
  ) {
    throw new Error(
      'חסרים סוגי התשלום והשיוכים בתשובת השרת',
    );
  }

  const warnings = new Set<string>();
  const people = new Map<string, any>();
  const slots = new Map<string, any>();
  const buckets = new Map<string, any>();

  const seen = new Set<string>();
  const details: any[] = [];

  const instructors = new Map<string, string>(
    (reference.instructors ?? []).map((row: any) => [
      String(row.id),
      row.name,
    ]),
  );

  const externals = new Map<string, string>(
    (reference.externals ?? []).map((row: any) => [
      String(row.id),
      row.full_name,
    ]),
  );

  const types = new Map<string, any>(
    reference.paymentTypes.map((row: any) => [
      row.id,
      row,
    ]),
  );

  const time = (value: any): string =>
    String(value ?? '').slice(0, 5);

  const minute = (value: string): number => {
    const [hours, minutes] = value.split(':').map(Number);
    return hours * 60 + minutes;
  };

  const duration = (
    start: string,
    end: string,
  ): number => {
    const validTime = /^([01]\d|2[0-3]):[0-5]\d$/;

    if (
      !validTime.test(start) ||
      !validTime.test(end) ||
      end <= start
    ) {
      throw new Error(
        'נמצא שיעור או הפסקה עם שעות לא תקינות',
      );
    }

    return minute(end) - minute(start);
  };

  const clock = (minutes: number): string =>
    `${Math.floor(minutes / 60)}:${
      String(minutes % 60).padStart(2, '0')
    }`;

  const person = (
    id: string,
    name: string,
    external: boolean,
  ): any => {
    if (!people.has(id)) {
      people.set(id, {
        id,
        name,
        external,

        privateCount: 0,
        pairCount: 0,
        groupCount: 0,

        privateMinutes: 0,
        pairMinutes: 0,
        groupMinutes: 0,

        breakCount: 0,
        breakMinutes: 0,

        intakeCount: 0,
        intakeMinutes: 0,

        work: new Set<string>(),
        vacation: new Set<string>(),
        sick: new Set<string>(),
      });
    }

    return people.get(id);
  };

  const record = (
    payee: any,
    slot: any,
    ridingId: string | null,
    ridingName: string,
    childrenCount: number,
    isBreak: boolean,
  ): void => {
    const minutes = duration(slot.start, slot.end);

        const normalizeName = (value: any): string =>
      String(value ?? '')
        .trim()
        .replace(/\s+/g, '')
        .replace(/שלישייה/g, 'שלישיה')
        .replace(/רביעייה/g, 'רביעיה');

    const ridingTypesById = new Map<string, any>(
      (reference.ridingTypes ?? []).map((item: any) => [
        String(item.id),
        item,
      ]),
    );

    // מערבי מזוהה לפי סוג הרכיבה או לפי שיוך מפורש
    // לסוג התשלום "מערבי".
    const western = !isBreak && (
      (slot.rows ?? []).some((lesson: any) => {
        const ridingType = ridingTypesById.get(
          String(lesson.riding_type_id),
        );

        const description = [
          lesson.riding_type_name,
          lesson.riding_type_code,
          ridingType?.name,
          ridingType?.code,
        ].join(' ');

        return /מערבי|western/i.test(description);
      }) ||
      reference.paymentRules.some((rule: any) => {
        const mappedType = types.get(rule.payment_type_id);

        return (
          rule.is_active &&
          normalizeName(mappedType?.name) === 'מערבי' &&
          (slot.rows ?? []).some(
            (lesson: any) =>
              lesson.riding_type_id === rule.riding_type_id,
          ) &&
          childrenCount >= rule.min_participants &&
          childrenCount <= rule.max_participants
        );
      })
    );

    const categoryName =
      western
        ? 'מערבי'
        : isBreak || childrenCount <= 1
          ? 'פרטי'
          : childrenCount === 2
            ? 'זוגי'
            : childrenCount === 3
              ? 'שלישיה'
              : childrenCount === 4
                ? 'רביעיה'
                : 'קבוצה';

    const matchingTypes = [...types.values()].filter(
      (type: any) =>
        normalizeName(type.name) === categoryName,
    );

    // משתמשים במזהה הקיים כדי לשמור על התעריפים שהוגדרו.
    // אין בחירה שרירותית אם קיימים שני סוגים בשם זהה.
    const paymentType =
      matchingTypes.length === 1
        ? matchingTypes[0]
        : null;

    if (!paymentType) {
      warnings.add(
        `חסר שיוך חד־משמעי: ${ridingName}, ` +
        `${childrenCount} ילדים, ${payee.name}, ` +
        `${slot.date} ${slot.start}`,
      );
    }

    const rate =
      payee.external || !paymentType
        ? null
        : (reference.rates ?? [])
            .filter(
              (row: any) =>
                row.instructor_id === slot.id &&
                row.payment_type_id === paymentType.id &&
                row.effective_from <= slot.date,
            )
            .sort((a: any, b: any) =>
              b.effective_from.localeCompare(a.effective_from),
            )[0];

    if (!payee.external && paymentType && !rate) {
      warnings.add(
        `חסר תעריף: ${payee.name}, ` +
        `${paymentType.name}, ${slot.date}`,
      );
    }

    const label = paymentType?.name ?? 'ללא שיוך';

    const typeId =
      paymentType?.id ?? `missing:${ridingId}`;

    const key = JSON.stringify([
      payee.id,
      typeId,
      rate?.id ?? 'missing',
    ]);

    if (!buckets.has(key)) {
      buckets.set(key, {
        personId: payee.id,
        name: payee.name,
        external: payee.external,
        typeId,
        label,

        hourly: rate?.hourly_agorot ?? 0,
        effective: rate?.effective_from ?? '',

        minutes: 0,

        missing:
          !paymentType ||
          (!payee.external && !rate),
      });
    }

    buckets.get(key).minutes += minutes;

    if (isBreak) {
      payee.breakCount++;
      payee.breakMinutes += minutes;
    } else {
      // הסיכום הישן נשמר; חישוב הכסף משתמש בסוג התשלום.
      const category =
        childrenCount === 1
          ? 'private'
          : childrenCount === 2
            ? 'pair'
            : 'group';

      payee[`${category}Count`]++;
      payee[`${category}Minutes`] += minutes;

      // אינטק הוא מידע נוסף בלבד, ללא כפל שעות.
      if (slot.intake) {
        payee.intakeCount++;
        payee.intakeMinutes += minutes;
      }
    }

    if (slot.active) {
      payee.work.add(slot.date);
    }

    details.push({
      'תאריך': slot.date,
      'מדריך/מחליף': payee.name,
      'מדריך מקורי': instructors.get(slot.id) ?? slot.id,

      'סוג עובד':
        payee.external ? 'מחליף חיצוני' : 'מדריך',

      'סוג רכיבה': ridingName,
      'סוג תשלום': label,
      'מספר ילדים': childrenCount,

      'שעת התחלה': slot.start,
      'שעת סיום': slot.end,

      'משך': clock(minutes),
      'דקות': minutes,

      'האם אינטק': slot.intake ? 'כן' : 'לא',
      'סטטוס': slot.status ?? '',
    });
  };

  // מאחדים את ילדי המשבצת לפני חישוב שעות ושכר.
  for (const lesson of data.lessons ?? []) {
    const occurrence =
      `${lesson.lesson_id}|${lesson.lesson_date}`;

    if (seen.has(occurrence)) {
      throw new Error(
        `כפילות מופע שיעור: ${occurrence}`,
      );
    }

    seen.add(occurrence);

    const paid =
      lesson.status === 'אושר' ||
      lesson.status === 'הושלם' ||
      (
        lesson.status === 'בוטל' &&
        lesson.canceller_role === 'parent'
      );

    if (!paid) {
      continue;
    }

    const id = String(lesson.instructor_id ?? '');

    if (!id || !lesson.lesson_date) {
      throw new Error('חסר מדריך או תאריך בשיעור');
    }

    const start = time(lesson.start_time);
    const end = time(lesson.end_time);

    duration(start, end);

    const key = JSON.stringify([
      id,
      lesson.lesson_date,
      start,
      end,
    ]);

    if (!slots.has(key)) {
      slots.set(key, {
        id,
        date: lesson.lesson_date,
        start,
        end,
        rows: [],
      });
    }

    slots.get(key).rows.push(lesson);
  }

  const originalActivity = new Set<string>();

  for (const slot of slots.values()) {
    const rows = slot.rows;

    const ridingIds = new Set(
      rows.map((lesson: any) => lesson.riding_type_id),
    );

    const payees = new Set(
      rows.map(
        (lesson: any) =>
          lesson.external_id ?? 'original',
      ),
    );

    const ridingId =
  ridingIds.size === 1 && rows[0].riding_type_id
    ? rows[0].riding_type_id
    : null;

const ridingName = [
  ...new Set<string>(
    rows
      .map((lesson: any) =>
        String(lesson.riding_type_name ?? '').trim(),
      )
      .filter(Boolean),
  ),
].join(' / ') || 'סוג רכיבה חסר';

    if (payees.size !== 1) {
      throw new Error(
        `החלפה חלקית במשבצת: ${slot.date} ${slot.start}. ` +
        'יש לבדוק את שיוך כל הילדים',
      );
    }

    // משאירים גם את המדריך המקורי בסיכום, עם אפס
    // שעות אם כל שיעוריו הועברו למחליף.
    person(
      `instructor:${slot.id}`,
      instructors.get(slot.id) ?? slot.id,
      false,
    );

    const externalId = rows[0].external_id;

    if (
      externalId &&
      rows.some(
        (lesson: any) =>
          time(lesson.cover_start) !== slot.start ||
          time(lesson.cover_end) !== slot.end ||
          String(lesson.original_instructor_id) !== slot.id,
      )
    ) {
      throw new Error(
        'השיעור השתנה לאחר שיבוץ המחליף. נדרשת בדיקה',
      );
    }

    const payee = externalId
      ? person(
          `external:${externalId}`,
          externals.get(externalId) ?? 'מחליף חיצוני',
          true,
        )
      : people.get(`instructor:${slot.id}`);

    slot.active = rows.some(
      (lesson: any) =>
        lesson.status === 'אושר' ||
        lesson.status === 'הושלם',
    );

    slot.intake = rows.some(
      (lesson: any) =>
        String(lesson.payment_plan_name ?? '').trim() === 'אינטק',
    );

    slot.status = [
      ...new Set(rows.map((lesson: any) => lesson.status)),
    ].join(', ');

    if (!externalId && slot.active) {
      originalActivity.add(`${slot.id}|${slot.date}`);
    }

       const childKey = (lesson: any): string =>
      String(lesson.child_id ?? lesson.lesson_id);

    const isActiveLesson = (lesson: any): boolean =>
      lesson.status === 'אושר' ||
      lesson.status === 'הושלם';

    const activeChildren = new Set<string>(
      rows
        .filter(isActiveLesson)
        .map(childKey),
    );

    const cancelledChildren = new Set<string>(
      rows
        .filter(
          (lesson: any) =>
            lesson.status === 'בוטל' &&
            lesson.canceller_role === 'parent' &&
            !activeChildren.has(childKey(lesson)),
        )
        .map(childKey),
    );

    const intakeChildren = new Set<string>(
      rows
        .filter(
          (lesson: any) =>
            isActiveLesson(lesson) &&
            String(lesson.payment_plan_name ?? '').trim() === 'אינטק',
        )
        .map(childKey),
    );

    // באותה משבצת, כל אינטק ממלא מקום אחד שהתפנה
    // עקב ביטול הורה. המקום אינו נספר פעמיים.
    const remainingCancellations = Math.max(
      0,
      cancelledChildren.size - intakeChildren.size,
    );

    const childrenCount =
      activeChildren.size + remainingCancellations;

   record(
  payee,
  slot,
  ridingId,
  ridingName,
  childrenCount,
  false,
);
  }

  // ימי היעדרות והגנה מפני צבירת הפסקות ביום היעדרות.
  const blockedDays = new Set<string>();

  const month = String(
    data.month ??
    (data.lessons ?? [])[0]?.lesson_date ??
    '',
  ).slice(0, 7);

  for (const absence of data.absences ?? []) {
    if (!absence.all_day) {
      continue;
    }

    const id = String(absence.instructor_id_number);

    const payee = person(
      `instructor:${id}`,
      instructors.get(id) ?? id,
      false,
    );

    const endDate = String(absence.to_ts).slice(0, 10);
    const endTime = String(absence.to_ts).slice(11, 19);

    const cursor = new Date(
      `${String(absence.from_ts).slice(0, 10)}T12:00:00Z`,
    );

    if (!Number.isFinite(cursor.getTime())) {
      throw new Error('תאריך היעדרות לא תקין');
    }

    while (
      cursor.toISOString().slice(0, 10) <= endDate
    ) {
      const day = cursor.toISOString().slice(0, 10);

      const inMonth = !month || day.startsWith(month);

      const excludedEnd =
        day === endDate &&
        endTime === '00:00:00';

      if (inMonth && !excludedEnd) {
        blockedDays.add(`${id}|${day}`);

        const target =
          String(absence.category).toUpperCase() === 'SICK'
            ? payee.sick
            : payee.vacation;

        target.add(day);
      }

      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  const breakTypes = (reference.ridingTypes ?? []).filter(
    (type: any) =>
      String(type.code).toLowerCase() === 'break',
  );

  const breakSeen = new Set<string>();

  for (const item of data.breaks ?? []) {
    const id = String(item.instructor_id_number);
    const day = item.break_date;

    if (
      !originalActivity.has(`${id}|${day}`) ||
      blockedDays.has(`${id}|${day}`)
    ) {
      continue;
    }

    const start = time(item.start_time);
    const end = time(item.end_time);

    const key = JSON.stringify([id, day, start, end]);

    if (breakSeen.has(key)) {
      continue;
    }

    breakSeen.add(key);

    const overlapsLesson = [...slots.values()].some(
      slot =>
        slot.id === id &&
        slot.date === day &&
        slot.start < end &&
        slot.end > start,
    );

    if (overlapsLesson) {
      continue;
    }

    const overlapsCover = (data.covers ?? []).some(
      (cover: any) =>
        String(cover.original_instructor_id) === id &&
        cover.occur_date === day &&
        time(cover.start_time) < end &&
        time(cover.end_time) > start,
    );

    if (overlapsCover) {
      continue;
    }

    const payee = person(
      `instructor:${id}`,
      instructors.get(id) ?? id,
      false,
    );

    record(
      payee,
      {
        id,
        date: day,
        start,
        end,
        active: true,
        intake: false,
        status: '',
      },
      breakTypes.length === 1 ? breakTypes[0].id : null,
      'הפסקה',
      0,
      true,
    );
  }

  // צוברים דקות לכל סוג וגרסת תעריף, ואז מעגלים לאגורה.
  const financial = [...buckets.values()].map(bucket => ({
  ...bucket,

  amount: bucket.external
    ? null
    : Math.round(
        bucket.minutes * bucket.hourly / 60,
      ),
}));

  const orderedPeople = [...people.values()].sort(
    (a, b) => a.name.localeCompare(b.name, 'he'),
  );

  const totalMinutes = (payee: any): number =>
    payee.privateMinutes +
    payee.pairMinutes +
    payee.groupMinutes +
    payee.breakMinutes;

  const totalFor = (payee: any): number | string => {
    const own = financial.filter(
      bucket => bucket.personId === payee.id,
    );

    if (payee.external) {
      return 'תשלום חיצוני';
    }

    return own.reduce(
      (sum, bucket) => sum + (bucket.amount ?? 0),
      0,
    ) / 100;
  };

  const summary = orderedPeople.map(payee => ({
    'מדריך/מחליף': payee.name,
    'סוג עובד': payee.external ? 'מחליף חיצוני' : 'מדריך',

    'מספר שיעורים פרטיים': payee.privateCount,
    'זמן שיעורים פרטיים': clock(payee.privateMinutes),

    'מספר שיעורים זוגיים': payee.pairCount,
    'זמן שיעורים זוגיים': clock(payee.pairMinutes),

    'מספר שיעורים קבוצתיים': payee.groupCount,
    'זמן שיעורים קבוצתיים': clock(payee.groupMinutes),

    'מזהה עובד': payee.id,

    'סה״כ מספר שיעורים':
      payee.privateCount + payee.pairCount + payee.groupCount,

    'סה״כ זמן שיעורים': clock(
      payee.privateMinutes +
      payee.pairMinutes +
      payee.groupMinutes,
    ),

    'מספר הפסקות': payee.breakCount,
    'זמן הפסקות': clock(payee.breakMinutes),

    'מספר פרטי + הפסקות':
      payee.privateCount + payee.breakCount,

    'זמן פרטי + הפסקות': clock(
      payee.privateMinutes + payee.breakMinutes,
    ),

    'מספר אינטייקים': payee.intakeCount,
    'זמן אינטייקים': clock(payee.intakeMinutes),

    'סה״כ זמן לתשלום': clock(totalMinutes(payee)),

    'מספר ימי עבודה': payee.work.size,
    'מספר ימי חופש': payee.vacation.size,
    'מספר ימי מחלה': payee.sick.size,

    'סה״כ שכר': totalFor(payee),
  }));

  const columns = new Map<string, string>();

  for (const type of reference.paymentTypes) {
    if (type.is_active) {
      columns.set(type.id, type.name);
    }
  }

  // גם סוג שאינו פעיל כיום יוצג אם שימש בחודש הדוח.
  for (const bucket of financial) {
    columns.set(bucket.typeId, bucket.label);
  }

  const salary = orderedPeople.map(payee => {
    const row: Record<string, string | number> = {
      'מדריך/מחליף': payee.name,
      'סוג עובד':
        payee.external ? 'מחליף חיצוני' : 'מדריך',

        'מזהה עובד': payee.id,

      'ימי עבודה': payee.work.size,
    };

    for (const [id, label] of columns) {
      const own = financial.filter(
        bucket =>
          bucket.personId === payee.id &&
          bucket.typeId === id,
      );

      const minutes = own.reduce(
        (sum, bucket) => sum + bucket.minutes,
        0,
      );

      const hourlyValues = new Set(
        own.map(bucket => bucket.hourly),
      );

      row[`${label} — שעות`] = minutes / 60;

      row[`${label} — תעריף`] =
  !own.length
    ? ''
    : payee.external
      ? 'תשלום חיצוני'
      : hourlyValues.size > 1
        ? 'משתנה — ראו פירוט'
        : own[0].hourly / 100;

row[`${label} — סכום`] =
  !own.length
    ? ''
    : payee.external
      ? 'תשלום חיצוני'
      : own.reduce(
          (sum, bucket) =>
            sum + (bucket.amount ?? 0),
          0,
        ) / 100;
    }

    row['סה״כ שעות'] = totalMinutes(payee) / 60;
    row['סה״כ שכר'] = totalFor(payee);

    return row;
  });

  const rateDetails = financial.map(bucket => ({
    'מדריך/מחליף': bucket.name,
    'סוג תשלום': bucket.label,

    'מזהה עובד': bucket.personId,

    'שעות': bucket.minutes / 60,

    'תעריף':
      bucket.external
        ? 'תשלום חיצוני'
        : bucket.hourly === null
          ? 'חסר'
          : bucket.hourly / 100,

    'מתאריך תעריף': bucket.effective,

    'סכום':
      bucket.external
        ? 'תשלום חיצוני'
        : bucket.amount === null
          ? 'חסר'
          : bucket.amount / 100,
  }));

  return {
    summary,
    details,
    salary,
    rateDetails,

    warnings: [...warnings].map(message => ({
      'בדיקה נדרשת': message,
    })),
  };
}

function applyPayrollFormulas(
  XLSX: any,
  workbook: any,
  report: any,
): void {
  const salarySheet = workbook.Sheets['חישוב שכר'];
  const detailSheet = workbook.Sheets['פירוט תעריפים'];
  const summarySheet = workbook.Sheets['סיכום מדריכים'];

  const headers = (rows: any[]): string[] =>
    Array.from(
      new Set<string>(
        rows.flatMap(row => Object.keys(row)),
      ),
    );

  const salaryHeaders = headers(report.salary);
  const detailHeaders = headers(report.rateDetails);
  const summaryHeaders = headers(report.summary);

  const address = (
    columns: string[],
    header: string,
    rowIndex: number,
  ): string => {
    const column = columns.indexOf(header);

    if (column < 0) {
      throw new Error(`עמודה חסרה בדוח: ${header}`);
    }

    return XLSX.utils.encode_cell({
      r: rowIndex + 1,
      c: column,
    });
  };

  const formula = (
    sheet: any,
    cellAddress: string,
    expression: string,
  ): void => {
    const cell = sheet[cellAddress];

    if (!cell || cell.t !== 'n') {
      return;
    }

    cell.f = expression;
  };

  // כשהתעריף אחיד, עורכים אותו בגיליון חישוב שכר.
  // שורות הפירוט מפנות לאותו תא.
  report.rateDetails.forEach((detail: any, index: number) => {
    const salaryIndex = report.salary.findIndex(
      (row: any) =>
        row['מזהה עובד'] === detail['מזהה עובד'],
    );

    if (salaryIndex < 0) {
      return;
    }

    const rateHeader =
      `${detail['סוג תשלום']} — תעריף`;

    const salaryRow = report.salary[salaryIndex];

    const rateAddress = address(
      detailHeaders,
      'תעריף',
      index,
    );

    if (typeof salaryRow[rateHeader] === 'number') {
      const sourceAddress = address(
        salaryHeaders,
        rateHeader,
        salaryIndex,
      );

      formula(
        detailSheet,
        rateAddress,
        `'חישוב שכר'!${sourceAddress}`,
      );
    }

    if (typeof detail['סכום'] === 'number') {
      const hoursAddress = address(
        detailHeaders,
        'שעות',
        index,
      );

      formula(
        detailSheet,
        address(detailHeaders, 'סכום', index),
        `ROUND(${hoursAddress}*${rateAddress},2)`,
      );
    }
  });

  report.salary.forEach((row: any, index: number) => {
    const amountCells: string[] = [];

    for (const header of salaryHeaders) {
      if (!header.endsWith(' — סכום')) {
        continue;
      }

      const typeName = header.slice(
        0,
        -' — סכום'.length,
      );

      const matchingCells = report.rateDetails
        .map((detail: any, detailIndex: number) => {
          if (
            detail['מזהה עובד'] !== row['מזהה עובד'] ||
            detail['סוג תשלום'] !== typeName
          ) {
            return null;
          }

          return `'פירוט תעריפים'!${
            address(detailHeaders, 'סכום', detailIndex)
          }`;
        })
        .filter(Boolean);

      const target = address(
        salaryHeaders,
        header,
        index,
      );

      if (typeof row[header] === 'number') {
        formula(
          salarySheet,
          target,
          matchingCells.length
            ? `SUM(${matchingCells.join(',')})`
            : '0',
        );

        amountCells.push(target);
      }
    }

    if (typeof row['סה״כ שכר'] === 'number') {
      formula(
        salarySheet,
        address(salaryHeaders, 'סה״כ שכר', index),
        amountCells.length
          ? `SUM(${amountCells.join(',')})`
          : '0',
      );
    }
  });

  // סיכום המדריכים מתעדכן לפי גיליון חישוב השכר.
  if (report.salary.length) {
    const idColumn = XLSX.utils.encode_col(
      salaryHeaders.indexOf('מזהה עובד'),
    );

    const totalColumn = XLSX.utils.encode_col(
      salaryHeaders.indexOf('סה״כ שכר'),
    );

    const lastRow = report.salary.length + 1;

    report.summary.forEach((row: any, index: number) => {
      if (typeof row['סה״כ שכר'] !== 'number') {
        return;
      }

      const ownId = address(
        summaryHeaders,
        'מזהה עובד',
        index,
      );

      formula(
        summarySheet,
        address(summaryHeaders, 'סה״כ שכר', index),
        `SUMIF('חישוב שכר'!$${idColumn}$2:$${idColumn}$${lastRow},` +
        `${ownId},` +
        `'חישוב שכר'!$${totalColumn}$2:$${totalColumn}$${lastRow})`,
      );
    });
  }

  for (const [sheet, columns] of [
    [salarySheet, salaryHeaders],
    [detailSheet, detailHeaders],
    [summarySheet, summaryHeaders],
  ] as Array<[any, string[]]>) {
    const column = columns.indexOf('מזהה עובד');

    if (column >= 0) {
      sheet['!cols'] ??= [];

      sheet['!cols'][column] = {
        ...sheet['!cols'][column],
        hidden: true,
      };
    }
  }

  workbook.Workbook ??= {};

  workbook.Workbook.CalcPr = {
    ...workbook.Workbook.CalcPr,
    calcMode: 'auto',
    fullCalcOnLoad: true,
    forceFullCalc: true,
  };
}

function appendAccountantSheet(
  XLSX: any,
  workbook: any,
  report: any,
  year: number,
  month: number,
): void {
  const categories = [
    { title: 'פרטי + הפסקות', names: ['פרטי'] },
    { title: 'זוגי', names: ['זוגי'] },
    { title: 'שלישייה', names: ['שלישייה', 'שלישיה'] },
    { title: 'רביעייה', names: ['רביעייה', 'רביעיה'] },
    { title: 'קבוצה', names: ['קבוצה'] },
    { title: 'מערבי', names: ['מערבי'] },
  ];

  const salaryHeaders = Array.from(
    new Set<string>(
      report.salary.flatMap((row: any) => Object.keys(row)),
    ),
  );

  const sourceCell = (
    rowIndex: number,
    header: string,
  ): string | null => {
    const column = salaryHeaders.indexOf(header);

    return column < 0
      ? null
      : `'חישוב שכר'!${XLSX.utils.encode_cell({
          r: rowIndex + 1,
          c: column,
        })}`;
  };

  // A: מספר, B: שם, C: ימים.
  // D:O: שישה זוגות שעות ותעריף.
  // P: סך שעות, Q: נסיעות, R: ניהול, S: בונוס.
  // T: חופשה, U: מחלה, V: מפרעות, W: סיום עבודה.
  // X:Z: הערות.
  const rows: any[][] = Array.from(
    { length: 8 },
    () => [],
  );

  rows[0][0] = 'דוח נתוני שכר';
  rows[1][0] = `חודש ${String(month).padStart(2, '0')}/${year}`;

  rows[5][2] = 'סה״כ ימים ושעות לפי דוח נוכחות';

  rows[6][0] = 'מספר';
  rows[6][1] = 'שם העובד/ת';
  rows[6][2] = 'ימי עבודה';

  categories.forEach((category, index) => {
    const column = 3 + index * 2;

    rows[6][column] = category.title;
    rows[7][column] = 'שעות';
    rows[7][column + 1] = 'תעריף';
  });

  rows[6][15] = 'סה״כ שעות';
  rows[6][19] = 'היעדרות בימים';

  rows[7][16] = 'נסיעות יומי';
  rows[7][17] = 'ניהול';
  rows[7][18] = 'בונוס';
  rows[7][19] = 'חופשה';
  rows[7][20] = 'מחלה';
  rows[7][21] = 'מפרעות';
  rows[7][22] = 'תאריך סיום עבודה';
  rows[7][23] = 'הערות לתלוש';

  const summaryById = new Map<string, any>(
    report.summary.map((row: any) => [
      row['מזהה עובד'],
      row,
    ]),
  );

  report.salary.forEach((salary: any, index: number) => {
    const summary = summaryById.get(salary['מזהה עובד']);
    const row: any[] = [];

    row[0] = index + 1;
    row[1] = salary['מדריך/מחליף'];
    row[2] = salary['ימי עבודה'] ?? 0;

    categories.forEach((category, categoryIndex) => {
      const name = category.names.find(
        candidate =>
          Object.prototype.hasOwnProperty.call(
            salary,
            `${candidate} — שעות`,
          ),
      );

      const column = 3 + categoryIndex * 2;

      row[column] = name
        ? salary[`${name} — שעות`] ?? 0
        : 0;

      row[column + 1] = name
        ? salary[`${name} — תעריף`] === ''
          ? 0
          : salary[`${name} — תעריף`] ?? 0
        : 0;
    });

    row[15] = salary['סה״כ שעות'] ?? 0;

    // רכיבים ידניים נשארים ריקים.
    // ימי היעדרות אינם אישור אוטומטי לתשלום.
    row[19] = summary?.['מספר ימי חופש'] ?? 0;
    row[20] = summary?.['מספר ימי מחלה'] ?? 0;

    const notes: string[] = [];

    if (salary['סוג עובד'] === 'מחליף חיצוני') {
      notes.push('מחליף חיצוני — תשלום עצמאי');
    }

    if (
      categories.some(category =>
        category.names.some(name =>
          String(salary[`${name} — תעריף`] ?? '')
            .includes('משתנה'),
        ),
      )
    ) {
      notes.push('תעריפים משתנים במהלך החודש — ראו פירוט תעריפים');
    }

    const unclassified = Number(salary['ללא שיוך — שעות'] ?? 0);

    if (unclassified > 0) {
      notes.push(`${unclassified} שעות ללא סיווג — נדרשת בדיקה`);
    }

    if (row[19] || row[20]) {
      notes.push('ימי ההיעדרות מוצגים לבדיקה ואישור');
    }

    row[23] = notes.join('; ');
    rows.push(row);
  });

  const totalRowIndex = rows.length;
  rows.push(['', 'סה״כ']);

  const sheet = XLSX.utils.aoa_to_sheet(rows);

  const setFormula = (
    row: number,
    column: number,
    expression: string,
    value: number | string,
  ): void => {
    sheet[XLSX.utils.encode_cell({ r: row, c: column })] = {
      t: typeof value === 'number' ? 'n' : 's',
      v: value,
      f: expression,
    };
  };

  report.salary.forEach((salary: any, index: number) => {
    const targetRow = index + 8;
    const excelRow = targetRow + 1;

    categories.forEach((category, categoryIndex) => {
      const name = category.names.find(
        candidate =>
          Object.prototype.hasOwnProperty.call(
            salary,
            `${candidate} — שעות`,
          ),
      );

      if (!name) {
        return;
      }

      const column = 3 + categoryIndex * 2;
      const hoursSource = sourceCell(index, `${name} — שעות`);
      const rateSource = sourceCell(index, `${name} — תעריף`);

      if (hoursSource) {
        setFormula(
          targetRow,
          column,
          hoursSource,
          rows[targetRow][column],
        );
      }

      // תעריף מספרי מקושר לתא העריכה בגיליון חישוב שכר.
      // תעריף משתנה או תשלום חיצוני נשמרים כטקסט.
      if (
        rateSource &&
        typeof salary[`${name} — תעריף`] === 'number'
      ) {
        setFormula(
          targetRow,
          column + 1,
          rateSource,
          rows[targetRow][column + 1],
        );
      }
    });

    setFormula(
      targetRow,
      15,
      `SUM(D${excelRow},F${excelRow},H${excelRow},` +
        `J${excelRow},L${excelRow},N${excelRow})`,
      salary['סה״כ שעות'] ?? 0,
    );
  });

  // סיכום שעות וימים בלבד; אין לסכם תעריפים יומיים.
  for (const column of [2, 3, 5, 7, 9, 11, 13, 15, 19, 20]) {
    const letter = XLSX.utils.encode_col(column);
    const value = report.salary.reduce(
      (sum: number, _: any, index: number) =>
        sum + Number(rows[index + 8][column] ?? 0),
      0,
    );

    setFormula(
      totalRowIndex,
      column,
      report.salary.length
        ? `SUM(${letter}9:${letter}${totalRowIndex})`
        : '0',
      value,
    );
  }

  sheet['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 25 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 25 } },
    { s: { r: 5, c: 2 }, e: { r: 5, c: 15 } },
    { s: { r: 6, c: 0 }, e: { r: 7, c: 0 } },
    { s: { r: 6, c: 1 }, e: { r: 7, c: 1 } },
    { s: { r: 6, c: 2 }, e: { r: 7, c: 2 } },
    { s: { r: 6, c: 15 }, e: { r: 7, c: 15 } },
    { s: { r: 6, c: 19 }, e: { r: 6, c: 20 } },
    { s: { r: 7, c: 23 }, e: { r: 7, c: 25 } },
    ...categories.map((_, index) => ({
      s: { r: 6, c: 3 + index * 2 },
      e: { r: 6, c: 4 + index * 2 },
    })),
    ...report.salary.map((_: any, index: number) => ({
      s: { r: index + 8, c: 23 },
      e: { r: index + 8, c: 25 },
    })),
  ];

  sheet['!cols'] = Array.from({ length: 26 }, (_, column) => ({
    wch:
      column === 0 ? 7 :
      column === 1 ? 25 :
      column === 22 ? 18 :
      column >= 23 ? 15 :
      12,
  }));

  sheet['!rows'] = rows.map((_, index) => ({
    hpt: index === 6 || index === 7 ? 32 : 24,
  }));

  for (let row = 8; row <= totalRowIndex; row++) {
    for (let column = 3; column <= 18; column++) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];

      if (cell?.t === 'n') {
        cell.z = '0.00';
      }
    }
  }

  workbook.Workbook ??= {};
  workbook.Workbook.Views ??= [{}];

  if (!workbook.Workbook.Views.length) {
    workbook.Workbook.Views.push({});
  }

  workbook.Workbook.Views[0].RTL = true;

  XLSX.utils.book_append_sheet(workbook, sheet, 'דוח לרואה חשבון');

  // מציגים את הטאב החדש ראשון.
  workbook.SheetNames = [
    'דוח לרואה חשבון',
    ...workbook.SheetNames.filter(
      (name: string) => name !== 'דוח לרואה חשבון',
    ),
  ];
}