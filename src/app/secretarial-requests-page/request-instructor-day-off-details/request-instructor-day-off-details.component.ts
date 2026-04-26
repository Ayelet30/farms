import { Component, Input, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { dbTenant } from '../../services/legacy-compat';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { RequestValidationService } from '../../services/request-validation.service';
import { RequestStatus } from '../../Types/detailes.model';
import { SupabaseTenantService } from '../../services/supabase-tenant.service';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { getAuth } from 'firebase/auth';
import { requireTenant, supabase } from '../../services/supabaseClient.service';
type ImpactRow = {
  occur_date: string; // date
  start_time: string; // time
  end_time: string;   // time
  child_name: string;
  lesson_id: string;
};

type ToastKind = 'success' | 'error' | 'info';

@Component({
  selector: 'app-request-instructor-day-off-details',
  standalone: true,
  imports: [CommonModule, FormsModule, MatSnackBarModule , MatProgressSpinnerModule],
  templateUrl: './request-instructor-day-off-details.component.html',
  styleUrls: ['./request-instructor-day-off-details.component.scss'],
})
export class RequestInstructorDayOffDetailsComponent {
  private snack = inject(MatSnackBar);
  private db = dbTenant();
  private validator = inject(RequestValidationService);

  // ====== INPUTS → Signals (כדי שהפרטים יתעדכנו תמיד) ======
  private _req = signal<any | null>(null);
  readonly req = this._req;
readonly status = computed(() => (this.req() as any)?.status ?? null);
readonly isPending = computed(() => this.status() === 'PENDING');

// ✅ האם להציג impact + האם לטעון impact
readonly shouldShowImpact = computed(() => this.isPending());
// ✅ האם להציג פעולות (Approve/Reject)
readonly canDecide = computed(() => this.isPending());
readonly isSickRequest = computed(() => {
  const p: any = (this.req() as any)?.payload ?? {};
  return String(p.category ?? '').toUpperCase() === 'SICK';
});

readonly medicalCertificateUrl = computed(() => {
  const p: any = (this.req() as any)?.payload ?? {};
  const path = p.medical_certificate_url ?? null;

  if (!path) return null;

  if (!supabase) {
    console.error('Supabase client is not initialized');
    return null;
  }

  const { data } = supabase.storage
    .from('sick_notes')
    .getPublicUrl(path);

  return data.publicUrl;
});
readonly windowText = computed(() => {
  const r: any = this.req() ?? {};
  const p: any = r.payload ?? {};

  const from = (r.fromDate ?? p.from_date ?? '').slice(0, 10);
  const to   = (r.toDate   ?? p.to_date   ?? from).slice(0, 10);

const allDay =
  p.all_day === undefined || p.all_day === null
    ? true
    : (p.all_day === true || p.all_day === 'true');

  const start = (p.requested_start_time ?? '').toString().slice(0, 5) || null;
  const end   = (p.requested_end_time   ?? '').toString().slice(0, 5) || null;

  const fmt = (d: string) => {
    try { return new Date(d).toLocaleDateString('he-IL'); }
    catch { return d; }
  };

  // 1) יום אחד
const label = this.getCategoryLabel();

// 1) יום אחד
if (from && to && from === to) {
  if (allDay) return `${fmt(from)} — ${label} מלא`;
  if (start && end) return `${fmt(from)} — ${start}–${end}`;
  if (start && !end) return `${fmt(from)} — החל מ־${start}`;
  return `${fmt(from)} — ${label}`;
}

// 2) טווח ימים
if (from && to && from !== to) {
  if (allDay) return `${fmt(from)}–${fmt(to)} — ${label} מלאה`;
  if (start && end) return `${fmt(from)}–${fmt(to)} — בכל יום ${start}–${end}`;
  if (start && !end) return `${fmt(from)}–${fmt(to)} — בכל יום החל מ־${start}`;
  return `${fmt(from)}–${fmt(to)} — ${label}`;
}

  // 2) טווח ימים
  if (from && to && from !== to) {
    if (allDay) return `${fmt(from)}–${fmt(to)} — חופשה מלאה`;
    if (start && end) return `${fmt(from)}–${fmt(to)} — בכל יום ${start}–${end}`;
    if (start && !end) return `${fmt(from)}–${fmt(to)} — בכל יום החל מ־${start}`;
    return `${fmt(from)}–${fmt(to)} — חופשה`;
  }

  return '—';
});

  @Input({ required: true })
  set request(value: any) {
    this._req.set(value);
  }
   getCategoryLabel(): string {
  const p: any = (this.req() as any)?.payload ?? {};
  const c = String(p.category ?? '').toUpperCase();

  switch (c) {
    case 'SICK': return 'יום מחלה';
    case 'HOLIDAY': return 'יום חופש';
    case 'PERSONAL': return 'יום אישי';
    case 'OTHER': return 'אחר';
    default: return 'היעדרות';
  }
}
private tenantSvc = inject(SupabaseTenantService);

  private _decidedByUid = signal<string | null>(null);
  readonly decidedByUidSig = this._decidedByUid;

  @Input({ required: true })
  set decidedByUid(value: string) {
    this._decidedByUid.set(value);
  }
@Input() bulkMode = false;
public bulkWarning: string | null = null;
busy = signal(false);
action = signal<'approve' | 'reject' | null>(null);

busyText = computed(() => {
  switch (this.action()) {
    case 'approve': return 'הבקשה בתהליך אישור…';
    case 'reject':  return 'הבקשה בתהליך דחייה…';
    default:        return 'מעבד…';
  }
});

private showSnack(msg: string, type: 'success' | 'error') {
  if (this.bulkMode && type === 'success') return; // בבאלק לא להציג הצלחות
  this.snack.open(msg, 'סגור', {
    duration: 3500,
    direction: 'rtl',
    horizontalPosition: 'center',
    verticalPosition: 'top',
    panelClass: [type === 'success' ? 'sf-toast-success' : 'sf-toast-error'],
  });
}
private async readJson(resp: Response) {
  const raw = await resp.text();
  let json: any = null;
  try { json = raw ? JSON.parse(raw) : null; } catch {}
  if (!resp.ok || !json?.ok) {
    throw new Error(json?.message || json?.error || `HTTP ${resp.status}: ${raw.slice(0, 300)}`);
  }
  return { json, raw };
}

  // callbacks מהאב
  @Input() onApproved?: (e: { requestId: string; newStatus: 'APPROVED'; message?: string; meta?: any }) => void;
@Input() onRejected?: (e: { requestId: string; newStatus: | 'REJECTED' | 'REJECTED_BY_SYSTEM'; message?: string; meta?: any }) => void;
  @Input() onError?: (e: { requestId?: string; message: string; raw?: any }) => void;

  // ====== UI state ======
  loading = signal(false);
  loadingImpact = signal(false);
  impactRows = signal<ImpactRow[]>([]);
  decisionNote = signal(''); // ✅ סיגנל במקום string

  // כדי למנוע מצב שבו response ישן מגיע אחרי חדש
  private runToken = 0;

  // ====== נגזרים ======
  impactCount = computed(() => this.impactRows().length);
// alias כדי שה-bulk runner שממלא inst.note יעבוד
note = this.decisionNote;

  constructor() {
    // כל פעם שהבקשה משתנה (לפי id) → טוענים impact מחדש
    effect(() => {
    const id = this.req()?.id;
    if (!id) return;

    // איפוס impact רק כשעוברים בקשה
    this.impactRows.set([]);

    if (this.isPending()) {
      void this.loadImpact();
    }
  });
  }

  async loadImpact() {
    const r = this.req();
    const requestId = r?.id;
    if (!requestId) return;

    const token = ++this.runToken;

    this.loadingImpact.set(true);
    try {
      const { data, error } = await this.db.rpc('get_instructor_day_off_impact', {
        p_request_id: requestId,
      });
      if (error) throw error;

      if (token !== this.runToken) return; // נזרק אם כבר נבחרה בקשה אחרת
      this.impactRows.set((data ?? []) as ImpactRow[]);
    } catch (e: any) {
      if (token !== this.runToken) return;
      console.error(e);
      const msg = e?.message || 'שגיאה בטעינת השיעורים שיתבטלו';
      this.toast(msg, 'error');
      this.onError?.({ requestId, message: msg, raw: e });
    } finally {
      if (token !== this.runToken) return;
      this.loadingImpact.set(false);
    }
  }
private async rejectBySystem(reason: string): Promise<void> {
  if (!this.request?.id) return;

  const tenantSchema = requireTenant().schema;               // ✅ schema מה-context
  const decidedByUid = getAuth().currentUser?.uid ?? null;   // ✅ uid של המשתמש המחובר

  // אם את רוצה decided_by_uid מתוך טבלת users (ולא uid של Firebase):
  // const appUser = await getCurrentUserData();
  // const decidedByUid = appUser?.uid ?? getAuth().currentUser?.uid ?? null;

  const idToken = await getAuth().currentUser?.getIdToken();
  if (!idToken) throw new Error('No Firebase token');

  const resp = await fetch(
    'https://us-central1-bereshit-ac5d8.cloudfunctions.net/autoRejectRequestAndNotify',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        tenantSchema,
        requestId: this.request.id,
        reason,
        decidedByUid,
      }),
    }
  );

  const text = await resp.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch {}

  if (!resp.ok || json?.ok === false) {
    throw new Error(json?.error || `autoRejectRequestAndNotify failed: ${resp.status}`);
  }
}

  static async isValidRequset(row: any): Promise<{ ok: boolean; reason?: string }> {
    const end = row?.toDate ?? row?.fromDate ?? null;
    if (!end) return { ok: true };

    const dt = RequestInstructorDayOffDetailsComponent.combineDateTime(end, '23:59');
    if (dt.getTime() < Date.now()) {
      return { ok: false, reason: 'עבר מועד חופשת המדריך' };
    }
    return { ok: true };
  }

  async isValidRequset(): Promise<{ ok: boolean; reason?: string }> {
    return await RequestInstructorDayOffDetailsComponent.isValidRequset(this.req());
  }

  async approve() {
    if (this.loading()) return;
      this.action.set('approve');          // ✅ להוסיף
  this.loading.set(true);


    const r = this.req();
    const requestId = r?.id;
    const decidedByUid = this.decidedByUidSig();

    if (!requestId || !decidedByUid) return;
 // ✅ הולידציה דרך השירות – לפני אישור
 const v = await this.validator.validate(r, 'approve');
if (!v.ok) { await this.rejectBySystem(v.reason ?? 'הבקשה אינה רלוונטית'); return; }

this.loading.set(true);
try {
  const token = await (await import('firebase/auth')).getAuth().currentUser?.getIdToken();
  const url = 'https://us-central1-bereshit-ac5d8.cloudfunctions.net/approveInstructorDayOffAndNotify';
await this.tenantSvc.ensureTenantContextReady();
const tenant = this.tenantSvc.requireTenant();
const tenantSchema = tenant.schema;
const tenantId = tenant.id;

const resp = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  },
body: JSON.stringify({
  tenantSchema,
  tenantId,
  requestId: r.id,
  decisionNote: this.decisionNote().trim() || null,
}),

});


 const { json } = await this.readJson(resp);

