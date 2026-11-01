import { randomUUID } from 'node:crypto';

const KIND = 'clalit_rejections_v1';

const fail = (message: string): never => {
  throw new Error(message);
};

const check = (result: any) => {
  if (result.error) {
    throw result.error;
  }

  return result.data;
};

const keyOf = (lesson: any) =>
  `${lesson.lesson_id}__${lesson.occur_date}__${lesson.child_id}`;

const clean = (value: unknown) =>
  String(value ?? '')
    .replace(/[\u200e\u200f\u202a-\u202e]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export function rejectionCode(
  reason: string,
): string {
  const text = clean(reason);

  const missingInvoice = text.includes(
    'לא צורפה חשבונית השתתפות עצמית',
  );

  const referralReview =
    /הפני(?:יה|ה|ות)/.test(text);

  if (missingInvoice && referralReview) {
    return 'missing_invoice_and_referral';
  }

  if (missingInvoice) {
    return 'missing_invoice';
  }

  if (referralReview) {
    return 'referral_review';
  }

  return 'other';
}

function needsInvoiceRepair(
  code: unknown,
): boolean {
  return [
    'missing_invoice',
    'missing_invoice_and_referral',
  ].includes(String(code ?? ''));
}

export async function enqueueRejectionJob(
  db: any,
  schema: string,
  uid: string,
  body: any,
) {
  if (!['scan', 'repair_invoice'].includes(body.mode)) {
    fail('Invalid rejection mode');
  }

  if (
    !/^[0-9a-f-]{36}$/i.test(
      String(body.requestId ?? ''),
    )
  ) {
    fail('Missing requestId');
  }

  const requestKey =
    `${KIND}:${body.mode}:${uid}:${body.requestId}`;

  const existing = check(
    await db
      .from('automation_jobs')
      .select('id,status')
      .eq('provider', 'CLALIT')
      .eq('request_key', requestKey)
      .maybeSingle(),
  );

  if (existing) {
    return {
      ok: true,
      jobId: existing.id,
      status: existing.status,
    };
  }

  const inserted = await db
    .from('automation_jobs')
    .insert({
      id: randomUUID(),
      provider: 'CLALIT',
      schema_name: schema,
      status: 'pending',
      request_key: requestKey,

      payload: {
        kind: KIND,
        mode: body.mode,
        lessons: [],
        created_by_uid: uid,
      },
    })
    .select('id')
    .single();

  if (inserted.error?.code === '23505') {
    fail(
      'קיימת משימת סריקה/תיקון פעילה. רענני לפני ניסיון נוסף.',
    );
  }

  const job = check(inserted);

  return {
    ok: true,
    jobId: job.id,
    status: 'pending',
  };
}

// התאמה לפי מספר תביעה מתוך היסטוריית האוטומציה.
// לא לפי שם ילד או מיקום השורה.
async function identify(db: any, item: any) {
  const candidates = new Map<string, any>();

  let submissionProven = false;

  for (let offset = 0; ; offset += 250) {
    const jobs = check(
      await db
        .from('automation_jobs')
        .select('id,payload,result')
        .eq('provider', 'CLALIT')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(offset, offset + 249),
    );

    for (const job of jobs ?? []) {
      if (job.payload?.kind === KIND) {
        continue;
      }

      for (const lesson of job.payload?.lessons ?? []) {
        const checkpoint =
          job.result?.checkpoints?.[keyOf(lesson)];

        const claimNumber = String(
          checkpoint?.claimNumber ??
          lesson.claim_number ??
          '',
        );

        if (claimNumber !== item.claimNumber) {
          continue;
        }

        if (checkpoint?.phase === 'payment_sent') {
          submissionProven = true;
        }

        const archivedId = clean(
          lesson.child_id_number,
        ).padStart(9, '0');

        const portalId = item.childId.padStart(9, '0');

        if (
          archivedId !== portalId ||
          lesson.occur_date !== item.treatmentDate
        ) {
          fail(
            'מספר התביעה נמצא עם ילד או תאריך שונים',
          );
        }

        if (!candidates.has(keyOf(lesson))) {
          candidates.set(keyOf(lesson), lesson);
        }
      }
    }

    if ((jobs?.length ?? 0) < 250) {
      break;
    }
  }

  if (candidates.size !== 1) {
    fail(
      `מספר התביעה מתאים ל־${candidates.size} רשומות; נדרשת בדיקה`,
    );
  }

  const lesson: any = [...candidates.values()][0];

  const rows = check(
    await db
      .from('claims_lessons_clalit_v')
      .select(`
        claim_id,
        lesson_id,
        occur_date,
        child_id,
        funding_source_id,
        claim_status
      `)
      .eq('lesson_id', lesson.lesson_id)
      .eq('occur_date', lesson.occur_date)
      .eq('child_id', lesson.child_id),
  );

  if (rows?.length !== 1) {
    fail('אין מופע שיעור יחיד המתאים לתביעה');
  }

  if (rows[0].claim_status === 'APPROVED') {
    fail(
      'התביעה מסומנת כמאושרת אצלנו; נדרשת בדיקה',
    );
  }

  let claimId = rows[0].claim_id;

  // באוטומציה הישנה ייתכן שנשמר רק checkpoint,
  // ללא רשומה בטבלת lesson_claims.
  if (!claimId) {
    const inserted = await db
      .from('lesson_claims')
      .insert({
        id: randomUUID(),

        lesson_id: lesson.lesson_id,
        occur_date: lesson.occur_date,
        funding_source_id: rows[0].funding_source_id,

        status: 'REJECTED',
        claim_status: 'REJECTED',

        claim_opened: true,
        claim_submitted: submissionProven,
      })
      .select('id')
      .single();

    if (inserted.error?.code === '23505') {
      fail(
        'נוצרה תביעה מקומית במקביל; נדרשת סריקה חדשה',
      );
    }

    claimId = check(inserted).id;
  }

  return {
    lesson,
    claimId,
  };
}

async function invoiceFor(db: any, lesson: any) {
  const items = check(
    await db
      .from('lesson_billing_items')
      .select('charge_id')
      .eq('lesson_id', lesson.lesson_id)
      .eq('occur_date', lesson.occur_date)
      .eq('child_id', lesson.child_id),
  );

  const charges = [
    ...new Set(
      (items ?? [])
        .map((item: any) => item.charge_id)
        .filter(Boolean),
    ),
  ];

  if (charges.length !== 1) {
    fail('לא נמצא חיוב יחיד המתאים לשיעור');
  }

  let query = db
    .from('payment_invoices')
    .select('*')
    .eq('child_id', lesson.child_id)
    .eq('charge_id', charges[0])
    .eq('status', 'ready');

  // אם החשבונית נשמרה במשימה המקורית,
  // משתמשים באותה חשבונית.
  if (lesson.invoice?.bucket && lesson.invoice?.path) {
    query = query
      .eq(
        'invoice_storage_bucket',
        lesson.invoice.bucket,
      )
      .eq(
        'invoice_storage_path',
        lesson.invoice.path,
      );
  }

  const invoices = check(
    await query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1),
  );

  const invoice = invoices?.[0];

  if (
    !invoice?.invoice_storage_bucket ||
    !invoice.invoice_storage_path
  ) {
    fail('אין חשבונית מוכנה ומתאימה לתביעה');
  }

  const payment = check(
    await db
      .from('payments')
      .select('id,charge_id')
      .eq('id', invoice.payment_id)
      .eq('charge_id', charges[0])
      .maybeSingle(),
  );

  if (!payment) {
    fail('התשלום המשויך לחשבונית אינו תואם לחיוב');
  }

  const pdf = check(
    await db.storage
      .from(invoice.invoice_storage_bucket)
      .download(invoice.invoice_storage_path),
  );

  if (
    !pdf ||
    pdf.size === 0 ||
    pdf.size > 5_000_000
  ) {
    fail('חשבונית חסרה, ריקה או גדולה מ־5MB');
  }

  const bytes = Buffer.from(await pdf.arrayBuffer());

  if (
    bytes.subarray(0, 5).toString('ascii') !== '%PDF-'
  ) {
    fail('החשבונית אינה PDF');
  }

  return {
    invoiceId: invoice.id,
    filename: `invoice-${invoice.id}.pdf`,
    dataBase64: bytes.toString('base64'),
  };
}

