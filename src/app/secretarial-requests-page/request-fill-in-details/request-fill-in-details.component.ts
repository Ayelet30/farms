import { CommonModule } from '@angular/common';
import { Component, Input, Output, EventEmitter, signal, computed, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { ensureTenantContextReady, dbTenant } from '../../services/supabaseClient.service';
import { inject } from '@angular/core';
import { SupabaseTenantService } from '../../services/supabase-tenant.service';
import { getAuth } from 'firebase/auth';
import { RequestValidationService } from '../../services/request-validation.service';

type UiRequest = any;

const EXCEPTIONS_TABLE = 'lesson_occurrence_exceptions';

@Component({
  selector: 'app-request-fill-in-details',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './request-fill-in-details.component.html',
  styleUrls: ['./request-fill-in-details.component.css'],
})
export class RequestFillInDetailsComponent implements OnInit {
  @Input({ required: true }) request!: UiRequest;
  @Input() decidedByUid?: string | null;
  @Input() bulkMode = false;

   @Input() onApproved?: (e: { requestId: string; newStatus: 'APPROVED'; message?: string; meta?: any }) => void;
@Input() onRejected?: (e: { requestId: string; newStatus: | 'REJECTED' | 'REJECTED_BY_SYSTEM'; message?: string; meta?: any }) => void;
  @Input() onError?: (e: any) => void;
note = signal<string>('');

  @Output() approved = new EventEmitter<{ requestId: string; newStatus: 'APPROVED' }>();
  @Output() rejected = new EventEmitter<{ requestId: string; newStatus: 'REJECTED' | 'REJECTED_BY_SYSTEM' }>();
  @Output() error = new EventEmitter<string>();

  constructor(private snack: MatSnackBar) {}
private tenantSvc = inject(SupabaseTenantService);
readonly status = computed(() => (this.request as any)?.status ?? null);
readonly isPending = computed(() => this.status() === 'PENDING');
private validator = inject(RequestValidationService);
bulkWarning: string | null = null;

readonly canDecide = computed(() => this.isPending());
readonly shouldShowFillInTarget = computed(() => this.isPending());

  busy = signal(false);
  action = signal<'approve' | 'reject' | null>(null);
  errorMsg = signal<string | null>(null);


  payload = computed(() => {
    try {
      const p = this.request?.payload;
      if (!p) return {};
      if (typeof p === 'string') return JSON.parse(p);
      return p;
    } catch {
      return {};
    }
  });

  requestId = computed(() => this.request?.id ?? null);
  fromDate = computed(() => this.request?.fromDate ?? this.request?.from_date ?? null);
  toDate   = computed(() => this.request?.toDate ?? this.request?.to_date ?? null);
  lessonOccId = computed(() => this.request?.lessonOccId ?? this.request?.lesson_occ_id ?? null);

  timeRange = computed(() => {
    const p: any = this.payload() ?? {};
    const start = this.normalizeTime(p.requested_start_time ?? null);
    const end   = this.normalizeTime(p.requested_end_time ?? null);
    if (!start || start === '—') return '—';
    if (!end || end === '—') return start;
    return `${start}-${end}`;
  });

  // ===== יעד מילוי מקום: השיעור שבוטל =====
  loadingFillInTarget = signal(false);

  fillInTarget = signal<null | {
    occur_date: string;
    start_time: string;
    end_time: string;
    status_label: string | null;
    note: string | null;
  }>(null);

  busyText = computed(() => {
  switch (this.action()) {
    case 'approve': return 'הבקשה בתהליך אישור…';
    case 'reject':  return 'הבקשה בתהליך דחייה…';
    default:        return 'מעבד…';
  }
});


  ngOnInit() {
    void this.loadFillInTarget();
  }

  private clearMessages() {
    this.errorMsg.set(null);
    this.bulkWarning = null;

  }

  private fail(msg: string, raw?: any) {
    this.errorMsg.set(msg);
    this.error.emit(msg);
    this.onError?.({ requestId: this.requestId(), message: msg, raw });
    this.snack.open(msg, 'סגור', {
      duration: 3500,
      panelClass: ['snack-reject'],
      direction: 'rtl',
      horizontalPosition: 'center',
      verticalPosition: 'top',
    });
  }
private async rejectBySystem(reason: string): Promise<void> {
  const r = this.request;
  if (!r?.id) return;

  try {
    await this.tenantSvc.ensureTenantContextReady();
    const tenant = this.tenantSvc.requireTenant();
    const tenantSchema = tenant.schema;
    const tenantId = tenant.id;

    const user = getAuth().currentUser;
    if (!user) throw new Error('המשתמש לא מחובר');
    const token = await user.getIdToken();

    const resp = await fetch(
      'https://us-central1-bereshit-ac5d8.cloudfunctions.net/rejectFillInAndNotify',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          tenantSchema,
          tenantId,
          requestId: r.id,
          // ✅ כאן אנחנו כופים "דחייה ע״י מערכת" עם סיבה
          decisionNote: (reason || 'הבקשה נדחתה אוטומטית ע״י המערכת').trim(),
          source: 'system', // אם הפונקציה שלך תומכת בזה (לא חובה)
        }),
      }
    );

    const raw = await resp.text();
    let json: any = null;
    try { json = JSON.parse(raw); } catch {}

    if (!resp.ok || !json?.ok) {
      throw new Error(json?.message || json?.error || `HTTP ${resp.status}: ${raw?.slice(0, 300)}`);
    }

    // ✅ לעדכן UI (כמו בשאר הקומפוננטות)
    const evt = { requestId: r.id, newStatus: 'REJECTED_BY_SYSTEM' as const };
    this.rejected.emit(evt);
    this.onRejected?.(evt);

    // הצלחה בבאלק לא מציגים, אבל זה "אוטומטי" אז אפשר להציג רק אם תרצי
    if (!this.bulkMode) this.okSnack('הבקשה נדחתה אוטומטית ע״י המערכת');
  } catch (e: any) {
    // אם הדחייה האוטומטית נכשלה – נציג error רגיל
    this.fail(e?.message ?? 'שגיאה בדחייה אוטומטית ע״י המערכת', e);
  }
}

  private okSnack(msg: string) {
    if (this.bulkMode) return;
    this.snack.open(msg, 'סגור', {
      duration: 2500,
      panelClass: ['snack-ok'],
      direction: 'rtl',
      horizontalPosition: 'center',
      verticalPosition: 'top',
    });
  }

  private normalizeTime(t: any): string {
    if (!t) return '—';
    const s = String(t);
    if (/^\d{2}:\d{2}:\d{2}$/.test(s)) return s.slice(0, 5);
    if (/^\d{2}:\d{2}$/.test(s)) return s;
    return s;
  }

  async loadFillInTarget(): Promise<void> {
    const lessonId = this.lessonOccId();
    if (!lessonId) {
      this.fillInTarget.set(null);
      return;
    }

    this.loadingFillInTarget.set(true);
    try {
      await ensureTenantContextReady();
      const db = await dbTenant();

  const lessonId = this.lessonOccId();   // בפועל lesson_id
if (!lessonId) { this.fillInTarget.set(null); return; }

const { data: ex, error: exErr } = await db
  .from('lesson_occurrence_exceptions')
  .select('occur_date, status, note, canceller_role, cancelled_at')
  .eq('lesson_id', lessonId)
  .eq('status', 'נשלחה בקשה למילוי מקום')
  .order('occur_date', { ascending: false })
  .limit(1)
  .maybeSingle();

if (exErr) throw exErr;
if (!ex?.occur_date) { this.fillInTarget.set(null); return; }

const originalDate = String(ex.occur_date);
const { data: occ, error: occErr } = await db
  .from('lessons_occurrences')
  .select('occur_date, start_time, end_time, instructor_id, day_of_week, lesson_type, status')
  .eq('lesson_id', lessonId)
  .eq('occur_date', originalDate)
  .maybeSingle();

if (occErr) throw occErr;
if (!occ) { this.fillInTarget.set(null); return; }

this.fillInTarget.set({
  occur_date: originalDate,
  start_time: String((occ as any).start_time ?? ''),
  end_time: String((occ as any).end_time ?? ''),
  status_label: String((ex as any).status ?? null),
  note: (ex as any).note ?? null,
});

    } catch {
      this.fillInTarget.set(null);
    } finally {
      this.loadingFillInTarget.set(false);
    }
  }



  // ===== APPROVE =====
  async approve(): Promise<void> {
    if (this.busy()) return; 
    this.clearMessages();
    this.action.set('approve');
    this.busy.set(true);

   const r = this.request;
  if (!r?.id) {
    this.busy.set(false);
    this.action.set(null);
    return;
  }

  // ✅ בדיקת שירות לפני אישור
  const v = await this.validator.validate(r, 'approve'); // או השם המדויק אצלך
  if (!v.ok) {
    await this.rejectBySystem(v.reason ?? 'הבקשה אינה רלוונטית');
    this.busy.set(false);
    this.action.set(null);
    return; // 👈 חשוב
  }
    try {
      await this.tenantSvc.ensureTenantContextReady();
      const tenant = this.tenantSvc.requireTenant();
      const tenantSchema = tenant.schema;
      const tenantId = tenant.id;

      const user = getAuth().currentUser;
      if (!user) throw new Error('המשתמש לא מחובר');
      const token = await user.getIdToken();

      const url = 'https://us-central1-bereshit-ac5d8.cloudfunctions.net/approveFillInAndNotify';

      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          tenantSchema,
          tenantId,
          requestId: r.id,
        }),
      });

      const raw = await resp.text();
      let json: any = null;
      try { json = JSON.parse(raw); } catch {}

      if (!resp.ok || !json?.ok) {
        throw new Error(json?.message || json?.error || `HTTP ${resp.status}: ${raw?.slice(0, 300)}`);
      }
