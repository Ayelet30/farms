import { CommonModule } from '@angular/common';
import {
  Component,
  EventEmitter,
  Input,
  Output,
  computed,
  signal,
  effect,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

import { ensureTenantContextReady, dbTenant } from '../../services/supabaseClient.service';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { ConfirmDialogComponent } from '../confirm-dialog.component';
import { SupabaseTenantService } from '../../services/supabase-tenant.service'; // התאימי נתיב אם צריך
import { getAuth } from 'firebase/auth';

type UiRequest = any;

type OccRow = {
  lesson_id: string;
  occur_date: string;     // YYYY-MM-DD
  day_of_week: string;
  start_time: string;     // HH:MM:SS
  end_time: string;       // HH:MM:SS
  lesson_type: string | null;
  status: string;
  instructor_id: string;
};

type InstructorMeta = {
  id_number: string;
  first_name: string | null;
  last_name: string | null;
};

type RemainingLessonVM = {
  instructorName: string;
  dayOfWeek: string;
  timeRange: string;
  lessonType: string;
  occurDate: string | null;
  status: string;
};

@Component({
  selector: 'app-request-remove-child-details',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule],
  templateUrl: './request-remove-child-details.component.html',
  styleUrls: ['./request-remove-child-details.component.css'],
})
export class RequestRemoveChildDetailsComponent {

  // ✅ signal פנימי שמחזיק את הבקשה
  private _req = signal<UiRequest | null>(null);

  // ✅ זה ה-Input היחיד (אין שדה בשם request בכלל)
  @Input({ required: true })
  set request(value: UiRequest) {
    this._req.set(value);
  }

  // ✅ זה מה שמשתמשים בו בקוד ובתבנית: req()
  readonly req = this._req;

  @Input() decidedByUid?: string;

  // callbacks אם צריך
  @Input() onApproved?: (e: any) => void;
  @Input() onRejected?: (e: any) => void;
  @Input() onError?: (e: any) => void;
scheduledDeletionAt = signal<string | null>(null);

  // outputs
  @Output() approved = new EventEmitter<{ requestId: string; newStatus: 'APPROVED' }>();
  @Output() rejected = new EventEmitter<{ requestId: string; newStatus: 'REJECTED' }>();
  @Output() error = new EventEmitter<string>();

  // ✅ payload מטופס כ-any כדי לא לקבל "{}"
  payload = computed<any>(() => this.req()?.payload ?? {});

  childFullName = computed(() => {
    const r = this.req();
    const p = this.payload();

    const first = (p.first_name ?? p.firstName ?? '').toString().trim();
    const last  = (p.last_name  ?? p.lastName  ?? '').toString().trim();
    const full = `${first} ${last}`.trim();

    return full || r?.childName || '—';
  });

  reason = computed(() => {
    const r = this.req();
    const p = this.payload();

    return (
      p.reason ??
      p.delete_reason ??
      p.summary ??
      r?.summary ??
      ''
    ).toString().trim();
  });

  // ===== שיעורים שנותרו =====
  loadingRemaining = signal(false);
  remainingError = signal<string | null>(null);
  remainingLessons = signal<RemainingLessonVM[]>([]);

  // כדי למנוע “תשובה ישנה” שנכנסת אחרי החלפה מהירה של בקשה
  private runToken = 0;

  constructor(private dialog: MatDialog,private tenantSvc: SupabaseTenantService
) {
    
    effect(() => {
      const id = this.req()?.id;
      if (!id) return;
      void this.loadRemainingLessons();
    });
  }

  private getChildId(): string | null {
    const r = this.req();
    const p = this.payload();
    return r?.childId ?? p.child_id ?? null;
  }

