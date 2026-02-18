import { Component, Input, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { dbTenant } from '../../services/legacy-compat';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { RequestValidationService } from '../../services/request-validation.service';
import { RequestStatus } from '../../Types/detailes.model';
import { SupabaseTenantService } from '../../services/supabase-tenant.service';

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
  imports: [CommonModule, FormsModule, MatSnackBarModule],
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
  if (from && to && from === to) {
    if (allDay) return `${fmt(from)} — יום חופש מלא`;
    if (start && end) return `${fmt(from)} — ${start}–${end}`;
    if (start && !end) return `${fmt(from)} — החל מ־${start}`;
    return `${fmt(from)} — יום חופש`;
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
private tenantSvc = inject(SupabaseTenantService);

  private _decidedByUid = signal<string | null>(null);
  readonly decidedByUidSig = this._decidedByUid;

  @Input({ required: true })
  set decidedByUid(value: string) {
    this._decidedByUid.set(value);
  }
@Input() bulkMode = false;
public bulkWarning: string | null = null;

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
  const r = this.req();
  const requestId = r?.id;
  const decidedByUid = this.decidedByUidSig();

  if (!requestId) return;

  try {
    const { data, error } = await this.db
      .from('secretarial_requests')
      .update({
        status: 'REJECTED_BY_SYSTEM',
        decided_by_uid: decidedByUid,
        decision_note: (reason || 'בקשה לא תקינה').trim(),
        decided_at: new Date().toISOString(),
      })
      .eq('id', requestId)
      .eq('status', 'PENDING')
      .select('id,status')
      .maybeSingle();

    if (error) throw error;
    if (!data) return; // מישהו כבר טיפל

    const msg = reason || 'הבקשה נדחתה אוטומטית ע"י המערכת';
    this.toast(msg, 'info');

   this.onRejected?.({
  requestId,
  newStatus: 'REJECTED_BY_SYSTEM' as any, // עדיף שתעדכני את הטיפוס למטה
  message: msg,
  meta: { rejectedBySystem: true, systemReason: msg },
});

  } catch (e: any) {
    console.error('rejectBySystem failed', e);
    // אם נכשל – לא להפיל את ה-UI, רק להודיע
    this.onError?.({ requestId, message: e?.message ?? 'שגיאה בדחייה אוטומטית', raw: e });
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
}

  }

  async reject() {
  if (this.loading()) return;

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

    return from === to
      ? `${name} – יום חופש בתאריך ${from}`
      : `${name} – יום חופש בין ${from} עד ${to}`;
  }
}
