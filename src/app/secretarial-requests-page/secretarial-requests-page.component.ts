import { Component, OnInit, signal, inject, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSidenavModule } from '@angular/material/sidenav';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { RequestInstructorDayOffDetailsComponent } from './request-instructor-day-off-details/request-instructor-day-off-details.component';


import {
  ensureTenantContextReady,
  dbTenant,
} from '../services/legacy-compat';

import {
  RequestStatus,
  RequestType,
  SecretarialRequestDbRow,
  UiRequest,
} from '../Types/detailes.model';

import { CurrentUserService } from '../core/auth/current-user.service';

// שם ה־RPC שאמור לרוץ עבור כל סוג בקשה בעת "אישור"
const APPROVE_RPC_BY_TYPE: Partial<Record<RequestType, string>> = {
  CANCEL_OCCURRENCE: 'approve_secretarial_cancel_request',
  ADD_CHILD: 'approve_add_child_request',      // ← הפונקציה שכתבנו לילד חדש
  DELETE_CHILD: 'approve_delete_child_request',// ← כשתכתבי אותה
  MAKEUP_LESSON: 'approve_makeup_lesson_request', // דוגמה
  INSTRUCTOR_DAY_OFF: 'approve_instructor_day_off_request',
  NEW_SERIES: 'approve_new_series_request',
  // ... תמשיכי לפי מה שיש לך ב־DB
};


@Component({
  selector: 'app-secretarial-requests-page',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatButtonModule, MatSidenavModule],
  templateUrl: './secretarial-requests-page.component.html',
  styleUrls: ['./secretarial-requests-page.component.css'],
})
export class SecretarialRequestsPageComponent implements OnInit {

  @Input() onApproved?: (e: any) => void;
  @Input() onRejected?: (e: any) => void;
  @Input() onError?: (e: any) => void;

  private cu = inject(CurrentUserService);
  curentUser = this.cu.current;  // CurrentUser | null

  dateFilterMode: 'CREATED_AT' | 'REQUEST_WINDOW' = 'CREATED_AT';
typeFilter: 'ALL' | RequestType = 'ALL';  // במקום היוניון המצומצם שהיה לך
private sanitizer = inject(DomSanitizer);
REQUEST_DETAILS_COMPONENT: Record<string, any> = {
  INSTRUCTOR_DAY_OFF: RequestInstructorDayOffDetailsComponent,
  // NEW_SERIES: ..., CANCEL_OCCURRENCE: ...
};
noSelection: any;

getDetailsComponent(type: string) {
  return this.REQUEST_DETAILS_COMPONENT[type] || null;
}



  // ===== עזרי רול =====
  /** אם אצלך הרול האמיתי יושב ב-role_in_tenant – תחליפי לכאן */
  private get currentRole(): string | null {
    return (this.curentUser as any)?.role_in_tenant ?? this.curentUser?.role ?? null;
  }

  get isSecretary(): boolean {
    return this.currentRole === 'secretary';
  }

  get isParent(): boolean {
    return this.currentRole === 'parent';
  }

  get isInstructor(): boolean {
    return this.currentRole === 'instructor';
  }

  getPayloadText(r: UiRequest, key: string): string | null {
  const p: any = r.payload || {};
  const v = p?.[key];
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') return v;
  return String(v);
}

getOccurDate(r: UiRequest): string {
  const p: any = r.payload || {};
  const d = p.occur_date || r.fromDate || r.createdAt;
  try {
    return new Date(d).toLocaleDateString('he-IL');
  } catch {
    return String(d ?? '—');
  }
}

getFileUrls(r: UiRequest): string[] {
  const p: any = r.payload || {};
  const urls: string[] = [];

  // 1) keys שמסתיימים ב _url / url
  for (const k of Object.keys(p)) {
    const v = p[k];
    if (typeof v === 'string' && this.looksLikeUrl(v) && (k.toLowerCase().endsWith('url') || k.toLowerCase().endsWith('_url'))) {
      urls.push(v);
    }
  }

  // 2) מערכים נפוצים: attachments / files
  const arrCandidates = [p.attachments, p.files];
  for (const a of arrCandidates) {
    if (Array.isArray(a)) {
      for (const it of a) {
        if (typeof it === 'string' && this.looksLikeUrl(it)) urls.push(it);
        if (it?.url && typeof it.url === 'string') urls.push(it.url);
      }
    }
  }

  // ייחוד
  return Array.from(new Set(urls));
}

looksLikeUrl(v: string): boolean {
  return /^https?:\/\/\S+$/i.test(v);
}

isImageUrl(u: string): boolean {
  return /\.(png|jpe?g|webp|gif)(\?.*)?$/i.test(u);
}

isPdfUrl(u: string): boolean {
  return /\.pdf(\?.*)?$/i.test(u);
}

safeUrl(u: string): SafeResourceUrl {
  return this.sanitizer.bypassSecurityTrustResourceUrl(u);
}