  private todayIso(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private fmtTime(t: string | null | undefined): string {
    return t ? t.slice(0, 5) : '—';
  }

  private fullName(first: string | null | undefined, last: string | null | undefined): string {
    return `${(first ?? '').trim()} ${(last ?? '').trim()}`.trim() || '—';
  }

 async loadRemainingLessons() {
  const token = ++this.runToken;

  const childId = this.getChildId();
  if (!childId) {
    this.remainingError.set('חסר childId בבקשה ולכן אי אפשר להביא שיעורים.');
    this.remainingLessons.set([]);
    return;
  }

  this.loadingRemaining.set(true);
  this.remainingError.set(null);

  try {
    await ensureTenantContextReady();
    const db = dbTenant();

    // ✅ אם כבר יש תאריך מחיקה מתוזמן (Deletion Scheduled),
    //    נציג "שיעורים שנותרו" רק עד לפני התאריך הזה.
    //    (occur_date הוא date, אז נשווה מול YYYY-MM-DD)
    const untilIso =
      (this.scheduledDeletionAt?.() ?? null)  // אם יש לך signal scheduledDeletionAt
        ? (this.scheduledDeletionAt() as string).slice(0, 10)
        : null;

    let q = db
      .from('lessons_occurrences')
      .select(
        'lesson_id, occur_date, day_of_week, start_time, end_time, lesson_type, status, instructor_id'
      )
      .eq('child_id', childId)
      .gte('occur_date', this.todayIso())
      .in('status', ['ממתין לאישור', 'אושר'])
      .order('occur_date', { ascending: true })
      .order('start_time', { ascending: true });

    // ✅ חשוב: להראות רק שיעורים לפני תאריך המחיקה בפועל
    if (untilIso) {
      q = q.lt('occur_date', untilIso);
    }

    const { data: occData, error: occErr } = await q;
    if (occErr) throw occErr;
    if (token !== this.runToken) return;

    const occ = (occData ?? []) as OccRow[];
    if (!occ.length) {
      this.remainingLessons.set([]);
      return;
    }

    const instructorIds = Array.from(
      new Set(occ.map((o) => o.instructor_id).filter(Boolean))
    );

    const { data: instData, error: instErr } = await db
      .from('instructors')
      .select('id_number, first_name, last_name')
      .in('id_number', instructorIds);

    if (instErr) throw instErr;
    if (token !== this.runToken) return;

    const instMap = new Map<string, InstructorMeta>();
    (instData ?? []).forEach((i: any) => {
      instMap.set(i.id_number, {
        id_number: i.id_number,
        first_name: i.first_name ?? null,
        last_name: i.last_name ?? null,
      });
    });

    const vm: RemainingLessonVM[] = occ.map((o) => {
      const ins = instMap.get(o.instructor_id);
      return {
        instructorName: this.fullName(ins?.first_name, ins?.last_name),
        dayOfWeek: o.day_of_week || '—',
        timeRange: `${this.fmtTime(o.start_time)}–${this.fmtTime(o.end_time)}`,
        lessonType: o.lesson_type ?? '—',
        occurDate: o.occur_date,
        status: o.status,
      };
    });

    if (token !== this.runToken) return;
    this.remainingLessons.set(vm);
  } catch (err: any) {
    if (token !== this.runToken) return;
    console.error('loadRemainingLessons failed', err);
    this.remainingError.set(err?.message ?? 'שגיאה בשליפת שיעורים שנותרו');
    this.remainingLessons.set([]);
  } finally {
    if (token !== this.runToken) return;
    this.loadingRemaining.set(false);
  }
}
async approve() {
  const r = this.req();
  if (!r) return;

  const childId = this.getChildId();
  if (!childId) {
    this.error.emit('חסר childId בבקשה');
    return;
  }

  const ok = await this.confirmApprove();
  if (!ok) return;

  try {
    // tenant schema כמו בחשבוניות
    // const tenantSchema = await this.getTenantSchemaOrThrow();
    await this.tenantSvc.ensureTenantContextReady();
const tenant = this.tenantSvc.requireTenant();
const tenantSchema = tenant.schema;
const tenantId = tenant.id; // או השם האמיתי אצלך


    const approveUrl =
      'https://us-central1-bereshit-ac5d8.cloudfunctions.net/approveRemoveChildAndNotify';

    // ✅ Firebase Bearer token (כי ה-CF דורשת requireAuth אם אין internal secret)
    const user = getAuth().currentUser;
    if (!user) throw new Error('המשתמש לא מחובר');
    const token = await user.getIdToken();


    const resp = await fetch(approveUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
  tenantSchema,
  tenantId,
  childId,
  requestId: r.id,
}),

    });

    const raw = await resp.text();
    let json: any = null;
    try { json = JSON.parse(raw); } catch {}

    if (!resp.ok || !json?.ok) {
      throw new Error(json?.message || json?.error || `HTTP ${resp.status}: ${raw?.slice(0, 300)}`);
    }

