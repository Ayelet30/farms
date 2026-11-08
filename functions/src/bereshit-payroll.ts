import { onRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { createClient } from '@supabase/supabase-js';

import {
  SUPABASE_URL_S,
  SUPABASE_KEY_S,
} from './gmail/email-core';

if (!admin.apps.length) {
  admin.initializeApp();
}

const ALLOWED_ORIGINS = new Set([
  'https://smart-farm.org',
  'https://bereshit-ac5d8.web.app',
  'https://bereshit-ac5d8.firebaseapp.com',
  'http://localhost:4200',
  'https://localhost:4200',
]);

class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
  }
}

function makeClient(schema: string) {
  return createClient(
    SUPABASE_URL_S.value(),
    SUPABASE_KEY_S.value(),
    {
      db: { schema },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}

function requiredText(
  value: unknown,
  label: string,
  maxLength = 160,
): string {
  if (typeof value !== 'string') {
    throw new RequestError(`חסר ערך תקין: ${label}`);
  }

  const text = value.trim();

  if (!text || text.length > maxLength) {
    throw new RequestError(`ערך לא תקין: ${label}`);
  }

  return text;
}

function optionalText(
  value: unknown,
  maxLength: number,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new RequestError('נשלח ערך טקסט לא תקין');
  }

  const text = value.trim();

  if (text.length > maxLength) {
    throw new RequestError('הטקסט ארוך מדי');
  }

  return text || null;
}

function validUuid(
  value: unknown,
  label: string,
): string {
  const text = requiredText(value, label);

  if (
    !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(text)
  ) {
    throw new RequestError(`מזהה לא תקין: ${label}`);
  }

  return text;
}

function validDate(value: unknown): string {
  const text = requiredText(value, 'תאריך');

  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new RequestError('תאריך לא תקין');
  }

  const parsed = new Date(`${text}T12:00:00Z`);

  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== text
  ) {
    throw new RequestError('תאריך לא תקין');
  }

  return text;
}

function validTime(value: unknown): string {
  const text = requiredText(value, 'שעה');

  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) {
    throw new RequestError('שעה לא תקינה');
  }

  return text;
}

async function resolveTenantAccess(
  authorization: unknown,
  body: any,
) {
  const match = String(authorization ?? '')
    .match(/^Bearer (.+)$/);

  if (!match) {
    throw new RequestError('נדרשת התחברות', 401);
  }

  let decoded: admin.auth.DecodedIdToken;

  try {
    decoded = await admin.auth().verifyIdToken(
      match[1],
      true,
    );
  } catch {
    throw new RequestError(
      'ההתחברות אינה תקינה. התחברי מחדש',
      401,
    );
  }

  const tenantId = validUuid(
    body.tenantId,
    'חווה',
  );

  const publicDb = makeClient('public');

  // קודם בודקים חברות בחווה.
  const {
    data: memberships,
    error: membershipError,
  } = await publicDb
    .from('tenant_users')
    .select('role_in_tenant')
    .eq('tenant_id', tenantId)
    .eq('uid', decoded.uid)
    .eq('is_active', true);

  if (membershipError) {
    throw membershipError;
  }

  const roles = new Set(
    (memberships ?? []).map(
      (row: any) => String(row.role_in_tenant),
    ),
  );

  const canManage =
    roles.has('secretary') ||
    roles.has('admin');

  const isInstructor = roles.has('instructor');

  if (!canManage && !isInstructor) {
    throw new RequestError(
      'אין הרשאה לפעולה בחווה זו',
      403,
    );
  }

  // הסכמה נקבעת מתוך מסד הנתונים.
  const {
    data: farm,
    error: farmError,
  } = await publicDb
    .from('farms')
    .select('id,schema_name')
    .eq('id', tenantId)
    .maybeSingle();

  if (farmError) {
    throw farmError;
  }

  const schema = String(
    farm?.schema_name ?? '',
  ).trim();

  if (
    !farm ||
    !/^[a-z_][a-z0-9_]*$/.test(schema) ||
    ['public', 'auth', 'storage', 'information_schema']
      .includes(schema) ||
    schema.startsWith('pg_')
  ) {
    throw new RequestError(
      'לא נמצאה סכמה תקינה לחווה',
      403,
    );
  }

  // מונע שימוש בהקשר חווה ישן מהדפדפן.
  if (
    body.tenantSchema !== undefined &&
    body.tenantSchema !== schema
  ) {
    throw new RequestError(
      'החווה הפעילה השתנתה. רענני את המסך',
      409,
    );
  }

  return {
    uid: decoded.uid,
    tenantId,
    schema,
    canManage,
    db: makeClient(schema),
  };
}

