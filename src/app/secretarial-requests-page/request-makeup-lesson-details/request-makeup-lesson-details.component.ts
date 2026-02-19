import { CommonModule } from '@angular/common';
import { Component, Input, Output, EventEmitter, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { SupabaseTenantService } from '../../services/supabase-tenant.service';

import { ensureTenantContextReady, dbTenant } from '../../services/supabaseClient.service';
import { getAuth } from 'firebase/auth';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { inject } from '@angular/core';
import { RequestValidationService } from '../../services/request-validation.service';

const SECRETARIAL_REQUESTS_TABLE = 'secretarial_requests';
const EXCEPTIONS_TABLE = 'lesson_occurrence_exceptions';

type UiRequest = any;

@Component({
  selector: 'app-request-makeup-lesson-details',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatButtonModule, MatSnackBarModule, MatProgressSpinnerModule],
  templateUrl: './request-makeup-lesson-details.component.html',
  styleUrls: ['./request-makeup-lesson-details.component.css'],
})
export class RequestMakeupLessonDetailsComponent {
  // ===== Inputs שהאב משתמש בהם (גם ב-UI וגם ב-bulk) =====
  @Input({ required: true }) request!: UiRequest;
  @Input() decidedByUid?: string | null;
  @Input() bulkMode = false;
 @Input() onApproved?: (e: { requestId: string; newStatus: 'APPROVED'; message?: string; meta?: any }) => void;
@Input() onRejected?: (e: { requestId: string; newStatus: | 'REJECTED' | 'REJECTED_BY_SYSTEM'; message?: string; meta?: any }) => void;
  @Input() onError?: (e: any) => void;

  // ===== Outputs שהאב מאזין אליהם ב-onDetailsActivate =====
  @Output() approved = new EventEmitter<{ requestId: string; newStatus: 'APPROVED' }>();
  @Output() rejected = new EventEmitter<{ requestId: string; newStatus: 'REJECTED' | 'REJECTED_BY_SYSTEM' }>();
  @Output() error = new EventEmitter<string>();
  ngOnInit() {
  this.loadingMakeupTarget.set(true);
  void this.loadMakeupTarget();
}
bulkWarning: string | null = null;

timeRange = computed(() => {
  const start = this.normalizeTime(this.payload()?.requested_start_time ?? null);
  const end = this.normalizeTime(this.payload()?.requested_end_time ?? null);
  if (!start || start === '—') return '—';
  if (!end || end === '—') return start;
  return `${start}-${end}`;
});

  constructor(private snack: MatSnackBar , private tenantSvc: SupabaseTenantService
) {}

  busy = signal(false);
  action = signal<'approve' | 'reject' | null>(null); 
  errorMsg = signal<string | null>(null);
  loadingMakeupTarget = signal(false);  


busyText = computed(() => {
  switch (this.action()) {
    case 'approve': return 'הבקשה בתהליך אישור…';
    case 'reject':  return 'הבקשה בתהליך דחייה…';
    default:        return 'מעבד…';
  }
});

private validator = inject(RequestValidationService);

  // signal כדי לעבוד יפה עם ngModel
  note = signal<string>(''); // לא חובה


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

  requestId = computed(() => this.request?.id ?? '—');
  fromDate = computed(() => this.request?.fromDate ?? this.request?.from_date ?? null);
  toDate = computed(() => this.request?.toDate ?? this.request?.to_date ?? null);

  childId = computed(() => this.request?.childId ?? this.request?.child_id ?? '—');
  instructorId = computed(() => this.request?.instructorId ?? this.request?.instructor_id ?? '—');

  // חשוב: האב שלך שומר lessonOccId במודל UiRequest (אחרי שתתקני במיפוי)
  lessonOccId = computed(() => this.request?.lessonOccId ?? this.request?.lesson_occ_id ?? null);

  requestedStartTime = computed(() => this.normalizeTime(this.payload()?.requested_start_time ?? '—'));
  requestedEndTime = computed(() => this.normalizeTime(this.payload()?.requested_end_time ?? '—'));