  // פילטרים
  statusFilter = signal<RequestStatus | 'ALL'>('PENDING');
  dateFrom: string | null = null;
  dateTo: string | null = null;
  searchTerm = '';

  // נתונים
  private allRequests = signal<UiRequest[]>([]);
  loading = signal(false);
  loadError = signal<string | null>(null);

  // צד ימין – פרטי בקשה
  detailsOpened = false;
  selectedRequest: UiRequest | null = null;
  indexOfRowSelected: number | null = null;

  // ===== רשימה מסוננת כולל רול =====
  get filteredRequestsList(): UiRequest[] {
    const list = this.allRequests();
    const status = this.statusFilter();
    const term = this.searchTerm.trim().toLowerCase();
    const type = this.typeFilter;
    const from = this.dateFrom ? new Date(this.dateFrom) : null;
    const to = this.dateTo ? new Date(this.dateTo) : null;

    const myUid = this.curentUser?.uid ?? null;

    return list.filter((r) => {
      // --- הורה/מדריך: רואים רק את הבקשות של עצמם ---
      if (!this.isSecretary) {
        if (!myUid) return false;
        if (r.requesterUid !== myUid) return false;
      }

      // --- פילטר סטטוס ---
      if (status !== 'ALL' && r.status !== status) return false;

      // --- פילטר סוג בקשה ---
      if (type !== 'ALL' && r.requestType !== type) return false;

      // --- פילטר תאריכים לפי createdAt ---
     // --- פילטר תאריכים ---
if (from || to) {
  // מה מסננים? createdAt או from/to של הבקשה עצמה
  const startEnd =
    this.dateFilterMode === 'CREATED_AT'
      ? { start: new Date(r.createdAt), end: new Date(r.createdAt) }
      : this.getRequestWindow(r);

  const start = startEnd.start;
  const end = startEnd.end;

  if (from && end < from) return false; // כל הטווח לפני from
  if (to) {
    const toEnd = new Date(to);
    toEnd.setHours(23, 59, 59, 999);
    if (start > toEnd) return false; // כל הטווח אחרי to
  }
}

      // --- חיפוש חופשי ---
      if (term) {
        const haystack = (
          (r.summary ?? '') +
          ' ' +
          (r.requestedByName ?? '') +
          ' ' +
          (r.childName ?? '') +
          ' ' +
          (r.instructorName ?? '')
        ).toLowerCase();

        if (!haystack.includes(term)) return false;
      }

      return true;
    });
  }

  private getRequestWindow(r: UiRequest): { start: Date; end: Date } {
  // 1) אם יש fromDate/toDate בטבלה – זה המלך
  const fd = r.fromDate ? new Date(r.fromDate) : null;
  const td = r.toDate ? new Date(r.toDate) : null;

  if (fd && td) return { start: fd, end: td };
  if (fd && !td) return { start: fd, end: fd };

  // 2) נפילה ל-payload (למשל occur_date בביטול שיעור)
  const p: any = r.payload || {};
  const occur = p.occur_date ? new Date(p.occur_date) : null;

  if (occur) return { start: occur, end: occur };

  // 3) fallback: createdAt
  const c = new Date(r.createdAt);
  return { start: c, end: c };
}


  async ngOnInit() {
    await this.loadRequestsFromDb();
  }

  // --------------------------------------------------
  // טעינה מה־DB
  // --------------------------------------------------
  private async loadRequestsFromDb() {
    this.loading.set(true);
    this.loadError.set(null);

    try {
      await ensureTenantContextReady();
      const db = dbTenant();

      const res = await db
        .from('v_secretarial_requests')
        .select('*')
        .order('created_at', { ascending: false });

      const data = res.data as SecretarialRequestDbRow[] | null;
      const error = res.error;

      if (error) throw error;

      const mapped: UiRequest[] =
        data?.map((row: SecretarialRequestDbRow) => this.mapRowToUi(row)) ?? [];

      this.allRequests.set(mapped);
    } catch (err: any) {
      console.error('Failed to load secretarial_requests', err);
      this.loadError.set('אירעה שגיאה בטעינת הבקשות מהמערכת.');
    } finally {
      this.loading.set(false);
    }
  }

private mapRowToUi(row: any): UiRequest {
  return {
    id: row.id,
    requestType: row.request_type,
    status: row.status,

    summary: this.buildSummary(row, row.payload || {}),
    requestedByName: row.requested_by_name || '—',
    childName: row.child_name || undefined,
    instructorName: row.instructor_name || undefined,

    fromDate: row.from_date,
    toDate: row.to_date,
    createdAt: row.created_at,

    requesterUid: row.requested_by_uid,
    payload: row.payload,
  };
}