export const bereshitPayrollApi = onRequest(
  {
    region: 'us-central1',

    secrets: [
      SUPABASE_URL_S,
      SUPABASE_KEY_S,
    ],
  },

  async (req, res) => {
    const origin = String(
      req.headers.origin ?? '',
    );

    res.setHeader('Vary', 'Origin');

    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      res.status(403).json({
        ok: false,
        error: 'Origin rejected',
      });
      return;
    }

    if (origin) {
      res.setHeader(
        'Access-Control-Allow-Origin',
        origin,
      );
    }

    res.setHeader(
      'Access-Control-Allow-Methods',
      'POST, OPTIONS',
    );

    res.setHeader(
      'Access-Control-Allow-Headers',
      'Authorization, Content-Type',
    );

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({
        ok: false,
        error: 'Method not allowed',
      });
      return;
    }

    try {
      const body = req.body;

      if (
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body)
      ) {
        throw new RequestError('בקשה לא תקינה');
      }

      const context = await resolveTenantAccess(
        req.headers.authorization,
        body,
      );

      const { db } = context;

      const action = requiredText(
        body.action,
        'פעולה',
      );

      if (
        !context.canManage &&
        action !== 'ownMonth'
      ) {
        throw new RequestError(
          'הפעולה דורשת הרשאת משרד',
          403,
        );
      }

      const rpc = async (
        name: string,
        args: Record<string, unknown> = {},
      ): Promise<any> => {
        const { data, error } = await db.rpc(
          name,
          args,
        );

        if (error) {
          throw error;
        }

        return data;
      };

      let result: any;

      switch (action) {
        case 'reference': {
          result = await rpc(
            'payroll_reference_data',
          );
          break;
        }

        case 'saveExternal': {
          if (
            body.is_active !== undefined &&
            typeof body.is_active !== 'boolean'
          ) {
            throw new RequestError(
              'סטטוס המחליף אינו תקין',
            );
          }

          const email = optionalText(
            body.email,
            254,
          );

          if (
            email &&
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
          ) {
            throw new RequestError(
              'כתובת המייל אינה תקינה',
            );
          }

          const row = {
            full_name: requiredText(
              body.full_name,
              'שם המחליף',
            ),

            phone: optionalText(body.phone, 60),
            email,
            notes: optionalText(body.notes, 4000),

            is_active: body.is_active !== false,
            updated_at: new Date().toISOString(),
          };

          const query = body.id
            ? db
                .from('external_substitutes')
                .update(row)
                .eq(
                  'id',
                  validUuid(body.id, 'מחליף'),
                )
            : db
                .from('external_substitutes')
                .insert(row);

          const { data, error } = await query
            .select('*')
            .single();

          if (error) {
            throw error;
          }

          result = data;
          break;
        }

        case 'saveRate': {
          const category = requiredText(
            body.category,
            'קטגוריה',
          );

          if (
            !['private', 'pair', 'group', 'break']
              .includes(category)
          ) {
            throw new RequestError(
              'קטגוריית התעריף אינה תקינה',
            );
          }

          const amount = body.hourly_agorot;

          if (
            typeof amount !== 'number' ||
            !Number.isSafeInteger(amount) ||
            amount < 0 ||
            amount > 10000000
          ) {
            throw new RequestError(
              'התעריף חייב להיות מספר שלם של אגורות',
            );
          }

          const row = {
            instructor_id: requiredText(
              body.instructor_id,
              'מדריך',
            ),

            riding_type_id:
              category === 'break'
                ? null
                : validUuid(
                    body.riding_type_id,
                    'סוג רכיבה',
                  ),

            category,
            hourly_agorot: amount,

            effective_from: validDate(
              body.effective_from,
            ),
          };

          const { data, error } = await db
            .from('instructor_hourly_rates')
            .insert(row)
            .select('*')
            .single();

          if (error) {
            if (error.code === '23505') {
              throw new RequestError(
                'כבר קיים תעריף לסוג ולתאריך שנבחרו',
                409,
              );
            }

            throw error;
          }

          result = data;
          break;
        }

        case 'preview':
        case 'assign': {
          const args = {
            p_instructor: requiredText(
              body.instructor_id,
              'מדריך',
            ),

            p_date: validDate(body.date),
            p_start: validTime(body.start),
            p_end: validTime(body.end),
          };

          if (args.p_start >= args.p_end) {
            throw new RequestError(
              'שעת הסיום חייבת להיות אחרי שעת ההתחלה',
            );
          }

          if (action === 'preview') {
            result = await rpc(
              'payroll_candidates',
              args,
            );
            break;
          }

          if (
            !Array.isArray(body.items) ||
            body.items.length === 0 ||
            body.items.length > 1000
          ) {
            throw new RequestError(
              'יש לבחור בין שיעור אחד ל־1,000 שיעורים',
            );
          }

          const items = body.items.map(
            (item: any) => {
              if (
                !item ||
                typeof item !== 'object'
              ) {
                throw new RequestError(
                  'פרטי שיעור אינם תקינים',
                );
              }

              return {
                lesson_id: validUuid(
                  item.lesson_id,
                  'שיעור',
                ),

                fingerprint: requiredText(
                  item.fingerprint,
                  'גרסת השיעור',
                ),

                restore: item.restore === true,
              };
            },
          );

          result = await rpc(
            'payroll_assign_external',
            {
              ...args,

              p_external: validUuid(
                body.external_id,
                'מחליף',
              ),

              p_items: items,
              p_actor: context.uid,
            },
          );

          break;
        }

        case 'month': {
          result = await rpc(
            'payroll_month_data',
            {
              p_month: validDate(body.month),
            },
          );

          break;
        }

        case 'ownMonth': {
          const {
            data: instructor,
            error: instructorError,
          } = await db
            .from('instructors')
            .select('id_number')
            .eq('uid', context.uid)
            .single();

          if (instructorError || !instructor) {
            throw new RequestError(
              'לא נמצא מדריך המשויך למשתמש',
              403,
            );
          }

          const id = String(
            instructor.id_number,
          );

          const monthData = await rpc(
            'payroll_month_data',
            {
              p_month: validDate(body.month),
            },
          );

          // הנתונים מסוננים בשרת לפני שליחתם.
          result = {
            reference: {
              instructors:
                monthData.reference.instructors.filter(
                  (row: any) => row.id === id,
                ),

              ridingTypes:
                monthData.reference.ridingTypes,

            paymentTypes: monthData.reference.paymentTypes,
            paymentRules: monthData.reference.paymentRules,

              rates:
                monthData.reference.rates.filter(
                  (row: any) =>
                    row.instructor_id === id,
                ),

              externals: [],
            },

            lessons: monthData.lessons.filter(
              (row: any) =>
                String(row.instructor_id) === id &&
                !row.external_id,
            ),

            breaks: monthData.breaks.filter(
              (row: any) =>
                String(row.instructor_id_number) === id,
            ),

            absences: monthData.absences.filter(
              (row: any) =>
                String(row.instructor_id_number) === id,
            ),

            covers: monthData.covers
              .filter(
                (row: any) =>
                  String(
                    row.original_instructor_id,
                  ) === id,
              )
              .map((row: any) => ({
                lesson_id: row.lesson_id,
                occur_date: row.occur_date,

                original_instructor_id:
                  row.original_instructor_id,

                start_time: row.start_time,
                end_time: row.end_time,
              })),
          };

          break;
        }

        case 'externalLessons': {
  result = await rpc(
    'payroll_external_lessons',
    {
      p_external: validUuid(
        body.external_id,
        'מחליף',
      ),
    },
  );

  break;
}

case 'savePaymentType': {
  if (
    body.is_active !== undefined &&
    typeof body.is_active !== 'boolean'
  ) {
    throw new RequestError('סטטוס סוג התשלום אינו תקין');
  }

  const row = {
    name: requiredText(
      body.name,
      'שם סוג התשלום',
      100,
    ),

    is_active: body.is_active !== false,
    updated_at: new Date().toISOString(),
  };

  const query = body.id
    ? db
        .from('payroll_payment_types')
        .update(row)
        .eq('id', validUuid(body.id, 'סוג תשלום'))
    : db
        .from('payroll_payment_types')
        .insert(row);

  const { data, error } = await query
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new RequestError(
        'כבר קיים סוג תשלום בשם הזה',
        409,
      );
    }

    throw error;
  }

  result = data;
  break;
}

