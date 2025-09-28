declare namespace NodeJS {
interface ProcessEnv {
SUPABASE_URL: string;
SUPABASE_SERVICE_KEY: string; // service role לשרת בלבד
TRANZILA_SUPPLIER: string; // שם מסוף/ספק כפי שניתן ע"י טרנזילה
TRANZILA_PASSWORD: string; // סיסמה/מפתח API (אל תחשפי בפרונט)
PUBLIC_BASE_URL: string; // https://your-domain.com
}
}