  private buildSummary(row: SecretarialRequestDbRow, p: any): string {
    switch (row.request_type) {
      case 'CANCEL_OCCURRENCE':
        return (
          p.summary ||
          `ביטול שיעור לתאריך ${p.occur_date ?? row.from_date ?? ''}`
        );
      case 'INSTRUCTOR_DAY_OFF':
        return (
          p.summary ||
          `יום חופש מדריך ${p.instructor_name ?? ''} בין ${row.from_date ?? ''}–${
            row.to_date ?? ''
          }`
        );
      case 'NEW_SERIES':
        return p.summary || 'בקשה לפתיחת סדרת שיעורים';
      case 'ADD_CHILD':
        return p.summary || 'בקשה להוספת ילד למערכת'; 
      case 'DELETE_CHILD':
        return p.summary || 'בקשה למחיקת ילד מהמערכת';
      case 'MAKEUP_LESSON':
        return p.summary || 'בקשה לשיעור פיצוי';
      default:
        return p.summary || 'כללי';
    }
  }

  // --------------------------------------------------
  // אינטראקציה + סטטוסים
  // --------------------------------------------------
  clearFilters() {
    this.dateFrom = null;
    this.dateTo = null;
    this.searchTerm = '';
    this.typeFilter = 'ALL';
    this.statusFilter.set('PENDING');
  }

  openDetails(row: UiRequest) {
    this.selectedRequest = row;
    this.indexOfRowSelected = this.filteredRequestsList.indexOf(row);
    this.detailsOpened = true;
  }

  closeDetails() {
    this.detailsOpened = false;
    this.indexOfRowSelected = null;
    this.selectedRequest = null;
  }

  getStatusClass(status: RequestStatus): string {
    switch (status) {
      case 'PENDING':
        return 'status-chip pending';
      case 'APPROVED':
        return 'status-chip approved';
      case 'REJECTED':
        return 'status-chip rejected';
      case 'CANCELLED_BY_REQUESTER':
        return 'status-chip cancelled';
      default:
        return 'status-chip';
    }
  }

  getStatusLabel(status: RequestStatus): string {
    switch (status) {
      case 'PENDING':
        return 'ממתין';
      case 'APPROVED':
        return 'מאושר';
      case 'REJECTED':
        return 'נדחה';
      case 'CANCELLED_BY_REQUESTER':
        return 'בוטל ע״י המבקש/ת';
      default:
        return status;
    }
  }

  getRequestTypeLabel(type: RequestType): string {
    switch (type) {
      case 'CANCEL_OCCURRENCE':
        return 'ביטול שיעור';
      case 'INSTRUCTOR_DAY_OFF':
        return 'יום חופש מדריך';
      case 'NEW_SERIES':
        return 'סדרת שיעורים';
      default:
        return type;
    }
  }

  getRequestTypeIcon(type: RequestType): string {
    switch (type) {
      case 'CANCEL_OCCURRENCE':
        return 'event_busy';
      case 'INSTRUCTOR_DAY_OFF':
        return 'beach_access';
      case 'NEW_SERIES':
        return 'repeat';
      default:
        return 'help';
    }
  }

hasApproveRpc(type: RequestType): boolean {
  console.log('hasApproveRpc', type, APPROVE_RPC_BY_TYPE[type]);

  if (type === 'PARENT_SIGNUP') {
    return true;
  }

  if (APPROVE_RPC_BY_TYPE[type]) {
    return true;
  }

  return false;
}

private getTenantId(): string | null {
  return localStorage.getItem('selectedTenant');
}

private getSchema(): string {
  // tokensKey אצלך הוא שם schema בפועל (bereshit_farm וכו')
  return localStorage.getItem('tokensKey') || 'bereshit_farm';
}


async approveSelected() {
  if (!this.isSecretary) return;

  const current = this.selectedRequest;
  if (!current) return;

  // --- PARENT_SIGNUP: פונקציית ענן ---
  if (current.requestType === 'PARENT_SIGNUP') {
    try {
      const idToken = await this.cu.getIdToken(true); // true=ריענון – עוזר אם יש טוקן ישן
      const schema = this.getSchema();
      const tenant_id = this.getTenantId();

      if (!tenant_id) {
        alert('חסר tenant_id (selectedTenant). תעשי ריענון/בחירת חווה מחדש.');
        return;
      }

      const resp = await fetch('/api/approveParentSignupRequest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          schema,
          requestId: current.id,
          tenant_id,
        }),
      });