  clearMessages() {
    this.errorMsg.set(null);
    this.bulkWarning = null;

  }
makeupTarget = signal<null | {
  occur_date: string;
  start_time: string;
  end_time: string;
  instructor_name: string | null;
}>(null);

private fmtName(first?: string | null, last?: string | null): string | null {
  const f = (first ?? '').trim();
  const l = (last ?? '').trim();
  const full = `${f} ${l}`.trim();
  return full || null;
}
private async rejectBySystem(reason: string): Promise<void> {
  await ensureTenantContextReady();
  const db = await dbTenant();

  await db
    .from(SECRETARIAL_REQUESTS_TABLE)
    .update({
      status: 'REJECTED_BY_SYSTEM',
      decided_by_uid: this.decidedByUid ?? getAuth().currentUser?.uid ?? null,
      decision_note: reason?.trim() || 'נדחה אוטומטית: בקשה לא רלוונטית',
      decided_at: new Date().toISOString(),
    })
    .eq('id', this.requestId())
    .eq('status', 'PENDING');

  // UI callbacks
  const evt = { requestId: this.requestId(), newStatus: 'REJECTED_BY_SYSTEM' as const };
  this.rejected.emit(evt);
  this.onRejected?.(evt);

  // הודעה (errors מותר גם בבאלק)
  this.fail(reason);
}

async loadMakeupTarget(): Promise<void> {
  const lessonId = this.lessonOccId();    // lesson_occ_id מהבקשה (uuid)
  const dateStr  = this.fromDate();       // התאריך של השיעור המבוקש (לא בהכרח המקורי)

  // התחלת טעינה
  this.loadingMakeupTarget.set(true);

  if (!lessonId) {
    this.makeupTarget.set(null);
    this.loadingMakeupTarget.set(false);
    return;
  }

  try {
    await ensureTenantContextReady();
    const db = await dbTenant();

    // 0) למצוא את תאריך השיעור המקורי (שהוגשה עליו בקשת השלמה)
    const { data: ex, error: exErr } = await db
      .from(EXCEPTIONS_TABLE)
      .select('occur_date, lesson_id, status')
      .eq('lesson_id', lessonId)
      .in('status', ['נשלחה בקשה להשלמה', 'נשלחה בקשה למילוי מקום'])
      .order('occur_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (exErr) throw exErr;

    if (!ex?.occur_date) {
      this.makeupTarget.set(null);
      return;
    }

    const originalDate = String(ex.occur_date);

    // 1) להביא occurrence מה-view לפי lesson_id + occur_date של המקור
    const { data: occ, error: occErr } = await db
      .from('lessons_occurrences')
      .select('lesson_id, occur_date, start_time, end_time, instructor_id')
      .eq('lesson_id', lessonId)
      .eq('occur_date', originalDate)
      .maybeSingle();

    if (occErr) throw occErr;

    if (!occ) {
      this.makeupTarget.set(null);
      return;
    }

    // 2) שם מדריך
    let instructorName: string | null = null;
    const instIdNumber = (occ as any).instructor_id as string | null;

    if (instIdNumber) {
      const { data: inst } = await db
        .from('instructors')
        .select('first_name, last_name')
        .eq('id_number', instIdNumber)
        .maybeSingle();

      if (inst) {
        instructorName = this.fmtName((inst as any).first_name, (inst as any).last_name);
      }
    }

    this.makeupTarget.set({
      occur_date: String((occ as any).occur_date ?? ''),
      start_time: String((occ as any).start_time ?? ''),
      end_time: String((occ as any).end_time ?? ''),
      instructor_name: instructorName,
    });
  } catch {
    this.makeupTarget.set(null);
  } finally {
    // סיום טעינה בכל מצב
    this.loadingMakeupTarget.set(false);
  }
}


  private fail(msg: string, raw?: any) {
    this.errorMsg.set(msg);
    this.error.emit(msg);
    this.onError?.({ requestId: this.requestId(), message: msg, raw });

    // במצב bulk את ביקשת לא להקפיץ הצלחות, אבל errors כן מותר
    this.snack.open(msg, 'סגור', {
      duration: 3500,
      panelClass: ['snack-reject'],
      direction: 'rtl',
      horizontalPosition: 'center',
      verticalPosition: 'top',
    });
  }

  private okSnack(msg: string) {
    if (this.bulkMode) return; // ✅ לא להראות הצלחות בבאלק
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

  // ===== APPROVE =====
//   async approve(): Promise<void> {
//     this.clearMessages();

//     const lessonOccId = this.lessonOccId();
//     const fromDate = this.fromDate();
//     const toDate = this.toDate();

//     if (!lessonOccId || !fromDate || !toDate) {
//       this.fail('חסרים נתונים בבקשה (lesson_occ_id / from_date / to_date).');
//       return;
//     }
//     if (String(fromDate) !== String(toDate)) {
//       this.fail('שגיאה: from_date ו־to_date אינם זהים (בבקשת השלמה הם אמורים להיות אותו תאריך).');
//       return;
//     }

//     this.busy.set(true);
//     try {
//       await ensureTenantContextReady();
//       const db = await dbTenant();
// const originalDate = await this.getOriginalOccurDate(db, lessonOccId);
// if (!originalDate) {
//   this.fail('לא נמצא שיעור מקור להשלמה (lesson_occurrence_exceptions).');
//   return;
// }

// // 1) update lesson_occurrence_exceptions על השיעור המקורי
// const { error: exErr } = await db
//   .from(EXCEPTIONS_TABLE)
//   .update({ status: 'אושר', is_makeup_allowed: false })
//   .eq('lesson_id', lessonOccId)
//   .eq('occur_date', originalDate);

// if (exErr) throw exErr;

//       // 2) update secretarial_requests -> APPROVED (כמו הסטנדרט אצלך)
//       const { error: reqErr } = await db
//         .from(SECRETARIAL_REQUESTS_TABLE)
//         .update({
//           status: 'APPROVED',
//           decided_by_uid: this.decidedByUid ?? null,
//           decision_note: this.note().trim() || null,
//           decided_at: new Date().toISOString(),
//         })
//         .eq('id', this.requestId())
//         .eq('status', 'PENDING');

//       if (reqErr) throw reqErr;

//       this.okSnack('הבקשה אושרה בהצלחה ');

//       const evt = { requestId: this.requestId(), newStatus: 'APPROVED' as const };
//       this.approved.emit(evt);
//       this.onApproved?.(evt);
//     } catch (e: any) {
//       this.fail(e?.message ?? 'שגיאה באישור הבקשה', e);
//     } finally {
//       this.busy.set(false);
//     }
//   }
async approve(): Promise<void> {
    if (this.busy()) return;
  this.clearMessages();
  this.action.set('approve');  
  this.busy.set(true);
  const r = this.request;
  if (!r?.id) return;

  try {
      // ✅ ולידציה דרך השירות לפני אישור
    const v = await this.validator.validate(r, 'approve');
    if (!v.ok) {
      await this.rejectBySystem(v.reason ?? 'הבקשה אינה רלוונטית');
      return; // חשוב
    }

    // ✅ tenant schema/id כמו במחיקת ילד
    await this.tenantSvc.ensureTenantContextReady();
    const tenant = this.tenantSvc.requireTenant();
    const tenantSchema = tenant.schema;
    const tenantId = tenant.id;

    const url =
      'https://us-central1-bereshit-ac5d8.cloudfunctions.net/approveMakeupLessonAndNotify';

    const user = getAuth().currentUser;
    if (!user) throw new Error('המשתמש לא מחובר');
    const token = await user.getIdToken();

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
      }),
    });