    // תאריך המחיקה שחזר מהשרת
    this.scheduledDeletionAt.set(json.scheduledDeletionAt ?? null);

    // עדכון UI
    const e = { requestId: r.id, newStatus: 'APPROVED' as const };
    this.approved.emit(e);
    this.onApproved?.(e);

    await this.loadRemainingLessons();

  } catch (err: any) {
    const msg = err?.message ?? 'שגיאה באישור המחיקה';
    this.error.emit(msg);
    this.onError?.(msg);
  }
}

async reject() {
  const r = this.req();
  if (!r) return;

  const childId = this.getChildId();
  if (!childId) {
    this.error.emit('חסר childId בבקשה');
    return;
  }

  const ok = await this.confirmReject();
  if (!ok) return;

  try {
    await ensureTenantContextReady();
    const db = dbTenant();

    // 1) עדכון סטטוס הבקשה ל-REJECTED
    const { error: reqErr } = await db
      .from('secretarial_requests')
      .update({
        status: 'REJECTED',
        decided_at: new Date().toISOString(),
        // decided_by_uid: ... אם יש לך
      })
      .eq('id', r.id);

    if (reqErr) throw reqErr;

    // 2) החזרת סטטוס הילד ל-Active + ניקוי שדות המחיקה
    const { error: childErr } = await db
      .from('children')
      .update({
        status: 'Active',                 // ⚠️ להתאים לערך האמיתי ב-enum שלך
        deletion_requested_at: null,
        scheduled_deletion_at: null,
      })
      .eq('child_uuid', childId);

    if (childErr) throw childErr;

    const e = { requestId: r.id, newStatus: 'REJECTED' as const };
    this.rejected.emit(e);
    this.onRejected?.(e);

    // אופציונלי: לרענן תצוגה / שיעורים
    await this.loadRemainingLessons?.();

  } catch (err: any) {
    const msg = err?.message ?? 'שגיאה בדחיית הבקשה';
    this.error.emit(msg);
    this.onError?.(msg);
  }
}

  private async confirmApprove(): Promise<boolean> {
  const ref = this.dialog.open(ConfirmDialogComponent, {
    data: {
      title: 'אישור מחיקה',
      message: 'האם את בטוחה שברצונך לאשר את בקשת המחיקה?',
    },
    disableClose: true,
    panelClass: 'ui-confirm-dialog',
    backdropClass: 'ui-confirm-backdrop',
  });

  return (await firstValueFrom(ref.afterClosed())) === true;
}
private async confirmReject(): Promise<boolean> {
  const ref = this.dialog.open(ConfirmDialogComponent, {
    data: {
      title: 'דחיית בקשה',
      message: 'האם את בטוחה שברצונך לדחות את בקשת המחיקה?\nהסטטוס של הילד יחזור ל-פעיל.',
    },
    disableClose: true,
    panelClass: 'ui-confirm-dialog',
    backdropClass: 'ui-confirm-backdrop',
  });

  return (await firstValueFrom(ref.afterClosed())) === true;
}
private async getTenantSchemaOrThrow(): Promise<string> {
  await this.tenantSvc.ensureTenantContextReady();
  return this.tenantSvc.requireTenant().schema;
}
}

function escapeHtml(s: any) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function fmtTime(t: string | null | undefined) {
  return t ? String(t).slice(0, 5) : '—';
}

function renderTable(list: Array<any>) {
  if (!list?.length) return '';

  const body = list.map((r: any) => `
    <tr>
      <td>${escapeHtml(r.occur_date)}</td>
      <td>${escapeHtml(r.day_of_week || '—')}</td>
      <td>${escapeHtml(`${fmtTime(r.start_time)}–${fmtTime(r.end_time)}`)}</td>
      <td>${escapeHtml(r.lesson_type ?? '—')}</td>
      <td>${escapeHtml(r.instructor_name ?? '—')}</td>
    </tr>
  `).join('');

  return `
    <table border="1" cellpadding="6" cellspacing="0"
           style="border-collapse:collapse;width:100%;font-size:14px">
      <thead>
        <tr><th>תאריך</th><th>יום</th><th>שעה</th><th>סוג</th><th>מדריך/ה</th></tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `.trim();
}