this.bulkWarning = null;

const mailOk = (json?.mailOk ?? json?.emailOk);
const warnFromServer = (json?.warning ?? '').toString().trim();

if (mailOk === false) {
  this.bulkWarning = 'אושר ✅ אבל שליחת מייל נכשלה ';
  const extra = (json?.mailErrors?.[0]?.message ?? json?.mailError?.message ?? warnFromServer ?? '').toString().trim();
  this.showSnack(`אושר ✅ אבל שליחת מייל נכשלה${extra ? `: ${extra}` : ''}`, 'error');
} else if (warnFromServer) {
  // למשל: אין uid למדריך / חלק מההורים נכשלו
  this.bulkWarning = warnFromServer;
  this.showSnack(warnFromServer, 'error');
} else {
  this.showSnack('הבקשה אושרה בהצלחה ✅', 'success');
}

const msg = this.bulkWarning
  ? `אישרת: ${this.getDayOffTitle()}. ${this.bulkWarning}`
  : `אישרת: ${this.getDayOffTitle()}.`;

this.toast(msg, this.bulkWarning ? 'info' : 'success');

this.onApproved?.({
  requestId: r.id,
  newStatus: 'APPROVED',
  message: this.bulkWarning ? `אושר ✅ (${this.bulkWarning})` : 'אושר ✅',
  meta: { ...(json?.meta ?? {}), warning: this.bulkWarning, mailOk },
});

} finally {
  this.loading.set(false);
    this.action.set(null);        

}

  }