case 'savePaymentRule': {
  if (
    body.is_active !== undefined &&
    typeof body.is_active !== 'boolean'
  ) {
    throw new RequestError('סטטוס השיוך אינו תקין');
  }

  const minimum = body.min_participants;
  const maximum = body.max_participants;

  if (
    typeof minimum !== 'number' ||
    typeof maximum !== 'number' ||
    !Number.isSafeInteger(minimum) ||
    !Number.isSafeInteger(maximum) ||
    minimum < 0 ||
    maximum < minimum ||
    maximum > 2147483647
  ) {
    throw new RequestError(
      'יש להזין טווח תקין של מספר ילדים שלם',
    );
  }

  const paymentTypeId = validUuid(
    body.payment_type_id,
    'סוג תשלום',
  );

  const isActive = body.is_active !== false;

  if (isActive) {
    const {
      data: paymentType,
      error: paymentTypeError,
    } = await db
      .from('payroll_payment_types')
      .select('id,is_active')
      .eq('id', paymentTypeId)
      .maybeSingle();

    if (paymentTypeError) {
      throw paymentTypeError;
    }

    if (!paymentType?.is_active) {
      throw new RequestError(
        'יש לבחור סוג תשלום פעיל',
      );
    }
  }

  const row = {
    riding_type_id: validUuid(
      body.riding_type_id,
      'סוג רכיבה',
    ),

    payment_type_id: paymentTypeId,
    min_participants: minimum,
    max_participants: maximum,

    is_active: isActive,
    updated_at: new Date().toISOString(),
  };

  const query = body.id
    ? db
        .from('payroll_type_rules')
        .update(row)
        .eq('id', validUuid(body.id, 'שיוך'))
    : db
        .from('payroll_type_rules')
        .insert(row);

  const { data, error } = await query
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  result = data;
  break;
}

