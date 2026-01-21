import {
  Component,
  OnInit,
  signal,
  inject,
  Input,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSidenavModule } from '@angular/material/sidenav';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Subscription } from 'rxjs';
import { BreakpointObserver } from '@angular/cdk/layout';
import { ViewChild } from '@angular/core';
import { MatSidenav } from '@angular/material/sidenav';


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

// קומפוננטות פרטים (נטענות לפי סוג)
import { RequestInstructorDayOffDetailsComponent } from './request-instructor-day-off-details/request-instructor-day-off-details.component';
import { RequestCancelOccurrenceDetailsComponent } from './request-cancel-occurrence-details/request-cancel-occurrence-details.component';
import { RequestAddChildDetailsComponent } from './request-add-child-details/request-add-child-details.component';
import { SecretarialSeriesRequestsComponent } from './request-new-series-details/request-new-series-details.component';
import { request } from 'http';
import { RequestAddParentDetailsComponent } from './request-add-parent-details/request-add-parent-details.component';

// שם ה־RPC שאמור לרוץ עבור כל סוג בקשה בעת "אישור"
const APPROVE_RPC_BY_TYPE: Partial<Record<RequestType, string>> = {
  CANCEL_OCCURRENCE: 'approve_secretarial_cancel_request',
  ADD_CHILD: 'approve_add_child_request',
  DELETE_CHILD: 'approve_delete_child_request',
  MAKEUP_LESSON: 'approve_makeup_lesson_request',
  INSTRUCTOR_DAY_OFF: 'approve_instructor_day_off_request',
  NEW_SERIES: 'approve_new_series_request',
  PARENT_SIGNUP: 'approve_parent_signup_request',
};

type ToastKind = 'success' | 'error' | 'info';


@Component({
  selector: 'app-secretarial-requests-page',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatButtonModule, MatSidenavModule],
  templateUrl: './secretarial-requests-page.component.html',
  styleUrls: ['./secretarial-requests-page.component.css'],
})
export class SecretarialRequestsPageComponent implements OnInit {
  // אם את רוצה שמי שמחזיק את הקומפוננטה יקבל callbacks גם כן
  @Input() onApproved?: (e: any) => void;
  @Input() onRejected?: (e: any) => void;
  @Input() onError?: (e: any) => void;

  private cu = inject(CurrentUserService);
  private sanitizer = inject(DomSanitizer);
  private detailsSubs: Subscription[] = [];
  private bo = inject(BreakpointObserver);

  isMobile = signal(false);

  @ViewChild('detailsDrawer') detailsDrawer?: MatSidenav;

  onChildApprovedBound = (e: any) => this.onChildApproved(e);
onChildRejectedBound = (e: any) => this.onChildRejected(e);
onChildErrorBound    = (e: any) => this.onChildError(e?.message ?? String(e));


  curentUser = this.cu.current;  // CurrentUser | null

  // ===== UI: Toast =====
  toastOpen = signal(false);
  toastText = signal('');
  toastKind = signal<ToastKind>('info');
  private toastTimer: any = null;