    const raw = await resp.text();
    let json: any = null;
    try { json = JSON.parse(raw); } catch {}

   if (!resp.ok || !json?.ok) {
  throw new Error(json?.message || json?.error || `HTTP ${resp.status}: ${raw?.slice(0, 300)}`);
}

// ✅ הבקשה אושרה גם אם המייל נכשל
const warn = (json?.warning ?? '').toString().trim();
if (warn) {
  this.bulkWarning = warn;
  if (!this.bulkMode) {
    this.snack.open(warn, 'סגור', {
      duration: 3500,
      panelClass: ['snack-warn'], // אם אין לך, תשתמשי snack-reject
      direction: 'rtl',
      horizontalPosition: 'center',
      verticalPosition: 'top',
    });
  }
}


    this.okSnack('הבקשה אושרה בהצלחה  ');
    const evt = { requestId: r.id, newStatus: 'APPROVED' as const };
    this.approved.emit(evt);
    this.onApproved?.(evt);

  } catch (e: any) {
    this.fail(e?.message ?? 'שגיאה באישור הבקשה', e);
  }
  finally{
          this.busy.set(false);
      this.action.set(null);    

  }
}
  // ===== REJECT =====
//   async reject(): Promise<void> {
//     this.clearMessages();

//     const lessonOccId = this.lessonOccId();
//     const fromDate = this.fromDate();
//     const toDate = this.toDate();