const warn = (json?.warning ?? '').toString().trim();
if (warn) {
  this.bulkWarning = warn;

  if (!this.bulkMode) {
    this.snack.open(warn, 'סגור', {
      duration: 3500,
      panelClass: ['snack-warn'], // אם אין לך סטייל כזה, שימי ['snack-reject']
      direction: 'rtl',
      horizontalPosition: 'center',
      verticalPosition: 'top',
    });
  }
}

      this.okSnack('אושר ✅');
      const evt = { requestId: r.id, newStatus: 'APPROVED' as const };
      this.approved.emit(evt);
      this.onApproved?.(evt);
    } catch (e: any) {
      this.fail(e?.message ?? 'שגיאה באישור הבקשה', e);
    } finally {
      this.busy.set(false);
      this.action.set(null);
    }
  }

  // ===== REJECT (supports bulk reason) =====
 async reject(): Promise<void> {
    if (this.busy()) return; 
   this.clearMessages();
  this.action.set('reject');
  this.busy.set(true);

  const r = this.request;
  if (!r?.id) {
    this.busy.set(false);
    this.action.set(null);
    return;
  }

  // ✅ בדיקת שירות לפני דחייה (כן, גם פה)
  const v = await this.validator.validate(r, 'reject'); // או 'approve' אם אצלך זה אותו דבר
  if (!v.ok) {
    await this.rejectBySystem(v.reason ?? 'הבקשה אינה רלוונטית');
    this.busy.set(false);
    this.action.set(null);
    return; // 👈 חשוב
  }
  try {
    await this.tenantSvc.ensureTenantContextReady();
    const tenant = this.tenantSvc.requireTenant();
    const tenantSchema = tenant.schema;
    const tenantId = tenant.id;

    const user = getAuth().currentUser;
    if (!user) throw new Error('המשתמש לא מחובר');
    const token = await user.getIdToken();

    const resp = await fetch('https://us-central1-bereshit-ac5d8.cloudfunctions.net/rejectFillInAndNotify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        tenantSchema,
        tenantId,
        requestId: this.requestId(),
        decisionNote: this.note().trim() || null,
      }),
    });

    const raw = await resp.text();
    let json: any = null; try { json = JSON.parse(raw); } catch {}
    if (!resp.ok || !json?.ok) throw new Error(json?.message || json?.error || raw);
    const warn = (json?.warning ?? '').toString().trim();
if (warn) {
  this.bulkWarning = warn;

  if (!this.bulkMode) {
    this.snack.open(warn, 'סגור', {
      duration: 3500,
      panelClass: ['snack-warn'],
      direction: 'rtl',
      horizontalPosition: 'center',
      verticalPosition: 'top',
    });
  }
}

    this.okSnack('נדחה ✅');
    const evt = { requestId: r.id, newStatus: 'REJECTED' as const };
    this.rejected.emit(evt);
    this.onRejected?.(evt);
  } catch (e: any) {
    this.fail(e?.message ?? 'שגיאה בדחיית הבקשה', e);
  } finally {
    this.busy.set(false);
    this.action.set(null);
  }
}

}


