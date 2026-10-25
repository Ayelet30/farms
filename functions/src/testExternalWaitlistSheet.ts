
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

const REQUIRED_COLUMNS = [
    'form_type',
    'submitted_at',
    'first_name',
    'last_name',
    'id_number',
    'parent_name',
    'phone',
    'additional_phone',
    'email',
    'birth_date',
    'gender',
    'previous_riding',
    'previous_riding_details',
    'referral_reason_text',
    'referral_reason_codes',
    'referral_reason_other',
    'health_fund',
    'health_fund_other',
    'privacy_consent',
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
];

export const testExternalWaitlistSheet = onRequest(
    {
        region: 'europe-west1',
        cors: true,
        invoker: 'private',
        maxInstances: 1,
        secrets: [
            SUPABASE_URL,
            SUPABASE_SERVICE_KEY,
            SUPABASE_JWT_SECRET,
        ],
    },
    async (req, res): Promise<void> => {
        if (req.method !== 'POST') {
            res.status(405).json({ error: 'Method not allowed' });
            return;
        }

        try {
            // Authenticate the Firebase user
            const authHeader = req.headers.authorization ?? '';
            const idToken = authHeader.startsWith('Bearer ')
                ? authHeader.slice(7)
                : '';

            if (!idToken) {
                res.status(401).json({ error: 'Authentication required' });
                return;
            }

            const user = await getAuth().verifyIdToken(idToken);

            const tenantId = req.body?.tenantId;

            if (
                typeof tenantId !== 'string' ||
                !/^[0-9a-fA-F-]{36}$/.test(tenantId)
            ) {
                res.status(400).json({ error: 'Invalid farm ID' });
                return;
            }

            const baseUrl = SUPABASE_URL.value().replace(/\/+$/, '');
            const serviceKey = SUPABASE_SERVICE_KEY.value();

            const serviceHeaders = {
                apikey: serviceKey,
                Authorization: `Bearer ${serviceKey}`,
            };

            // Verify real membership and staff role
            const membershipUrl = new URL(
                `${baseUrl}/rest/v1/tenant_users`
            );

            membershipUrl.searchParams.set('uid', `eq.${user.uid}`);
            membershipUrl.searchParams.set('tenant_id', `eq.${tenantId}`);
            membershipUrl.searchParams.set('is_active', 'eq.true');
            membershipUrl.searchParams.set(
                'select',
                'tenant_id,role_in_tenant'
            );

            const membershipResponse = await fetch(membershipUrl, {
                headers: serviceHeaders,
            });

            if (!membershipResponse.ok) {
                throw new Error('Membership lookup failed');
            }

            const memberships =
                (await membershipResponse.json()) as Membership[];

            const membership = memberships.find(
                (m) =>
                    m.role_in_tenant === 'manager' ||
                    m.role_in_tenant === 'secretary'
            );

            if (!membership) {
                res.status(403).json({ error: 'Insufficient permissions' });
                return;
            }

            // Resolve farm schema from trusted database metadata
            const farmUrl = new URL(`${baseUrl}/rest/v1/farms`);
            farmUrl.searchParams.set('id', `eq.${tenantId}`);
            farmUrl.searchParams.set('select', 'schema_name');

            const farmResponse = await fetch(farmUrl, {
                headers: serviceHeaders,
            });

            if (!farmResponse.ok) {
                throw new Error('Farm lookup failed');
            }

            const farms = (await farmResponse.json()) as Farm[];
            const schema = farms[0]?.schema_name;

            if (
                !schema ||
                !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)
            ) {
                throw new Error('Invalid farm schema');
            }

            // Read spreadsheet configuration from this farm
            const settingsUrl = new URL(
                `${baseUrl}/rest/v1/farm_settings`
            );

            settingsUrl.searchParams.set(
                'select',
                'external_waitlist_sheet_url'
            );
            settingsUrl.searchParams.set('limit', '2');

            const settingsResponse = await fetch(settingsUrl, {
                headers: {
                    ...serviceHeaders,
                    'Accept-Profile': schema,
                },
            });

            if (!settingsResponse.ok) {
                throw new Error('Farm settings lookup failed');
            }

            const settings =
                (await settingsResponse.json()) as FarmSettings[];

            if (settings.length !== 1) {
                throw new Error('Expected exactly one farm settings row');
            }

            const sheetUrl = settings[0].external_waitlist_sheet_url;

            if (!sheetUrl) {
                res.status(404).json({
                    error: 'External waitlist sheet is not configured',
                });
                return;
            }

            const parsedUrl = new URL(sheetUrl);

            if (parsedUrl.hostname !== 'docs.google.com') {
                throw new Error('Invalid spreadsheet URL');
            }

            const sheetMatch = parsedUrl.pathname.match(
                /^\/spreadsheets\/d\/([a-zA-Z0-9_-]+)\/?/
            );

            if (!sheetMatch) {
                throw new Error('Invalid spreadsheet ID');
            }

            const spreadsheetId = sheetMatch[1];

            // Read Google Sheets with the server service account
            const auth = new google.auth.GoogleAuth({
                scopes: [
                    'https://www.googleapis.com/auth/spreadsheets.readonly',
                ],
            });

            const sheets = google.sheets({
                version: 'v4',
                auth,
            });

            const sheetResponse = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: 'Requests!A1:AC501',
                valueRenderOption: 'FORMATTED_VALUE',
            });

            const values = sheetResponse.data.values ?? [];
            const headers = (values[0] ?? []).map(String);

            if (
                headers.length !== REQUIRED_COLUMNS.length ||
                REQUIRED_COLUMNS.some(
                    (column, index) => headers[index] !== column
                )
            ) {
                res.status(422).json({
                    error: 'Spreadsheet columns do not match the import format',
                });
                return;
            }

            const rows = values
                .slice(1)
                .filter((cells) =>
                    cells.some((cell) => String(cell ?? '').trim() !== '')
                )
                .map((cells) => {
                    const row: Record<string, string> = {};

                    headers.forEach((header, index) => {
                        row[header] = String(cells[index] ?? '').trim();
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

            // Sign a tenant-scoped user JWT.
            // This preserves the existing RPC authorization checks.
            const tenantJwt = jwt.sign(
                {
                    role: 'authenticated',
                    sub: user.uid,
                    tenant_id: tenantId,
                    role_in_tenant: membership.role_in_tenant,
                    user_metadata: {
                        tenant_id: tenantId,
                        role_in_tenant: membership.role_in_tenant,
                    },
                },
                SUPABASE_JWT_SECRET.value(),
                { expiresIn: '5m' }
            );

            // Existing Supabase RPC handles validation and insertion.
            const rpcResponse = await fetch(
                `${baseUrl}/rest/v1/rpc/waitlist_import_external_requests`,
                {
                    method: 'POST',
                    headers: {
                        apikey: serviceKey,
                        Authorization: `Bearer ${tenantJwt}`,
                        'Content-Profile': schema,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        p_source: `google_sheet:${spreadsheetId}`,
                        p_rows: rows,
                    }),
                }
            );

            if (!rpcResponse.ok) {
                console.error(
                    'External waitlist RPC failed:',
                    rpcResponse.status
                );

                res.status(502).json({
                    error: 'External waitlist import failed',
                    status: rpcResponse.status,
                });
                return;
            }

            const result = (await rpcResponse.json()) as {
                received: number;
                inserted: number;
                skipped: number;
            };

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
                error instanceof Error ? error.message : 'Unknown error'
            );

            res.status(500).json({
                success: false,
                error: 'External waitlist synchronization failed',
            });
        }
    }
);