//     if (!lessonOccId || !fromDate || !toDate) {
//       this.fail('חסרים נתונים בבקשה (lesson_occ_id / from_date / to_date).');
//       return;
//     }
//     if (String(fromDate) !== String(toDate)) {
//       this.fail('שגיאה: from_date ו־to_date אינם זהים (בבקשת השלמה הם אמורים להיות אותו תאריך).');
//       return;
//     }

//     this.busy.set(true);
//     try {
//       await ensureTenantContextReady();
//       const db = await dbTenant();

//       // 1) reject request
//       const { error: reqErr } = await db
//         .from(SECRETARIAL_REQUESTS_TABLE)
//         .update({
//           status: 'REJECTED',
//           decided_by_uid: this.decidedByUid ?? null,
//           decision_note: this.note().trim() || null,
//           decided_at: new Date().toISOString(),
//         })
//         .eq('id', this.requestId())
//         .eq('status', 'PENDING');

//       if (reqErr) throw reqErr;
// const originalDate = await this.getOriginalOccurDate(db, lessonOccId);
// if (!originalDate) {
//   this.fail('לא נמצא שיעור מקור להשלמה (lesson_occurrence_exceptions).');
//   return;
// }

// // 2) גם exceptions -> "בוטל" על השיעור המקורי
// const { error: exErr } = await db
//   .from(EXCEPTIONS_TABLE)
//   .update({ status: 'בוטל', is_makeup_allowed: true })
//   .eq('lesson_id', lessonOccId)
//   .eq('occur_date', originalDate);

// if (exErr) throw exErr;

//       this.okSnack('הבקשה נדחתה בהצלחה');

//       const evt = { requestId: this.requestId(), newStatus: 'REJECTED' as const };
//       this.rejected.emit(evt);
//       this.onRejected?.(evt);
//     } catch (e: any) {
//       this.fail(e?.message ?? 'שגיאה בדחיית הבקשה', e);
//     } finally {
//       this.busy.set(false);
//     }
//   }
async reject(args?: { source?: 'user' | 'system'; reason?: string }): Promise<void> {
    if (this.busy()) return;
  this.clearMessages();
  this.action.set('reject');
  this.busy.set(true);

  const r = this.request;
  if (!r?.id) return;

  try {
     // ✅ ולידציה דרך השירות לפני דחייה
    // אם הבקשה כבר לא רלוונטית — לא “דחייה רגילה”, אלא REJECTED_BY_SYSTEM
const v = await this.validator.validate(r, 'reject');
    if (!v.ok) {
      await this.rejectBySystem(v.reason ?? 'הבקשה אינה רלוונטית');
      return;
    }

    await this.tenantSvc.ensureTenantContextReady();
    const tenant = this.tenantSvc.requireTenant();
    const tenantSchema = tenant.schema;
    const tenantId = tenant.id;

    const user = getAuth().currentUser;
    if (!user) throw new Error('המשתמש לא מחובר');
    const token = await user.getIdToken();

    const rejectUrl = 'https://us-central1-bereshit-ac5d8.cloudfunctions.net/rejectMakeupLessonAndNotify';

    const decisionNote =
      (args?.reason ?? this.note()).trim() || null;

    const resp = await fetch(rejectUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        tenantSchema,
        tenantId,
        requestId: this.requestId(),
        decisionNote,
      }),
    });

    const raw = await resp.text();
    let json: any = null;
    try { json = JSON.parse(raw); } catch {}
   if (!resp.ok || !json?.ok) {
  throw new Error(json?.message || json?.error || `HTTP ${resp.status}: ${raw?.slice(0, 300)}`);
}

// ✅ הבקשה אושרה גם אם המייל נכשל
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



    this.okSnack('הבקשה נדחתה בהצלחה');
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

  private async getOriginalOccurDate(db: any, lessonId: string): Promise<string | null> {
  // אם כבר נטען במסך
  const cached = this.makeupTarget()?.occur_date;
  if (cached) return String(cached);

  const { data: ex, error } = await db
    .from(EXCEPTIONS_TABLE)
    .select('occur_date')
    .eq('lesson_id', lessonId)
    .eq('status', 'נשלחה בקשה להשלמה')
    .order('occur_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return ex?.occur_date ? String(ex.occur_date) : null;
}

}