readonly requestNote = computed(() => {
  const p: any = (this.req() as any)?.payload ?? {};
  return String(p.note ?? '').trim() || null;
});
  async reject() {
  if (this.loading()) return;
    this.action.set('reject');      


  const r = this.req();
  const requestId = r?.id;
  const decidedByUid = this.decidedByUidSig();

  if (!requestId || !decidedByUid) return;
 const v = await this.validator.validate(r, 'reject');
if (!v.ok) { await this.rejectBySystem(v.reason ?? 'הבקשה אינה רלוונטית'); return; }

this.loading.set(true);
try {
  const token = await (await import('firebase/auth')).getAuth().currentUser?.getIdToken();
  const url = 'https://us-central1-bereshit-ac5d8.cloudfunctions.net/rejectInstructorDayOffAndNotify';
await this.tenantSvc.ensureTenantContextReady();
const tenant = this.tenantSvc.requireTenant();
const tenantSchema = tenant.schema;
const tenantId = tenant.id;

const resp = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  },
body: JSON.stringify({
  tenantSchema,
  tenantId,
  requestId: r.id,
  decisionNote: this.decisionNote().trim() || null,
}),

});


  const { json } = await this.readJson(resp);

this.bulkWarning = null;

const mailOk = (json?.mailOk ?? json?.emailOk);
const warnFromServer = (json?.warning ?? '').toString().trim();