case 'savePaymentRate': {
  const paymentTypeId = validUuid(
    body.payment_type_id,
    'סוג תשלום',
  );

  const amount = body.hourly_agorot;

  if (
    typeof amount !== 'number' ||
    !Number.isSafeInteger(amount) ||
    amount < 0 ||
    amount > 10000000
  ) {
    throw new RequestError(
      'התעריף חייב להיות מספר שלם של אגורות',
    );
  }

  const {
    data: paymentType,
    error: paymentTypeError,
  } = await db
    .from('payroll_payment_types')
    .select('id,is_active')
    .eq('id', paymentTypeId)
    .maybeSingle();

  if (paymentTypeError) {
    throw paymentTypeError;
  }

  if (!paymentType?.is_active) {
    throw new RequestError(
      'יש לבחור סוג תשלום פעיל',
    );
  }

  const row = {
    instructor_id: requiredText(
      body.instructor_id,
      'מדריך',
    ),

    payment_type_id: paymentTypeId,

    // התעריף החדש מוגדר לפי סוג תשלום.
    category: null,
    riding_type_id: null,

    hourly_agorot: amount,

    effective_from: validDate(
      body.effective_from,
    ),
  };

  const { data, error } = await db
    .from('instructor_hourly_rates')
    .insert(row)
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new RequestError(
        'כבר קיים למדריך תעריף לסוג התשלום בתאריך התחולה הזה',
        409,
      );
    }

    throw error;
  }

  result = data;
  break;
}

        case 'mailStatus': {
          const { data, error } = await db
            .from('payroll_mail_outbox')
            .select(
              [
                'id',
                'lesson_id',
                'occur_date',
                'child_name',
                'start_time',
                'status',
                'last_error',
                'created_at',
              ].join(','),
            )
            .order('created_at', {
              ascending: false,
            })
            .order('id', {
              ascending: false,
            })
            .limit(100);

          if (error) {
            throw error;
          }

          result = data;
          break;
        }

        default:
          throw new RequestError(
            'פעולה לא מוכרת',
          );
      }

      res.status(200).json({
        ok: true,
        result,
      });
    } catch (error: any) {
      console.error(
        'bereshitPayrollApi failed',
        error,
      );

      if (error instanceof RequestError) {
        res.status(error.status).json({
          ok: false,
          error: error.message,
        });
        return;
      }

      // הודעות הבדיקה שהגדרנו בפונקציות SQL.
      if (
        error?.code === 'P0001' &&
        typeof error?.message === 'string'
      ) {
        res.status(409).json({
          ok: false,
          error: error.message,
        });
        return;
      }

      res.status(500).json({
        ok: false,
        error:
          'הפעולה נכשלה בשרת. יש לבדוק את יומן הפונקציה.',
      });
    }
  },
);