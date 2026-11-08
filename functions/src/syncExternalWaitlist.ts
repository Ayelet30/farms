import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { google } from 'googleapis';
import jwt from 'jsonwebtoken';

if (!getApps().length) {
    initializeApp();
}

const SUPABASE_URL = defineSecret('SUPABASE_URL');
const SUPABASE_SERVICE_KEY = defineSecret('SUPABASE_SERVICE_KEY');
const SUPABASE_JWT_SECRET = defineSecret('SUPABASE_JWT_SECRET');

type Membership = {
    tenant_id: string;
    role_in_tenant: string;
};

type Farm = {
    schema_name: string;
};

type FarmSettings = {
    external_waitlist_sheet_url: string | null;
};

// סדר העמודות בלשונית Requests
const REQUIRED_COLUMNS = [
    'id_number',
    'first_name',
    'last_name',
    'parent_name',
    'phone',
    'additional_phone',
    'email',
    'birth_date',
    'form_type',
    'gender',
    'health_fund',
    'health_fund_other',
    'submitted_at',
    'previous_riding',
    'previous_riding_details',
    'referral_reason_text',
    'sun_available',
    'sun_start',
    'mon_available',
    'mon_start',
    'tue_available',
    'tue_start',
    'wed_available',
    'wed_start',
    'thu_available',
    'thu_start',
] as const;

const SHEET_TIME_ZONE = 'Asia/Jerusalem';

// המרת מספר סידורי של Google Sheets לתאריך ושעה
function sheetDateParts(value: unknown): {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
} {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(
            `Expected a Google Sheets date/time serial, got: ${String(value)}`
        );
    }

    const milliseconds = Math.round(value * 86400000);
    const date = new Date(Date.UTC(1899, 11, 30) + milliseconds);

    if (Number.isNaN(date.valueOf())) {
        throw new Error('Invalid Google Sheets date/time value');
    }

    return {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
        hour: date.getUTCHours(),
        minute: date.getUTCMinutes(),
        second: date.getUTCSeconds(),
    };
}

function pad(value: number): string {
    return String(value).padStart(2, '0');
}

function sheetDate(value: unknown): string {
    const d = sheetDateParts(value);

    return `${d.year}-${pad(d.month)}-${pad(d.day)}`;
}

function sheetTime(value: unknown): string {
    const d = sheetDateParts(value);

    return `${pad(d.hour)}:${pad(d.minute)}`;
}

// שליפת רכיבי תאריך ושעה לפי שעון ישראל
function localPartsAt(instant: Date): Record<string, number> {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: SHEET_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(instant);

    const result: Record<string, number> = {};

    for (const part of parts) {
        if (part.type !== 'literal') {
            result[part.type] = Number(part.value);
        }
    }

    return result;
}