if (mailOk === false) {
  this.bulkWarning = 'נדחה ✅ אבל שליחת מייל נכשלה';
  const extra = (json?.mailError?.message ?? warnFromServer ?? '').toString().trim();
  this.showSnack(`נדחה ✅ אבל שליחת מייל נכשלה${extra ? `: ${extra}` : ''}`, 'error');
} else if (warnFromServer) {
  this.bulkWarning = warnFromServer;
  this.showSnack(warnFromServer, 'error');
} else {
  this.showSnack('הבקשה נדחתה בהצלחה ✅', 'success');
}

const msg = this.bulkWarning
  ? `דחית את הבקשה: ${this.getDayOffTitle()}. ${this.bulkWarning}`
  : `דחית את הבקשה: ${this.getDayOffTitle()}.`;

this.toast(msg, 'info');

this.onRejected?.({
  requestId: r.id,
  newStatus: 'REJECTED',
  message: this.bulkWarning ? `נדחה ✅ (${this.bulkWarning})` : 'נדחה ✅',
  meta: { warning: this.bulkWarning, mailOk },
});

} finally {
  this.loading.set(false);
    this.action.set(null);          

}

}

  private toast(message: string, type: ToastKind = 'info') {
    this.snack.open(message, 'סגור', {
      duration: 3500,
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
      panelClass: [`sf-toast`, `sf-toast-${type}`],
    });
  }

  private formatDate(d: any): string {
    try { return new Date(d).toLocaleDateString('he-IL'); }
    catch { return String(d ?? ''); }
  }

  private static combineDateTime(dateStr: string, timeStr?: string | null): Date {
    const d = dateStr?.slice(0, 10);
    const t = (timeStr ?? '00:00').slice(0, 5);
    return new Date(`${d}T${t}:00`);
  }

getDayOffTitle(): string {
  const r = this.req();
  const name = r?.instructorName || 'המדריך/ה';
  const from = this.formatDate(r?.fromDate);
  const to = this.formatDate(r?.toDate || r?.fromDate);
  const label = this.getCategoryLabel();

  return from === to
    ? `${name} – ${label} בתאריך ${from}`
    : `${name} – ${label} בין ${from} עד ${to}`;
}
}
