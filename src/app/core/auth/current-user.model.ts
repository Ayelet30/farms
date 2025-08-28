export type TenantCtx = { id: string; schema: string };
export type CurrentUser = {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  role?: string | null;        // תפקיד לוגי באפליקציה
  tenant?: TenantCtx | null;   // החווה הנוכחית
};