// יש לקרוא לפונקציה רק לאחר אימות ה־Agent
// ובחירת הסכמה לפי ההתקנה המאומתת.
export async function handleRejectionAction(
  db: any,
  installationId: string,
  body: any,
): Promise<any | null> {
  const action = String(body.action ?? '');

  if (!action.startsWith('rejection_')) {
    return null;
  }

  const job = check(
    await db
      .from('automation_jobs')
      .select('*')
      .eq('id', String(body.jobId ?? ''))
      .eq('provider', 'CLALIT')
      .eq('status', 'running')
      .eq('agent_installation_id', installationId)
      .gt(
        'lease_expires_at',
        new Date().toISOString(),
      )
      .maybeSingle(),
  );

  if (!job || job.payload?.kind !== KIND) {
    fail(
      'משימת הסריקה אינה פעילה או אינה שייכת ל־Agent',
    );
  }

  const result: any = job.result ?? {};

  const entries: Record<string, any> = {
    ...(result.rejections ?? {}),
  };

  if (action === 'rejection_fail') {
    const changed = check(
      await db
        .from('automation_jobs')
        .update({
          status: 'failed',
          finished_at: new Date().toISOString(),
          lease_expires_at: null,

          error: clean(
            body.error?.message ?? body.error,
          ).slice(0, 2000),

          result: {
            ...result,
            success: false,
          },
        })
        .eq('id', job.id)
        .eq('status', 'running')
        .eq('agent_installation_id', installationId)
        .select('id'),
    );

    if (!changed?.length) {
      fail('Job lease lost');
    }

    return { ok: true };
  }

  async function save(
    extra: any = {},
    complete = false,
  ) {
    const update = await db
      .from('automation_jobs')
      .update({
        result: {
          ...result,
          rejections: entries,
          ...extra,
        },

        ...(complete
          ? {
              status: 'done',
              finished_at: new Date().toISOString(),
              lease_expires_at: null,
            }
          : {}),
      })
      .eq('id', job.id)
      .eq('status', 'running')
      .eq('agent_installation_id', installationId)
      .gt(
        'lease_expires_at',
        new Date().toISOString(),
      )
      .select('id');

    if (!check(update)?.length) {
      fail('Job lease lost');
    }
  }

  if (action === 'rejection_row') {
    if (result.scanComplete) {
      fail('הסריקה כבר הסתיימה');
    }

    const item = body.item;

    if (
      !/^\d{1,20}$/.test(item?.claimNumber ?? '') ||
      !/^\d{5,9}$/.test(item?.childId ?? '') ||
      !/^\d{4}-\d{2}-\d{2}$/.test(
        item?.treatmentDate ?? '',
      ) ||
      !clean(item?.reason) ||
      clean(item.reason).length > 8000
    ) {
      fail('Invalid portal row');
    }

    if (Object.keys(entries).length >= 20_000) {
      fail('Scan limit exceeded');
    }

    // מאפשר חזרה על בקשת checkpoint בלי ליצור כפילות.
    if (entries[item.claimNumber]) {
      return { ok: true };
    }

    const entry: any = {
      claimNumber: item.claimNumber,
      childId: item.childId,
      treatmentDate: item.treatmentDate,

      reason: clean(item.reason),
      code: rejectionCode(item.reason),

      scannedAt: new Date().toISOString(),
      repair: 'not_started',
    };

    try {
      const {
        lesson,
        claimId,
      } = await identify(db, entry);

      entry.lesson = lesson;
      entry.claimId = claimId;

      // לא משנים את עובדת ההגשה או את תאריך ההגשה.
      const changed = check(
        await db
          .from('lesson_claims')
          .update({
            status: 'REJECTED',
            claim_status: 'REJECTED',

            clalit_claim_number: entry.claimNumber,

            decision_note: entry.reason,
            rejection_code: entry.code,
            portal_checked_at: entry.scannedAt,
          })
          .eq('id', claimId)
          .neq('claim_status', 'APPROVED')
          .select('id'),
      );

      if (changed?.length !== 1) {
        fail('מצב התביעה השתנה במהלך הסריקה');
      }

      entry.matched = true;
    } catch (error) {
      entry.matched = false;

      entry.error =
        error instanceof Error
          ? error.message
          : String(error);
    }

    entries[item.claimNumber] = entry;

    await save();

    return {
      ok: true,
      matched: entry.matched,
    };
  }

  if (action === 'rejection_scan_complete') {
    const count = Object.keys(entries).length;

    if (
      !Number.isInteger(body.count) ||
      body.count !== count
    ) {
      fail('Scan count mismatch');
    }

    await save({
      scanComplete: true,
      scannedCount: count,
    });

    const targets =
      job.payload.mode === 'repair_invoice'
        ? Object.values(entries)
            .filter(
  (entry: any) =>
    entry.matched &&
    needsInvoiceRepair(entry.code) &&
    entry.repair === 'not_started',
)
            .map((entry: any) => ({
              claimNumber: entry.claimNumber,
              childId: entry.childId,
              treatmentDate: entry.treatmentDate,
            }))
        : [];

    return {
      ok: true,
      targets,
    };
  }

  const entry =
    entries[String(body.claimNumber ?? '')];

  if (action === 'rejection_invoice') {
    if (
  !result.scanComplete ||
  job.payload.mode !== 'repair_invoice' ||
  !entry?.matched ||
  !needsInvoiceRepair(entry.code)
) {
  fail('Not an invoice repair target');
}

    if (entry.repair !== 'not_started') {
      fail(
        'השליחה כבר החלה; יש לבדוק לפני ניסיון נוסף',
      );
    }

    const claim = check(
      await db
        .from('lesson_claims')
        .select('claim_status,rejection_code')
        .eq('id', entry.claimId)
        .single(),
    );

    if (
  claim.claim_status !== 'REJECTED' ||
  !needsInvoiceRepair(claim.rejection_code)
) {
  fail('התביעה כבר אינה מתאימה לתיקון');
}

    const invoice = await invoiceFor(
      db,
      entry.lesson,
    );

    const previousRepair = check(
      await db
        .from('clalit_invoice_repairs')
        .select('state')
        .eq('claim_number', entry.claimNumber)
        .eq('invoice_id', invoice.invoiceId)
        .maybeSingle(),
    );

    if (previousRepair) {
      fail(
        `קיים ניסיון צירוף קודם לחשבונית זו (${previousRepair.state}); יש לבדוק בכללית`,
      );
    }

    entry.invoiceId = invoice.invoiceId;

    await save();

    return {
      ok: true,
      ...invoice,
    };
  }

  if (action === 'rejection_repair_state') {
    if (
  !result.scanComplete ||
  job.payload.mode !== 'repair_invoice' ||
  !entry?.matched ||
  !needsInvoiceRepair(entry.code)
) {
  fail('Unknown repair target');
}

    const next = body.state;

    if (
      ![
        'sending',
        'confirmed',
        'unknown',
        'failed',
        'skipped',
      ].includes(next)
    ) {
      fail('Invalid repair state');
    }

    if (entry.repair === next) {
      return { ok: true };
    }

    const allowed =
      entry.repair === 'not_started'
        ? ['sending', 'failed', 'skipped']
        : entry.repair === 'sending'
          ? ['confirmed', 'unknown']
          : [];

    if (
      !allowed.includes(next) ||
      (next === 'sending' && !entry.invoiceId)
    ) {
      fail('Invalid repair transition');
    }

    if (
      next === 'confirmed' &&
      (
        !/^\d{1,30}$/.test(
          String(body.reference ?? ''),
        ) ||
        !String(body.confirmation ?? '').includes(
          'בקשתך התקבלה והועברה להמשך טיפול',
        )
      )
    ) {
      fail('Missing portal confirmation');
    }

    // שומרים ניסיון לפני הלחיצה על שליחה בכללית.
    if (next === 'sending') {
      const reservation = await db
        .from('clalit_invoice_repairs')
        .insert({
          claim_number: entry.claimNumber,
          invoice_id: entry.invoiceId,
          job_id: job.id,
          state: 'sending',
        });

      if (reservation.error?.code === '23505') {
        fail(
          'כבר קיים ניסיון צירוף; נדרשת בדיקה לפני שליחה נוספת',
        );
      }

      check(reservation);
    }

    if (['confirmed', 'unknown'].includes(next)) {
      check(
        await db
          .from('clalit_invoice_repairs')
          .update({
            state: next,

            reference_number:
              next === 'confirmed'
                ? String(body.reference)
                : null,

            updated_at: new Date().toISOString(),
          })
          .eq('claim_number', entry.claimNumber)
          .eq('invoice_id', entry.invoiceId)
          .eq('job_id', job.id),
      );
    }

    entry.repair = next;
    entry.repairAt = new Date().toISOString();
    entry.repairNote = clean(body.note).slice(0, 1000);

    if (next === 'confirmed') {
      entry.reference = String(body.reference);

      // אישור צירוף אינו אישור זכאות של כללית.
      // שומרים את תאריך הצירוף בלי למחוק את הדחייה.
      check(
        await db
          .from('lesson_claims')
          .update({
            invoice_reattached_at: entry.repairAt,
          })
          .eq('id', entry.claimId),
      );
    }

    await save();

    return { ok: true };
  }

  if (action === 'rejection_complete') {
    if (!result.scanComplete) {
      fail('Cannot complete a partial scan');
    }

    const items: any[] = Object.values(entries);

    const summary = {
      scanned: items.length,

      matched: items.filter(
        (item) => item.matched,
      ).length,

      needsReview: items.filter(
        (item) => !item.matched,
      ).length,

      missingInvoice: items.filter(
        (item) => needsInvoiceRepair(item.code),
      ).length,

      repaired: items.filter(
        (item) => item.repair === 'confirmed',
      ).length,

      failed: items.filter(
        (item) =>
          ['failed', 'unknown', 'sending'].includes(
            item.repair,
          ),
      ).length,

      skipped: items.filter(
        (item) => item.repair === 'skipped',
      ).length,
    };

    await save(
      {
        summary,

        success:
          summary.failed === 0 &&
          summary.needsReview === 0,
      },
      true,
    );

    return {
      ok: true,
      summary,
    };
  }

  fail('Unknown rejection action');
}