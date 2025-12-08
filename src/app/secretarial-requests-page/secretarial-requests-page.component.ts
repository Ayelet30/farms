import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSidenavModule } from '@angular/material/sidenav';

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
  private cu = inject(CurrentUserService);
  curentUser = this.cu.current;  // CurrentUser | null

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

  // פילטרים
  statusFilter = signal<RequestStatus | 'ALL'>('PENDING');
  dateFrom: string | null = null;
  dateTo: string | null = null;
  searchTerm = '';
  typeFilter: 'ALL' | 'CANCEL_OCCURRENCE' | 'INSTRUCTOR_DAY_OFF' | 'NEW_SERIES' =
    'ALL';

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
      if (from || to) {
        const created = new Date(r.createdAt);
        if (from && created < from) return false;

        if (to) {
          const toEnd = new Date(to);
          toEnd.setHours(23, 59, 59, 999);
          if (created > toEnd) return false;
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
        .from('secretarial_requests')
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

  private mapRowToUi(row: SecretarialRequestDbRow): UiRequest {
    const p = row.payload || {};

    const requestedByName =
      p.requested_by_name || p.parent_name || p.user_name || '—';
    const childName = p.child_name || null;
    const instructorName = p.instructor_name || null;

    return {
      id: row.id,
      requestType: row.request_type,
      status: row.status,

      summary: this.buildSummary(row, p),
      requestedByName,
      childName: childName || undefined,
      instructorName: instructorName || undefined,

      fromDate: row.from_date,
      toDate: row.to_date,
      createdAt: row.created_at,

      requesterUid: row.requested_by_uid,   // ← משיכה מהטבלה

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
    console.log('hasApproveRpc check for type:', type, 'result:', !!APPROVE_RPC_BY_TYPE[type]); 
  return !!APPROVE_RPC_BY_TYPE[type];
}


  // ===== פעולות לפי רול =====

  // אישור בקשה – רק מזכירה
 async approveSelected() {
  if (!this.isSecretary) return;

  const current = this.selectedRequest;
  if (!current) return;

  const rpcName = APPROVE_RPC_BY_TYPE[current.requestType];
  if (!rpcName) return;   // ← כאן ההגנה המוחלטת

  const db = dbTenant();
  const { error } = await db.rpc(rpcName, {
    p_request_id: current.id,
    p_decided_by_uid: this.curentUser!.uid,
    p_decision_note: null,
  });

  if (error) {
    console.error(error);
    alert('שגיאה באישור הבקשה');
    return;
  }

  await this.loadRequestsFromDb();
  this.selectedRequest = null;
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
}
