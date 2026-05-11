
import { defineSecret } from 'firebase-functions/params';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = defineSecret('SUPABASE_URL');
const SUPABASE_SERVICE_KEY = defineSecret('SUPABASE_SERVICE_KEY');
const INTEGRATIONS_MASTER_KEY = defineSecret('INTEGRATIONS_MASTER_KEY');

export async function openMaccabiSite(schema: string) {
const { chromium } = await import('playwright-core');

const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';
//const isEmulator = true; // Force non-headless mode for testing, remove in production 
let browser;

if (isEmulator) {
  browser = await chromium.launch({
    headless: false,
  });
} else {
  const chromiumAws = await import('@sparticuz/chromium');

  browser = await chromium.launch({
    args: chromiumAws.default.args,
    executablePath: await chromiumAws.default.executablePath(),
    headless: true,
  });
}

  const creds = await getMaccabiCredentials(schema);



  const page = await browser.newPage({
    viewport: { width: 1365, height: 768 },
  });

  try {
    await page.goto(creds.endpoint, {
  waitUntil: 'domcontentloaded',
  timeout: 60_000,
});

const screenshot = await page.screenshot({
  fullPage: true,
  type: 'png',
});

console.log('CURRENT URL:', page.url());
console.log('PAGE TITLE:', await page.title());
console.log('HAS ServiceType:', await page.locator('#ServiceType').count());

if ((await page.locator('#ServiceType').count()) === 0) {
  return {
    ok: false,
    url: page.url(),
    message: 'ServiceType not found on current page',
    screenshotBase64: screenshot.toString('base64'),
  };
}

console.log('CURRENT URL:', page.url());
console.log('PAGE TITLE:', await page.title());
console.log('BODY TEXT:', await page.locator('body').innerText().catch(() => 'NO BODY'));

    await page.waitForSelector('#ServiceType', { timeout: 60_000 });

await page.locator('#UserName').fill(String(creds.username));
await page.locator('#Password').fill(String(creds.password));


await page.locator('input[type="submit"], input[value="כניסה"], button:has-text("כניסה")').first().click();


    await page.waitForLoadState('networkidle', { timeout: 60_000 });

    const url = page.url();

    await browser.close();

    return {
      ok: true,
      url,
      message: 'Logged into Maccabi successfully',
    };
  } catch (error: any) {
    await browser.close();

    return {
      ok: false,
      message: error?.message ?? 'Unknown Playwright error',
    };
  }
}

function getMasterKey(): Buffer {
  const b64 = INTEGRATIONS_MASTER_KEY.value();
  const b = Buffer.from(b64, 'base64');
  if (b.length !== 32) throw new Error('INTEGRATIONS_MASTER_KEY must be 32 bytes (base64)');
  return b;
}

function decryptGcm(enc: any) {
  const key = getMasterKey();

  const iv = Buffer.from(enc.enc_iv.replace('\\x', ''), 'hex');
  const tag = Buffer.from(enc.enc_tag.replace('\\x', ''), 'hex');
  const data = Buffer.from(enc.enc_data.replace('\\x', ''), 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString('utf8');
}

async function getMaccabiCredentials(schema: string) {
  const sb = supabaseForSchema(schema);

  console.log(`Fetching Maccabi credentials for schema ${schema} from Supabase...`);
  const { data, error } = await sb
    .from('integration_secrets')
    .select('*')
    .eq('provider', 'MACCABI');

    console.log('Supabase response:', { data, error });

  if (error) throw new Error(error.message);

  const map: any = {};

  for (const row of data) {
    map[row.key_name] = decryptGcm(row);
  }

  return {
    username: map.USERNAME,
    password: map.PASSWORD,
    serviceProviderType: map.SERVICE_PROVIDER_TYPE,
    serviceProviderCode: map.SERVICE_PROVIDER_CODE,
    endpoint: map.ENDPOINT || 'https://wmsup.mac.org.il',
  };
}

function supabaseForSchema(schema: string) {
  return createClient(SUPABASE_URL.value(), SUPABASE_SERVICE_KEY.value(), {
    db: { schema },
    auth: { persistSession: false },
  });
}
