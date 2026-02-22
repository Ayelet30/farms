import { Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { dbTenant } from '../../services/legacy-compat';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ensureTenantContextReady } from '../../services/supabaseClient.service';
import { SupabaseTenantService } from '../../services/supabase-tenant.service';
import { getAuth } from 'firebase/auth';
import { RequestValidationService } from '../../services/request-validation.service';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';


type CancelDetails = {
  lesson_id: string;
  occur_date: string;
  start_time: string;
  end_time: string;
  child_id: string;
  child_name: string;
  instructor_id: string;
  instructor_name: string;
  reason: string;
  notified_at: string;
  cancelled_count_in_series: number;
};

type ToastKind = 'success' | 'error' | 'info';

@Component({
  selector: 'app-request-cancel-occurrence-details',
  standalone: true,
  imports: [CommonModule, FormsModule, MatSnackBarModule ,MatProgressSpinnerModule],
  templateUrl: './request-cancel-occurrence-details.component.html',
  styleUrls: ['./request-cancel-occurrence-details.component.scss'],
})
export class RequestCancelOccurrenceDetailsComponent implements OnInit {
  @Input({ required: true }) request!: any;      // UiRequest
  @Input({ required: true }) decidedByUid!: string;

  @Input() onApproved?: (e: { requestId: string; newStatus: 'APPROVED' ; message?: string; meta?: any }) => void;
  @Input() onRejected?: (e: { requestId: string; newStatus: 'REJECTED' | 'REJECTED_BY_SYSTEM'; message?: string; meta?: any }) => void;
  @Input() onError?: (e: { requestId?: string; message: string; raw?: any }) => void;
@Input() bulkMode = false;
public bulkWarning: string | null = null;
private validator = inject(RequestValidationService);
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
  if (this.bulkMode && type === 'success') return; // ✅ בבאלק לא להציג הצלחות
  this.snack.open(msg, 'סגור', {
    duration: 3500,
    direction: 'rtl',
    horizontalPosition: 'center',
    verticalPosition: 'top',
    panelClass: [type === 'success' ? 'sf-toast-success' : 'sf-toast-error'],
  });
}

private db!: ReturnType<typeof dbTenant>;
  private snack = inject(MatSnackBar);
private tenantSvc = inject(SupabaseTenantService);

  loading = signal(false);
  details = signal<CancelDetails | null>(null);
  decisionNote = '';

 async ngOnInit() {
  await ensureTenantContextReady();
  this.db = dbTenant();
  await this.loadDetails();
}


  async loadDetails() {
    this.loading.set(true);
    try {
      const { data, error } = await this.db.rpc('get_cancel_occurrence_details', {
        p_request_id: this.request.id,
      });
      if (error) throw error;
      this.details.set((data?.[0] ?? null) as CancelDetails | null);
    } catch (e: any) {
      console.error(e);
      const msg = e?.message || 'שגיאה בטעינת פרטי הביטול';
      this.toast(msg, 'error');
      this.onError?.({ requestId: this.request?.id, message: msg, raw: e });
    } finally {
      this.loading.set(false);
    }
  }

  static async isValidRequset(row: any): Promise<{ ok: boolean; reason?: string }> {
    const p: any = row?.payload ?? {};
    const dateStr = p.occur_date ?? row?.fromDate ?? null;
    const timeStr = p.start_time ?? p.startTime ?? p.time ?? null;

    if (!dateStr) return { ok: true };

    const dt = RequestCancelOccurrenceDetailsComponent.combineDateTime(dateStr, timeStr);
    if (dt.getTime() < Date.now()) {
      return { ok: false, reason: 'עבר מועד השיעור לביטול' };
    }
    return { ok: true };
  }

  async isValidRequset(): Promise<{ ok: boolean; reason?: string }> {
    return await RequestCancelOccurrenceDetailsComponent.isValidRequset(this.request);
  }

  async approve() {
  if (this.loading()) return;
    this.action.set('approve');     

  this.loading.set(true);
 const v = await this.validator.validate(this.request, 'approve');
if (!v.ok) {
  await this.rejectBySystem(v.reason);
  this.loading.set(false);
  return;
}



  try {
    await this.tenantSvc.ensureTenantContextReady();
    const tenant = this.tenantSvc.requireTenant();
    const tenantSchema = tenant.schema;
    const tenantId = tenant.id;

    const user = getAuth().currentUser;
    if (!user) throw new Error('המשתמש לא מחובר');
    const token = await user.getIdToken();

    const url = 'https://us-central1-bereshit-ac5d8.cloudfunctions.net/approveCancelOccurrenceAndNotify';

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        tenantSchema,
        tenantId,
        requestId: this.request.id,
        decisionNote: this.decisionNote || null,
      }),
    });

    const raw = await resp.text();
    let json: any = null;
    try { json = JSON.parse(raw); } catch {}

    if (!resp.ok || !json?.ok) {
      throw new Error(json?.message || json?.error || `HTTP ${resp.status}: ${raw?.slice(0, 300)}`);
    }
this.bulkWarning = null;

// תומך בשני שמות מפתחות אפשריים מהשרת
const mailOk = (json?.mailOk ?? json?.emailOk);
const warnFromServer = (json?.warning ?? '').toString().trim();