      // אל תיפלי על JSON כשזו שגיאה:
      const ct = resp.headers.get('content-type') || '';
      const out: any = ct.includes('application/json')
        ? await resp.json()
        : await resp.text();

      if (!resp.ok) {
        const msg =
          typeof out === 'string'
            ? out
            : (out?.message || out?.error || `approve failed (${resp.status})`);
        throw new Error(msg);
      }

      await this.loadRequestsFromDb();
      this.selectedRequest = null;
      return;
    } catch (e: any) {
      console.error('approve PARENT_SIGNUP failed', e);
      alert(e?.message || 'שגיאה באישור בקשת הרשמה');
      return;
    }
  }

  console.log({ schema: this.getSchema(), tenant_id: this.getTenantId(), uid: this.cu.current?.uid });


  // --- שאר הסוגים: RPC בסופאבייס ---
  const rpcName = APPROVE_RPC_BY_TYPE[current.requestType];
  if (!rpcName) return;

  try {
    const db = dbTenant();
    const { error } = await db.rpc(rpcName, {
      p_request_id: current.id,
      p_decided_by_uid: this.curentUser!.uid,
      p_decision_note: null,
    });

    if (error) throw error;

    await this.loadRequestsFromDb();
    this.selectedRequest = null;
  } catch (err: any) {
    console.error(err);
    alert('שגיאה באישור הבקשה');
  }
}

  // דחייה – רק מזכירה
  async rejectSelected() {
    if (!this.isSecretary) return;

    const current = this.selectedRequest;
    if (!current) return;

    const db = dbTenant();
    const { error } = await db.rpc('reject_secretarial_request', {
      p_request_id: current.id,
      p_decided_by_uid: this.curentUser!.uid,
      p_decision_note: null,
    });

    if (error) {
      console.error(error);
      return;
    }

    await this.loadRequestsFromDb();
  }

  // ביטול ע"י המבקש – הורה / מדריך
  async cancelSelected() {
    const current = this.selectedRequest;
    if (!current || !this.curentUser) return;
    if (this.isSecretary) return;                 // מזכירה לא מבטלת ככה
    if (current.status !== 'PENDING') return;     // מבטלים רק ממתינים

    const db = dbTenant();

    // אפשר גם RPC ייעודי – כרגע UPDATE ישיר
    const { error } = await db
      .from('secretarial_requests')
      .update({ status: 'CANCELLED_BY_REQUESTER' })
      .eq('id', current.id)
      .eq('requested_by_uid', this.curentUser.uid);  // הגנה צד-קליינט

    if (error) {
      console.error(error);
      return;
    }

    await this.loadRequestsFromDb();
    this.selectedRequest = null;
  }

  reloadRequests() {
    this.loadRequestsFromDb();
  }

  private patchRequestStatus(requestId: string, newStatus: RequestStatus) {
  const arr = this.allRequests();
  const idx = arr.findIndex(x => x.id === requestId);
  if (idx === -1) return;

  const updated = [...arr];
  updated[idx] = { ...updated[idx], status: newStatus };
  this.allRequests.set(updated);

  // אם כרגע את בטאב "ממתינים" – הבקשה תיעלם מיד
  if (this.statusFilter() === 'PENDING') {
    this.selectedRequest = null;
    this.detailsOpened = false;
    this.indexOfRowSelected = null;
  }
}

onChildApproved(e: { requestId: string; newStatus: 'APPROVED' }) {
  this.patchRequestStatus(e.requestId, 'APPROVED'); // מסיר מ"ממתינים" מיד
}

onChildRejected(e: { requestId: string; newStatus: 'REJECTED' }) {
  this.patchRequestStatus(e.requestId, 'REJECTED');
}

 onChildError(msg: string) {
//   this.toast(msg, 'error');
}


}