  private showToast(text: string, kind: ToastKind = 'info') {
    this.toastText.set(text);
    this.toastKind.set(kind);
    this.toastOpen.set(true);

    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastOpen.set(false), 3200);
  }

  // ===== מיפוי קומפוננטת פרטים לפי סוג =====
  REQUEST_DETAILS_COMPONENT: Record<string, any> = {
    INSTRUCTOR_DAY_OFF: RequestInstructorDayOffDetailsComponent,
    CANCEL_OCCURRENCE: RequestCancelOccurrenceDetailsComponent,
    ADD_CHILD: RequestAddChildDetailsComponent,
    NEW_SERIES: SecretarialSeriesRequestsComponent, 
    PARENT_SIGNUP: RequestAddParentDetailsComponent,
  };

  getDetailsComponent(type: string) {
    return this.REQUEST_DETAILS_COMPONENT[type] || null;
  }

  // ===== עזרי רול =====
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

  // ===== helpers להצגת קבצים/URL בפרטים (אם צריך) =====
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

  // ===== פילטרים =====
  statusFilter = signal<RequestStatus | 'ALL'>('PENDING');
  dateFilterMode: 'CREATED_AT' | 'REQUEST_WINDOW' = 'CREATED_AT';
  dateFrom: string | null = null;
  dateTo: string | null = null;
  searchTerm = '';
  typeFilter: 'ALL' | RequestType = 'ALL';

  // ===== נתונים =====
  private allRequests = signal<UiRequest[]>([]);
  loading = signal(false);
  loadError = signal<string | null>(null);

  // ===== פרטים =====
  detailsOpened = false;
  selectedRequest: UiRequest | null = null;
  indexOfRowSelected: number | null = null;

  // ===== רשימה מסוננת =====
  get filteredRequestsList(): UiRequest[] {
    const list = this.allRequests();
    const status = this.statusFilter();
    const term = this.searchTerm.trim().toLowerCase();
    const type = this.typeFilter;

    const from = this.dateFrom ? new Date(this.dateFrom) : null;
    const to = this.dateTo ? new Date(this.dateTo) : null;

    const myUid = this.curentUser?.uid ?? null;

    return list.filter((r) => {
      // הורה/מדריך רואים רק של עצמם
      if (!this.isSecretary) {
        if (!myUid) return false;
        if (r.requesterUid !== myUid) return false;
      }

      if (status !== 'ALL' && r.status !== status) return false;
      if (type !== 'ALL' && r.requestType !== type) return false;

      if (from || to) {
        const startEnd =
          this.dateFilterMode === 'CREATED_AT'
            ? { start: new Date(r.createdAt), end: new Date(r.createdAt) }
            : this.getRequestWindow(r);

        const start = startEnd.start;
        const end = startEnd.end;

        if (from && end < from) return false;
        if (to) {
          const toEnd = new Date(to);
          toEnd.setHours(23, 59, 59, 999);
          if (start > toEnd) return false;
        }
      }

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
    const fd = r.fromDate ? new Date(r.fromDate) : null;
    const td = r.toDate ? new Date(r.toDate) : null;

    if (fd && td) return { start: fd, end: td };
    if (fd && !td) return { start: fd, end: fd };

    const p: any = r.payload || {};
    const occur = p.occur_date ? new Date(p.occur_date) : null;
    if (occur) return { start: occur, end: occur };

    const c = new Date(r.createdAt);
    return { start: c, end: c };
  }

  async ngOnInit() {
    this.bo.observe(['(max-width: 900px)']).subscribe(r => {
      const mobile = r.matches;
      this.isMobile.set(mobile);

      // כשעוברים לדסקטופ - לא להשאיר drawer פתוח
      if (!mobile) {
        this.detailsDrawer?.close();
      }
    });

    await this.loadRequestsFromDb();
  }
  

  // --------------------------------------------------
  // טעינה מה־DB
  // --------------------------------------------------
  async loadRequestsFromDb() {
    this.loading.set(true);
    this.loadError.set(null);

    try {
      await ensureTenantContextReady();
      const db = dbTenant();

      // view שמחזיר requested_by_name, child_name, instructor_name וכו'
      const res = await db
        .from('v_secretarial_requests')
        .select('*')
        .order('created_at', { ascending: false });

      const data = res.data as any[] | null;
      const error = res.error;
      if (error) throw error;

      const mapped: UiRequest[] =
        data?.map((row: any) => this.mapRowToUi(row)) ?? [];

      this.allRequests.set(mapped);
    } catch (err: any) {
      console.error('Failed to load v_secretarial_requests', err);
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

      summary: this.buildSummary(row as SecretarialRequestDbRow, row.payload || {}),
      requestedByName: this.getRequesterDisplay(row),
      childName: row.child_name || undefined,
      instructorName: row.instructor_name || undefined,

      fromDate: row.from_date,
      toDate: row.to_date,
      createdAt: row.created_at,

      requesterUid: row.requested_by_uid,
      payload: row.payload,
      childId: row.child_id ?? null,
instructorId: row.instructor_id_number ?? row.instructor_id ?? null,

    };
  }

  private buildSummary(row: SecretarialRequestDbRow, p: any): string {
    switch (row.request_type) {
      case 'CANCEL_OCCURRENCE':
        return p.summary || `ביטול שיעור לתאריך ${p.occur_date ?? row.from_date ?? ''}`;
      case 'INSTRUCTOR_DAY_OFF':
        return p.summary || `יום חופש מדריך ${p.instructor_name ?? ''} בין ${row.from_date ?? ''}–${row.to_date ?? ''}`;
      case 'NEW_SERIES':
        return p.summary || 'בקשה לפתיחת סדרת שיעורים';
      case 'ADD_CHILD':
        return p.summary || 'בקשה להוספת ילד למערכת';
      case 'DELETE_CHILD':
        return p.summary || 'בקשה למחיקת ילד מהמערכת';
      case 'MAKEUP_LESSON':
        return p.summary || 'בקשה לשיעור פיצוי';
      case 'PARENT_SIGNUP':
        return p.summary || 'בקשה להרשמת הורה למערכת';
      default:
        return p.summary || 'כללי';
    }
  }

  private getRequesterDisplay(row: any): string {
  const uid = row.requested_by_uid;
  const name = row.requested_by_name;
  if (uid != "PUBLIC" && String(uid).trim()) return String(name);

  // אחרת: ננסה לחלץ שם מה-payload (במיוחד ל-PARENT_SIGNUP)
  const p: any = row.payload ?? {};

  // השדות אצלך בפועל בשורש
  const first = (p.first_name ?? p.firstName ?? p?.parent?.first_name ?? p?.parent?.firstName ?? '').toString().trim();
  const last  = (p.last_name  ?? p.lastName  ?? p?.parent?.last_name  ?? p?.parent?.lastName  ?? '').toString().trim();

  const full = `${first} ${last}`.trim();
  if (full) return full;

  return '—';
}


  // --------------------------------------------------
  // UI actions
  // --------------------------------------------------
  clearFilters() {
    this.dateFrom = null;
    this.dateTo = null;
    this.searchTerm = '';
    this.typeFilter = 'ALL';
    this.dateFilterMode = 'CREATED_AT';
    this.statusFilter.set('PENDING');
  }

  
  openDetails(row: UiRequest) {
  this.selectedRequest = row;
  this.indexOfRowSelected = this.filteredRequestsList.indexOf(row);
  this.detailsOpened = true;

  // ✅ במובייל לפתוח את הדראור
  if (this.isMobile()) {
    this.detailsDrawer?.open();
  }
}


  
  closeDetails() {
  this.detailsOpened = false;
  this.indexOfRowSelected = null;
  this.selectedRequest = null;

  if (this.isMobile()) {
    this.detailsDrawer?.close();
  }
}


  reloadRequests() {
    this.loadRequestsFromDb();
  }

  // --------------------------------------------------
  // סטטוס chips
  // --------------------------------------------------
  getStatusClass(status: RequestStatus): string {
    switch (status) {
      case 'PENDING': return 'status-chip pending';
      case 'APPROVED': return 'status-chip approved';
      case 'REJECTED': return 'status-chip rejected';
      case 'CANCELLED_BY_REQUESTER': return 'status-chip cancelled';
      default: return 'status-chip';
    }
  }

  getStatusLabel(status: RequestStatus): string {
    switch (status) {
      case 'PENDING': return 'ממתין';
      case 'APPROVED': return 'מאושר';
      case 'REJECTED': return 'נדחה';
      case 'CANCELLED_BY_REQUESTER': return 'בוטל ע״י המבקש/ת';
      default: return status;
    }
  }

  getRequestTypeLabel(type: RequestType): string {
    switch (type) {
      case 'CANCEL_OCCURRENCE': return 'ביטול שיעור';
      case 'INSTRUCTOR_DAY_OFF': return 'יום חופש מדריך';
      case 'NEW_SERIES': return 'סדרת שיעורים';
      case 'ADD_CHILD': return 'הוספת ילד/ה';
      case 'DELETE_CHILD': return 'מחיקת ילד/ה';
      case 'MAKEUP_LESSON': return 'שיעור פיצוי';
      case 'PARENT_SIGNUP': return 'הרשמת הורה';
      default: return type;
    }
  }

  getRequestTypeIcon(type: RequestType): string {
    switch (type) {
      case 'CANCEL_OCCURRENCE': return 'event_busy';
      case 'INSTRUCTOR_DAY_OFF': return 'beach_access';
      case 'NEW_SERIES': return 'repeat';
      case 'ADD_CHILD': return 'person_add';
      case 'DELETE_CHILD': return 'person_remove';
      case 'MAKEUP_LESSON': return 'school';
      case 'PARENT_SIGNUP': return 'person';
      default: return 'help';
    }
  }

  // --------------------------------------------------
  // PATCH מקומי = הסוד שהופך את זה ל"מרנדר מיד"
  // --------------------------------------------------
  private patchRequestStatus(requestId: string, newStatus: RequestStatus) {
    const arr = this.allRequests();
    const idx = arr.findIndex(x => x.id === requestId);
    if (idx === -1) return;

    const updated = [...arr];
    updated[idx] = { ...updated[idx], status: newStatus };
    this.allRequests.set(updated);

    // אם אנחנו בטאב ממתינים – הבקשה תיעלם מיד
    if (this.statusFilter() === 'PENDING') {
      this.selectedRequest = null;
      this.detailsOpened = false;
      this.indexOfRowSelected = null;
    }
  }

  onRequestError = async (e: { requestId?: string; message: string; raw?: any }) => {
    // אם זה “not pending” → סנכרון מהשרת כדי לא להישאר במצב מוזר
    const msg = (e?.message || '').toLowerCase();
    if (msg.includes('not pending')) {
      this.showToast('הסטטוס כבר עודכן. מסנכרנת רשימה…', 'info');
      await this.loadRequestsFromDb();
      return;
    }

    this.showToast(e.message || 'שגיאה', 'error');
    this.onError?.(e);
  };
  
  async cancelSelected() {
    const current = this.selectedRequest;
    if (!current || !this.curentUser) return;
    if (this.isSecretary) return;
    if (current.status !== 'PENDING') return;

    try {
      const db = dbTenant();
      const { error } = await db
        .from('secretarial_requests')
        .update({ status: 'CANCELLED_BY_REQUESTER' })
        .eq('id', current.id)
        .eq('requested_by_uid', this.curentUser.uid);

      if (error) throw error;

      this.patchRequestStatus(current.id, 'CANCELLED_BY_REQUESTER');
      this.showToast('הבקשה בוטלה', 'info');
      void this.loadRequestsFromDb();
    } catch (err: any) {
      console.error(err);
      await this.onRequestError({ requestId: current.id, message: err?.message || 'שגיאה בביטול הבקשה', raw: err });
    }
  }


onDetailsActivate(instance: any) {
  // ניקוי חיבורים קודמים (כדי לא לצבור סאבסקריפשנים)
  this.detailsSubs.forEach(s => s.unsubscribe());
  this.detailsSubs = [];

  if (instance?.approved?.subscribe) {
    this.detailsSubs.push(
      instance.approved.subscribe((e: any) => this.onAnyApproved(e))
    );
  }

  if (instance?.rejected?.subscribe) {
    this.detailsSubs.push(
      instance.rejected.subscribe((e: any) => this.onAnyRejected(e))
    );
  }

  if (instance?.error?.subscribe) {
    this.detailsSubs.push(
      instance.error.subscribe((msg: string) => this.onAnyError(msg))
    );
  }
}

onChildApproved(e: { requestId: string }) {
  this.loadRequestsFromDb();   // סנכרון מלא מהרקע
  this.closeDetails();
}

onChildRejected(e: { requestId: string }) {
  this.loadRequestsFromDb();
  this.closeDetails();
}

onChildError(e: { requestId: string }) {
  this.loadRequestsFromDb();
  this.closeDetails();
}


private onAnyApproved(e: { requestId: string; newStatus: 'APPROVED' }) {
  this.patchRequestStatus(e.requestId, 'APPROVED'); // נעלם מ"ממתינים" מיד
  this.closeDetails();
}

private onAnyRejected(e: { requestId: string; newStatus: 'REJECTED' }) {
  this.patchRequestStatus(e.requestId, 'REJECTED');
  this.closeDetails();
}

private onAnyError(msg: string) {
  // פה את יכולה לעשות snackbar מרכזי אם בא לך
  console.error('request details error:', msg);
}

}