// המרת מועד הגשה לשעה עם אזור זמן תקין
function sheetDateTime(value: unknown): string {
    const d = sheetDateParts(value);

    const wallClockUtc = Date.UTC(
        d.year,
        d.month - 1,
        d.day,
        d.hour,
        d.minute,
        d.second
    );

    let candidate = wallClockUtc;

    for (let attempt = 0; attempt < 3; attempt++) {
        const local = localPartsAt(new Date(candidate));

        const localAsUtc = Date.UTC(
            local.year,
            local.month - 1,
            local.day,
            local.hour,
            local.minute,
            local.second
        );

        candidate += wallClockUtc - localAsUtc;
    }

    const offsetMinutes = Math.round(
        (wallClockUtc - candidate) / 60000
    );

    const sign = offsetMinutes >= 0 ? '+' : '-';
    const abs = Math.abs(offsetMinutes);

    const offset =
        `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;

    return (
        `${d.year}-${pad(d.month)}-${pad(d.day)}` +
        `T${pad(d.hour)}:${pad(d.minute)}:${pad(d.second)}` +
        offset
    );
}

// המרת ערכי הגיליון לפורמט שה-RPC מצפה לקבל
function normaliseCell(
    header: string,
    raw: unknown,
    rowNumber: number
): string {
    if (raw === null || raw === undefined || raw === '') {
        return '';
    }

    try {
        if (header === 'birth_date') {
            return sheetDate(raw);
        }

        if (header === 'submitted_at') {
            return sheetDateTime(raw);
        }

        if (header.endsWith('_start')) {
            return sheetTime(raw);
        }

        if (typeof raw === 'boolean') {
            return String(raw);
        }

        return String(raw).trim();
    } catch (error) {
        throw new Error(
            `Requests row ${rowNumber}, column ${header}: ${
                error instanceof Error
                    ? error.message
                    : 'Invalid value'
            }`
        );
    }
}

export const syncExternalWaitlist = onRequest(
    {
        region: 'europe-west1',
        cors: true,
        invoker: 'public',
        maxInstances: 1,
        secrets: [
            SUPABASE_URL,
            SUPABASE_SERVICE_KEY,
            SUPABASE_JWT_SECRET,
        ],
    },
    async (req, res): Promise<void> => {
        if (req.method !== 'POST') {
            res.status(405).json({
                error: 'Method not allowed',
            });
            return;
        }

        try {
            // ==========================================
            // 1. אימות משתמש Firebase
            // ==========================================

            const authHeader =
                req.headers.authorization ?? '';

            const idToken = authHeader.startsWith('Bearer ')
                ? authHeader.slice(7)
                : '';

            if (!idToken) {
                res.status(401).json({
                    error: 'Authentication required',
                });
                return;
            }

            const user = await getAuth().verifyIdToken(idToken);

            const tenantId = req.body?.tenantId;

            if (
                typeof tenantId !== 'string' ||
                !/^[0-9a-fA-F-]{36}$/.test(tenantId)
            ) {
                res.status(400).json({
                    error: 'Invalid farm ID',
                });
                return;
            }

            const baseUrl = SUPABASE_URL
                .value()
                .replace(/\/+$/, '');

            const serviceKey = SUPABASE_SERVICE_KEY.value();

            const serviceHeaders = {
                apikey: serviceKey,
                Authorization: `Bearer ${serviceKey}`,
            };

            // ==========================================
            // 2. בדיקת חברות והרשאות בחווה
            // ==========================================

            const membershipUrl = new URL(
                `${baseUrl}/rest/v1/tenant_users`
            );

            membershipUrl.searchParams.set(
                'uid',
                `eq.${user.uid}`
            );

            membershipUrl.searchParams.set(
                'tenant_id',
                `eq.${tenantId}`
            );

            membershipUrl.searchParams.set(
                'is_active',
                'eq.true'
            );

            membershipUrl.searchParams.set(
                'select',
                'tenant_id,role_in_tenant'
            );

            const membershipResponse = await fetch(
                membershipUrl,
                {
                    headers: serviceHeaders,
                }
            );

            if (!membershipResponse.ok) {
                throw new Error(
                    'Membership lookup failed'
                );
            }

            const memberships =
                (await membershipResponse.json()) as Membership[];

            const membership = memberships.find(
                (m) =>
                    m.role_in_tenant === 'manager' ||
                    m.role_in_tenant === 'secretary'
            );

            if (!membership) {
                res.status(403).json({
                    error: 'Insufficient permissions',
                });
                return;
            }

            // ==========================================
            // 3. זיהוי הסכמה של החווה
            // ==========================================

            const farmUrl = new URL(
                `${baseUrl}/rest/v1/farms`
            );

            farmUrl.searchParams.set(
                'id',
                `eq.${tenantId}`
            );

            farmUrl.searchParams.set(
                'select',
                'schema_name'
            );

            const farmResponse = await fetch(
                farmUrl,
                {
                    headers: serviceHeaders,
                }
            );

            if (!farmResponse.ok) {
                throw new Error(
                    'Farm lookup failed'
                );
            }

            const farms =
                (await farmResponse.json()) as Farm[];

            const schema = farms[0]?.schema_name;

            if (
                !schema ||
                !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)
            ) {
                throw new Error(
                    'Invalid farm schema'
                );
            }

            // ==========================================
            // 4. קריאת כתובת הגיליון מהגדרות החווה
            // ==========================================

            const settingsUrl = new URL(
                `${baseUrl}/rest/v1/farm_settings`
            );

            settingsUrl.searchParams.set(
                'select',
                'external_waitlist_sheet_url'
            );

            settingsUrl.searchParams.set(
                'limit',
                '2'
            );

            const settingsResponse = await fetch(
                settingsUrl,
                {
                    headers: {
                        ...serviceHeaders,
                        'Accept-Profile': schema,
                    },
                }
            );

            if (!settingsResponse.ok) {
                throw new Error(
                    'Farm settings lookup failed'
                );
            }

            const settings =
                (await settingsResponse.json()) as FarmSettings[];

            if (settings.length !== 1) {
                throw new Error(
                    'Expected exactly one farm settings row'
                );
            }

            const sheetUrl =
                settings[0].external_waitlist_sheet_url;

            if (!sheetUrl) {
                res.status(404).json({
                    error:
                        'External waitlist sheet is not configured',
                });
                return;
            }

            const parsedUrl = new URL(sheetUrl);

            if (parsedUrl.hostname !== 'docs.google.com') {
                throw new Error(
                    'Invalid spreadsheet URL'
                );
            }

            const sheetMatch = parsedUrl.pathname.match(
                /^\/spreadsheets\/d\/([a-zA-Z0-9_-]+)\/?/
            );

            if (!sheetMatch) {
                throw new Error(
                    'Invalid spreadsheet ID'
                );
            }

            const spreadsheetId = sheetMatch[1];

            // ==========================================
            // 5. קריאת Google Sheets
            // ==========================================

            const auth = new google.auth.GoogleAuth({
                scopes: [
                    'https://www.googleapis.com/auth/spreadsheets.readonly',
                ],
            });

            const sheets = google.sheets({
                version: 'v4',
                auth,
            });

            const sheetResponse =
                await sheets.spreadsheets.values.get({
                    spreadsheetId,
                    range: 'Requests!A1:Z501',
                    valueRenderOption: 'UNFORMATTED_VALUE',
                    dateTimeRenderOption: 'SERIAL_NUMBER',
                });

            const values =
                sheetResponse.data.values ?? [];

            const headers = (values[0] ?? []).map(
                (cell) => String(cell).trim()
            );

            // ==========================================
            // 6. בדיקת מבנה העמודות
            // ==========================================

            if (
                headers.length !== REQUIRED_COLUMNS.length ||
                REQUIRED_COLUMNS.some(
                    (column, index) =>
                        headers[index] !== column
                )
            ) {
                res.status(422).json({
                    error:
                        'Spreadsheet columns do not match the import format',
                });
                return;
            }

            // ==========================================
            // 7. יצירת אובייקטים מהשורות
            // ==========================================

            const rows = values
                .slice(1)
                .filter((cells) =>
                    cells.some(
                        (cell) =>
                            String(cell ?? '').trim() !== ''
                    )
                )
                .map((cells, rowIndex) => {
                    const row: Record<string, string> = {};

                    headers.forEach((header, index) => {
                        row[header] = normaliseCell(
                            header,
                            cells[index],
                            rowIndex + 2
                        );
                    });

                    return row;
                });

            if (rows.length === 0) {
                res.status(200).json({
                    success: true,
                    received: 0,
                    inserted: 0,
                    skipped: 0,
                });
                return;
            }

            // ==========================================
            // 8. יצירת JWT עבור Supabase
            // ==========================================

            const tenantJwt = jwt.sign(
                {
                    role: 'authenticated',
                    sub: user.uid,
                    tenant_id: tenantId,
                    role_in_tenant:
                        membership.role_in_tenant,
                    user_metadata: {
                        tenant_id: tenantId,
                        role_in_tenant:
                            membership.role_in_tenant,
                    },
                },
                SUPABASE_JWT_SECRET.value(),
                {
                    expiresIn: '5m',
                }
            );

            // ==========================================
            // 9. שליחה לפונקציית הייבוא ב-Supabase
            // ==========================================

            const rpcResponse = await fetch(
                `${baseUrl}/rest/v1/rpc/waitlist_import_external_requests`,
                {
                    method: 'POST',
                    headers: {
                        apikey: serviceKey,
                        Authorization:
                            `Bearer ${tenantJwt}`,
                        'Content-Profile': schema,
                        'Content-Type':
                            'application/json',
                    },
                    body: JSON.stringify({
                        p_source:
                            `google_sheet:${spreadsheetId}`,
                        p_rows: rows,
                    }),
                }
            );

            if (!rpcResponse.ok) {
                const rpcError =
                    await rpcResponse.text();

                console.error(
                    'External waitlist RPC failed:',
                    rpcResponse.status,
                    rpcError
                );

                res.status(502).json({
                    error:
                        'External waitlist import failed',
                    status: rpcResponse.status,
                });
                return;
            }

            const result =
                (await rpcResponse.json()) as {
                    received: number;
                    inserted: number;
                    skipped: number;
                };

            // ==========================================
            // 10. החזרת תוצאת הסנכרון
            // ==========================================

            res.status(200).json({
                success: true,
                farmId: tenantId,
                received: result.received,
                inserted: result.inserted,
                skipped: result.skipped,
            });

        } catch (error) {
            console.error(
                'External waitlist synchronization failed:',
                error instanceof Error
                    ? error.message
                    : 'Unknown error'
            );

            res.status(500).json({
                success: false,
                error:
                    'External waitlist synchronization failed',
            });
        }
    }
);