if (mailOk === false) {
  this.bulkWarning = 'אושרה ✅ אבל לא נשלח מייל להורה';
  const extra = (json?.mailError?.message ?? json?.emailError ?? warnFromServer ?? '').toString().trim();
  this.showSnack(`אושר ✅ אבל שליחת מייל נכשלה${extra ? `: ${extra}` : ''}`, 'error');
} else if (warnFromServer) {
  // אם אצלך לפעמים מחזירים warning בלי mailOk
  this.bulkWarning = warnFromServer;
  this.showSnack(warnFromServer, 'error');
} else {
  this.showSnack('הבקשה אושרה בהצלחה ✅', 'success');
}

    const d = this.details();
    const who = d?.child_name ? `ל${d.child_name}` : 'לילד/ה';
    const when = d?.occur_date ? `בתאריך ${this.formatDate(d.occur_date)}` : '';
    const msg = `אישרת ביטול שיעור ${who} ${when}.`;

    this.toast(msg, 'success');

    this.onApproved?.({
  requestId: this.request.id,
  newStatus: 'APPROVED',
  message: this.bulkWarning ? `אושר ✅ (${this.bulkWarning})` : 'אושר ✅',
  meta: { ...(d ?? {}), warning: this.bulkWarning, mailOk },
});

  } catch (e: any) {
    console.error(e);
    const msg = e?.message || 'שגיאה באישור בקשת ביטול';
    this.toast(msg, 'error');
    this.onError?.({ requestId: this.request?.id, message: msg, raw: e });
  } finally {
    this.loading.set(false);
      this.action.set(null);            

  }
}
async reject() {
  if (this.loading()) return;
    this.action.set('reject');        

  this.loading.set(true);
 const v = await this.validator.validate(this.request, 'reject');
if (!v.ok) {
  await this.rejectBySystem(v.reason);
  this.loading.set(false);
  return;
}


  try {
    await this.tenantSvc.ensureTenantContextReady();
    const tenant = this.tenantSvc.requireTenant();
    const tenantSchema = tenant.schema;
    const tenantId = tenant.id;

    const user = getAuth().currentUser;
    if (!user) throw new Error('המשתמש לא מחובר');
    const token = await user.getIdToken();

    const url = 'https://us-central1-bereshit-ac5d8.cloudfunctions.net/rejectCancelOccurrenceAndNotify';

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        tenantSchema,
        tenantId,
        requestId: this.request.id,
        decisionNote: this.decisionNote || null,
      }),
    });

    const raw = await resp.text();
    let json: any = null;
    try { json = JSON.parse(raw); } catch {}

    if (!resp.ok || !json?.ok) {
      throw new Error(json?.message || json?.error || `HTTP ${resp.status}: ${raw?.slice(0, 300)}`);
    }
this.bulkWarning = null;

const mailOk = (json?.mailOk ?? json?.emailOk);
const warnFromServer = (json?.warning ?? '').toString().trim();

if (mailOk === false) {
  this.bulkWarning = 'נדחתה ✅ אבל לא נשלח מייל להורה';
  const extra = (json?.mailError?.message ?? json?.emailError ?? warnFromServer ?? '').toString().trim();
  this.showSnack(`נדחה ✅ אבל שליחת מייל נכשלה${extra ? `: ${extra}` : ''}`, 'error');
} else if (warnFromServer) {
  this.bulkWarning = warnFromServer;
  this.showSnack(warnFromServer, 'error');
} else {
  this.showSnack('הבקשה נדחתה בהצלחה ✅', 'success');
}


    const d = this.details();
    const who = d?.child_name ? `ל${d.child_name}` : 'לילד/ה';
    const msg = `דחית בקשת ביטול שיעור ${who}.`;

    this.toast(msg, 'info');
this.onRejected?.({
  requestId: this.request.id,
  newStatus: 'REJECTED',
  message: this.bulkWarning ? `נדחה ✅ (${this.bulkWarning})` : 'נדחה ✅',
  meta: { ...(d ?? {}), warning: this.bulkWarning, mailOk },
});


  } catch (e: any) {
    console.error(e);
    const msg = e?.message || 'שגיאה בדחיית הבקשה';
    this.toast(msg, 'error');
    this.onError?.({ requestId: this.request?.id, message: msg, raw: e });
  } finally {
    this.loading.set(false);
    this.action.set(null);               

  }
}
private async rejectBySystem(reason: string): Promise<void> {
  await ensureTenantContextReady();
  const db = this.db;

  await db
    .from('secretarial_requests')
    .update({
      status: 'REJECTED_BY_SYSTEM',
      decided_by_uid: this.decidedByUid ?? null,
      decision_note: reason?.trim() || 'נדחה אוטומטית: בקשה לא רלוונטית',
      decided_at: new Date().toISOString(),
    })
    .eq('id', this.request.id)
    .eq('status', 'PENDING');

  this.onRejected?.({
    requestId: this.request.id,
    newStatus: 'REJECTED_BY_SYSTEM' as const,
    message: reason,
    meta: { warning: 'REJECTED_BY_SYSTEM' },
  });

  this.toast(reason, 'error');
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
}
