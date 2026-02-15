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
import { RequestRemoveChildDetailsComponent } from './request-remove-child-details/request-remove-child-details.component';
import { BulkRunReportDialogComponent } from './bulk-run-report-dialog/bulk-run-report-dialog.component';



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
import { EnvironmentInjector, ViewContainerRef } from '@angular/core';


// קומפוננטות פרטים (נטענות לפי סוג)
import { RequestInstructorDayOffDetailsComponent } from './request-instructor-day-off-details/request-instructor-day-off-details.component';
import { RequestCancelOccurrenceDetailsComponent } from './request-cancel-occurrence-details/request-cancel-occurrence-details.component';
import { RequestAddChildDetailsComponent } from './request-add-child-details/request-add-child-details.component';
import { SecretarialSeriesRequestsComponent } from './request-new-series-details/request-new-series-details.component';
import { RequestAddParentDetailsComponent } from './request-add-parent-details/request-add-parent-details.component';
import { RequestMakeupLessonDetailsComponent } from './request-makeup-lesson-details/request-makeup-lesson-details.component';
import { RequestFillInDetailsComponent } from './request-fill-in-details/request-fill-in-details.component';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { BulkDecisionDialogComponent, BulkDecisionDialogResult } from './bulk-decision-dialog/bulk-decision-dialog.component';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RequestValidationService } from './../services/request-validation.service';

// export enum Check {
//   Expiry = 'expiry',
//   Requester = 'requester',
//   Child = 'child',
//   Instructor = 'instructor',
//   ParentTarget = 'parentTarget',
//   FarmDayOff = 'farmDayOff', 

// }


type ToastKind = 'success' | 'error' | 'info';

// type ValidationMode = 'auto' | 'approve';

// type ValidationResult = { ok: true } | { ok: false; reason: string };
type RejectSource = 'user' | 'system';
type RejectArgs = { source: RejectSource; reason?: string };
type RequesterRole = 'parent' | 'instructor' | 'secretary' | 'admin' | 'manager';
type CheckKey = 'expiry' | 'requester' | 'child' | 'instructor' | 'parentTarget';

// type RequestRule = {
//   checks: Check[];
//   allowedChildStatuses?: Set<string>;
// };
type BulkOutcomeKind = 'success' | 'failed' | 'systemRejected';

type BulkRunItemReport = {
  id: string;
  requestType: RequestType | string;
  summary?: string;
  requestedByName?: string;
  childName?: string;
  instructorName?: string;

  action: 'approve' | 'reject';
  kind: BulkOutcomeKind;

  // אם זו דחייה אוטומטית: למה
  systemReason?: string;

  // אם נכשל: הודעת שגיאה
  errorMessage?: string;
};

type BulkRunReport = {
  action: 'approve' | 'reject';
  total: number;
  successCount: number;
  failedCount: number;
  systemRejectedCount: number;

  results: BulkRunItemReport[];    
  systemRejected: BulkRunItemReport[];
  failed: BulkRunItemReport[];
};



@Component({
  selector: 'app-secretarial-requests-page',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatButtonModule, MatSidenavModule , MatSidenavModule, MatDialogModule , MatProgressSpinnerModule
],
  templateUrl: './secretarial-requests-page.component.html',
  styleUrls: ['./secretarial-requests-page.component.css'],
})
export class SecretarialRequestsPageComponent implements OnInit {
  // אם את רוצה שמי שמחזיק את הקומפוננטה יקבל callbacks גם כן
  @Input() onApproved?: (e: any) => void;
  @Input() onRejected?: (e: any) => void;
  @Input() onError?: (e: any) => void;
private validation = inject(RequestValidationService);

// private REQUEST_RULES: Record<RequestType, RequestRule> = {
//   CANCEL_OCCURRENCE: {
//     checks: [Check.Expiry, Check.Requester, Check.Child, Check.Instructor],
//     allowedChildStatuses: new Set([
//       'Active',
//       'Deletion Scheduled',
//       'Pending Deletion Approval',
//     ]),
//   },

//   INSTRUCTOR_DAY_OFF: {
//     checks: [Check.Expiry, Check.Requester, Check.Instructor , Check.FarmDayOff],
//   },

//  NEW_SERIES: {
//   checks: [Check.Expiry, Check.Requester, Check.Child, Check.Instructor, Check.FarmDayOff],
//   allowedChildStatuses: new Set(['Active','Deletion Scheduled','Pending Deletion Approval']),
// },


//   MAKEUP_LESSON: {
//     checks: [Check.Expiry, Check.Requester, Check.Child, Check.Instructor , Check.FarmDayOff],
//     allowedChildStatuses: new Set([
//       'Active',
//       'Deletion Scheduled',
//       'Pending Deletion Approval',
//     ]),
//   },

//   FILL_IN: {
//     checks: [Check.Expiry, Check.Requester, Check.Child, Check.Instructor , Check.FarmDayOff],
//     allowedChildStatuses: new Set([
//       'Active',
//       'Deletion Scheduled',
//       'Pending Deletion Approval',
//     ]),
//   },

//   ADD_CHILD: {
//     checks: [Check.Expiry, Check.Requester, Check.ParentTarget, Check.Child],
//     allowedChildStatuses: new Set(['Pending Addition Approval']),
//   },

//   DELETE_CHILD: {
//     checks: [Check.Expiry, Check.Requester, Check.Child],
//     allowedChildStatuses: new Set(['Pending Deletion Approval']),
//   },

//   PARENT_SIGNUP: {
//     checks: [],
//   },
//   OTHER_REQUEST:{
//     checks:[],
//   },
// };

  private cu = inject(CurrentUserService);
  private sanitizer = inject(DomSanitizer);
  private detailsSubs: Subscription[] = [];
  private bo = inject(BreakpointObserver);
  private autoRejectInFlight = false;
private dialog = inject(MatDialog);
// private getRulesFor(row: UiRequest): RequestRule {
//   const type = row.requestType as RequestType;
// return this.REQUEST_RULES[type] ?? { checks: [Check.Requester] };
// }

  isMobile = signal(false);

  @ViewChild('detailsDrawer') detailsDrawer?: MatSidenav;

  private selectedIdsSig = signal<Set<string>>(new Set());
  @ViewChild('bulkHost', { read: ViewContainerRef })
  bulkHost?: ViewContainerRef;
  private envInj = inject(EnvironmentInjector);

selectedCount() {
  return this.selectedIdsSig().size;
}


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
    DELETE_CHILD: RequestRemoveChildDetailsComponent,
    NEW_SERIES: SecretarialSeriesRequestsComponent, 
    PARENT_SIGNUP: RequestAddParentDetailsComponent,
    MAKEUP_LESSON: RequestMakeupLessonDetailsComponent,
    FILL_IN: RequestFillInDetailsComponent,

  };

  private isDbFailure(err: any): boolean {
  const msg = String(err?.message ?? err ?? '').toLowerCase();
  // supabase-js errors / fetch
  return (
    msg.includes('failed to fetch') ||
    msg.includes('network') ||
    msg.includes('timeout') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('500') ||
    msg.includes('400') ||
    msg.includes('jwt') ||
    msg.includes('permission') ||
    msg.includes('rls') ||
    msg.includes('schema') ||
    msg.includes('tenant')
  );
}

// private handleDbFailure(mode: ValidationMode, context: string, err: any): ValidationResult {
//   console.warn(`[VALIDATION][${mode}] ${context} DB failed → skip/restrict`, err);

//   // במצב auto: לא מפילים, לא דוחים
//   if (mode === 'auto') return { ok: true };

//   // במצב approve: חוסמים כדי לא לאשר בטעות
//   return { ok: false, reason: 'לא ניתן לאמת כרגע (שגיאת מערכת). נסי לרענן/להתחבר מחדש.' };
// }

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
bulkBusy = signal(false);
bulkBusyMode = signal<'approve' | 'reject' | null>(null);

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

      if (status !== 'ALL') {
        if (status === 'REJECTED' && r.status === 'REJECTED_BY_SYSTEM') {
          // include system rejections under rejected tab
        } else if (r.status !== status) return false;
      }
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

    // ✅ חדש: רק בדיקות קריטיות בעמוד (Active וכו')
    void this.autoRejectCriticalInvalidRequests('load');
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
      requesterRole: row.requested_by_role ?? null, 
      payload: row.payload,
      childId: row.child_id ?? null,
instructorId: row.instructor_id_number ?? row.instructor_id ?? null,
  lessonOccId: row.lesson_occ_id ?? null,   

    };
  }

private buildSummary(row: any, p: any): string {
    switch (row.request_type) {
      case 'CANCEL_OCCURRENCE':
        return p.summary || `ביטול שיעור לתאריך ${p.occur_date ?? row.from_date ?? ''}`;
   case 'INSTRUCTOR_DAY_OFF': {
  if (p.summary) return p.summary;

  const from = (row.from_date ?? '').slice(0, 10);
  const to   = (row.to_date ?? row.from_date ?? '').slice(0, 10);
  const name = row.instructor_name ?? '';

  const allDay = !!p.all_day;
  const start = (p.requested_start_time ?? '').toString().slice(0, 5) || null;
  const end   = (p.requested_end_time   ?? '').toString().slice(0, 5) || null;

  // יום אחד
  if (from && to && from === to) {
    if (allDay) return `יום חופש מלא למדריך/ה ${name} בתאריך ${from}`;
    if (start && end) return `יום חופש למדריך/ה ${name} בתאריך ${from} (${start}–${end})`;
    return `יום חופש למדריך/ה ${name} בתאריך ${from}`;
  }

  // טווח ימים
  if (from && to && from !== to) {
    if (allDay) return `חופשה מלאה למדריך/ה ${name} בין ${from}–${to}`;
    if (start && end) return `חופשה למדריך/ה ${name} בין ${from}–${to} (בכל יום ${start}–${end})`;
    return `חופשה למדריך/ה ${name} בין ${from}–${to}`;
  }

  return `יום חופש מדריך ${name}`;
}

      case 'NEW_SERIES':
        return p.summary || 'בקשה לפתיחת סדרת שיעורים';
      case 'ADD_CHILD':
        return p.summary || 'בקשה להוספת ילד למערכת';
      case 'DELETE_CHILD':
        return p.summary || 'בקשה למחיקת ילד מהמערכת';
      case 'MAKEUP_LESSON':
        return p.summary || 'בקשה לשיעור השלמה';
      case 'PARENT_SIGNUP':
        return p.summary || 'בקשה להרשמת הורה למערכת';
      case 'FILL_IN':
      return p.summary || `מילוי מקום בשיעור ${p.occur_date ?? row.from_date ?? ''}`;

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
            case 'REJECTED_BY_SYSTEM': return 'status-chip rejected';
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
      case 'REJECTED_BY_SYSTEM': return 'נדחה על ידי המערכת';
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
      case 'MAKEUP_LESSON': return 'שיעור השלמה';
      case 'FILL_IN': return 'מילוי מקום';
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
      case 'FILL_IN': return 'swap_horiz';
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

  const current = this.selectedRequest;
  if (current) {
    this.wrapApproveWithValidation(instance, current);
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

private onAnyRejected(e: { requestId: string; newStatus: RequestStatus }) {
  this.patchRequestStatus(e.requestId, e.newStatus ?? 'REJECTED');
}


private onAnyError(msg: string) {
  // פה את יכולה לעשות snackbar מרכזי אם בא לך
  console.error('request details error:', msg);
}

isRowSelectable(row: UiRequest): boolean {
  return this.isSecretary && row.status === 'PENDING';
}

isSelected(row: UiRequest): boolean {
  return this.selectedIdsSig().has(row.id);
}

clearSelection() {
  this.selectedIdsSig.set(new Set());
}

toggleRowSelection(row: UiRequest, ev: Event) {
  ev.stopPropagation();
  if (!this.isRowSelectable(row)) return;

  const next = new Set(this.selectedIdsSig());
  next.has(row.id) ? next.delete(row.id) : next.add(row.id);
  this.selectedIdsSig.set(next);
}

toggleSelectAll(ev: Event) {
  ev.stopPropagation();

  const selectable = this.filteredRequestsList.filter(r => this.isRowSelectable(r));
  const current = this.selectedIdsSig();

  const allChecked = selectable.length > 0 && selectable.every(r => current.has(r.id));
  const next = new Set(current);

  if (allChecked) {
    selectable.forEach(r => next.delete(r.id));
  } else {
    selectable.forEach(r => next.add(r.id));
  }

  this.selectedIdsSig.set(next);
}

isAllSelectableChecked(): boolean {
  const selectable = this.filteredRequestsList.filter(r => this.isRowSelectable(r));
  if (!selectable.length) return false;
  const current = this.selectedIdsSig();
  return selectable.every(r => current.has(r.id));
}

isSomeSelectableChecked(): boolean {
  const selectable = this.filteredRequestsList.filter(r => this.isRowSelectable(r));
  if (!selectable.length) return false;
  const current = this.selectedIdsSig();
  const some = selectable.some(r => current.has(r.id));
  const all = selectable.every(r => current.has(r.id));
  return some && !all;
}

private getSelectedRowsPending(): UiRequest[] {
  const selected = this.selectedIdsSig();
  return this.filteredRequestsList.filter(r => selected.has(r.id) && this.isRowSelectable(r));
}

private async runDecisionViaDetailsComponent(
  row: UiRequest,
  action: 'approve' | 'reject',
  rejectArgs?: RejectArgs
): Promise<BulkRunItemReport> {

if (row.status !== 'PENDING') {
  return {
    id: row.id,
    requestType: row.requestType,
    summary: row.summary,
    requestedByName: row.requestedByName,
    childName: row.childName,
    instructorName: row.instructorName,
    action,
    kind: 'failed',
    errorMessage: 'לא ניתן לבצע פעולה על בקשה שאינה ממתינה',
  };
}
if (!this.bulkHost) {
  return {
    id: row.id,
    requestType: row.requestType,
    summary: row.summary,
    requestedByName: row.requestedByName,
    childName: row.childName,
    instructorName: row.instructorName,
    action,
    kind: 'failed',
    errorMessage: 'bulkHost לא מאותחל',
  };
}

 const cmp = this.getDetailsComponent(row.requestType);
if (!cmp) {
  return {
    id: row.id,
    requestType: row.requestType,
    summary: row.summary,
    requestedByName: row.requestedByName,
    childName: row.childName,
    instructorName: row.instructorName,
    action,
    kind: 'failed',
    errorMessage: `אין קומפוננטת פרטים לסוג ${row.requestType}`,
  };
}

  // יצירה בזיכרון (לא מוצג)
  const ref = this.bulkHost.createComponent(cmp, { environmentInjector: this.envInj });
  const inst: any = ref.instance;

  // להזין Inputs בסיסיים
  inst.request = row;
  inst.decidedByUid = this.curentUser?.uid;
inst.bulkMode = true; // ✅ מונע confirm dialogs פנימיים

  // callbacks לעדכון מיידי
  inst.onApproved = (e: any) => {
    this.patchRequestStatus(row.id, 'APPROVED');
    const next = new Set(this.selectedIdsSig());
    next.delete(row.id);
    this.selectedIdsSig.set(next);
  };
 inst.onRejected = (e: any) => {
  const status = e?.newStatus ?? 'REJECTED';
  this.patchRequestStatus(row.id, status);
    const next = new Set(this.selectedIdsSig());
    next.delete(row.id);
    this.selectedIdsSig.set(next);
  };
  inst.onError = (e: any) => {
    console.error('bulk decision error', row.id, e);
  };

  try {
    // ולידציה רק לפני approve (כמו שרצית)
    if (action === 'approve') {
const valid = await this.validation.validate(row, 'approve');
      if (!valid.ok) {
  const reason = valid.reason ?? 'בקשה לא רלוונטית';
  const didReject = await this.rejectBySystem(row, reason);

  if (didReject) {
    return {
      id: row.id,
      requestType: row.requestType,
      summary: row.summary,
      requestedByName: row.requestedByName,
      childName: row.childName,
      instructorName: row.instructorName,
      action,
      kind: 'systemRejected',
      systemReason: reason,
    };
  }

  // אם לא הצליח לדחות (כי כבר טופל/סטטוס השתנה) – נחשב ככשל להרצה
  return {
    id: row.id,
    requestType: row.requestType,
    summary: row.summary,
    requestedByName: row.requestedByName,
    childName: row.childName,
    instructorName: row.instructorName,
    action,
    kind: 'failed',
    errorMessage: reason,
  };
}

    }

  const before = row.status;

// ✅ לבחור מתודה לפי הקומפוננטה
const methodName =
  action === 'approve'
    ? (typeof inst?.approveSelected === 'function' ? 'approveSelected' : 'approve')
    : (typeof inst?.rejectSelected === 'function' ? 'rejectSelected' : 'reject');

const fn = inst?.[methodName];
if (typeof fn !== 'function') {
  return {
    id: row.id,
    requestType: row.requestType,
    summary: row.summary,
    requestedByName: row.requestedByName,
    childName: row.childName,
    instructorName: row.instructorName,
    action,
    kind: 'failed',
    errorMessage: `לקומפוננטה אין מתודה ${methodName}()`,
  };
}


// ✅ אם זו דחייה – להזין note (כי בסדרה זה חובה)
if (action === 'reject') {
  const reason = rejectArgs?.reason?.trim() ?? '';

  // ✅ אם note הוא signal -> note.set(...)
  if (typeof inst?.note?.set === 'function') {
    inst.note.set(reason);
  }
  // ✅ אם note הוא string רגיל (קומפוננטות ישנות) -> note = reason
  else if ('note' in inst) {
    inst.note = reason;
  }

  await fn.call(inst, rejectArgs ?? { source: 'user', reason });
} else {
  await fn.call(inst);
}


// ✅ אם לא השתנה סטטוס (לא קרא update/emit) – להחזיר כישלון כדי לא לשקר
// (בד"כ קומפוננטה תקרא onRejected/onApproved ותעשה patchRequestStatus)
const afterLocal =
  this.allRequests().find(x => x.id === row.id)?.status ?? before;

if (afterLocal === 'PENDING') {
  return {
    id: row.id,
    requestType: row.requestType,
    summary: row.summary,
    requestedByName: row.requestedByName,
    childName: row.childName,
    instructorName: row.instructorName,
    action,
    kind: 'failed',
    errorMessage: 'הפעולה לא בוצעה (הבקשה נשארה PENDING).',
  };
}

if (afterLocal === 'REJECTED_BY_SYSTEM') {
  return {
    id: row.id,
    requestType: row.requestType,
    summary: row.summary,
    requestedByName: row.requestedByName,
    childName: row.childName,
    instructorName: row.instructorName,
    action,
    kind: 'systemRejected',
    systemReason: rejectArgs?.reason?.trim() || undefined, // אם היה
  };
}

return {
  id: row.id,
  requestType: row.requestType,
  summary: row.summary,
  requestedByName: row.requestedByName,
  childName: row.childName,
  instructorName: row.instructorName,
  action,
  kind: 'success',
};

} catch (e: any) {
  return {
    id: row.id,
    requestType: row.requestType,
    summary: row.summary,
    requestedByName: row.requestedByName,
    childName: row.childName,
    instructorName: row.instructorName,
    action,
    kind: 'failed',
    errorMessage: e?.message || String(e),
  };
} finally {
  ref.destroy();
}

}

async bulkApproveSelected() {
  if (this.bulkBusy()) return;

  if (!this.isSecretary || !this.curentUser) return;

  const rows = this.getSelectedRowsPending();
  if (!rows.length) return;

  const dlg = await this.openBulkDecisionDialog('approve', rows);
  if (!dlg?.confirmed) return;

  this.bulkBusyMode.set('approve');
  this.bulkBusy.set(true);

 try {
  const results: BulkRunItemReport[] = [];

  for (const r of rows) {
    const res = await this.runDecisionViaDetailsComponent(r, 'approve');
    results.push(res);

    const next = new Set(this.selectedIdsSig());
    next.delete(r.id);
    this.selectedIdsSig.set(next);
  }

  const report = this.buildBulkReport('approve', results);

  // ה-toast הקיים שלך יכול להישאר (רשות)
  if (report.successCount) this.showToast(`אושרו ${report.successCount} בקשות`, 'success');
  if (report.systemRejectedCount) this.showToast(`נדחו אוטומטית ${report.systemRejectedCount}`, 'info');
  if (report.failedCount) this.showToast(`נכשלו ${report.failedCount} בקשות`, 'error');

  await this.loadRequestsFromDb();
  await this.autoRejectCriticalInvalidRequests('postBulk');
  this.clearSelection();

  // ✅ הפופאפ דוח בסוף (אחרי סנכרון)
  this.openBulkRunReportDialog(report);
  } finally {
    this.bulkBusy.set(false);
    this.bulkBusyMode.set(null);
  }
}

async bulkRejectSelected() {
  if (this.bulkBusy()) return;

  if (!this.isSecretary || !this.curentUser) return;

  const rows = this.getSelectedRowsPending();
  if (!rows.length) return;

  const ref = this.dialog.open(BulkDecisionDialogComponent, {
    data: {
      mode: 'reject',
      title: 'דחיית בקשות מסומנות',
      items: rows.map(r => ({
        id: r.id,
        requestType: r.requestType,
        requestedByName: r.requestedByName,
        summary: r.summary,
        childName: r.childName,
        instructorName: r.instructorName,
        createdAt: r.createdAt,
      })),
    },
    disableClose: true,
    panelClass: 'ui-confirm-dialog',
    backdropClass: 'ui-confirm-backdrop',
  });

  const result = await firstValueFrom(ref.afterClosed());
  if (!result?.confirmed) return;

  const reasonsById = result.reasonsById ?? {};

  this.bulkBusyMode.set('reject');
  this.bulkBusy.set(true);

 try {
  const results: BulkRunItemReport[] = [];

  for (const r of rows) {
    const reason = (reasonsById[r.id] ?? '').trim();
    const res = await this.runDecisionViaDetailsComponent(r, 'reject', { source: 'user', reason });
    results.push(res);

    const next = new Set(this.selectedIdsSig());
    next.delete(r.id);
    this.selectedIdsSig.set(next);
  }

  const report = this.buildBulkReport('reject', results);

  if (report.successCount) this.showToast(`נדחו ${report.successCount} בקשות`, 'success');
  if (report.systemRejectedCount) this.showToast(`נדחו אוטומטית ${report.systemRejectedCount}`, 'info');
  if (report.failedCount) this.showToast(`נכשלו ${report.failedCount} בקשות`, 'error');

  await this.loadRequestsFromDb();
  await this.autoRejectCriticalInvalidRequests('postBulk');
  this.clearSelection();

  this.openBulkRunReportDialog(report);
  } finally {
    this.bulkBusy.set(false);
    this.bulkBusyMode.set(null);
  }
}


  private wrapApproveWithValidation(instance: any, row: UiRequest) {
  if (row.status !== 'PENDING') return;
  const wrap = (methodName: 'approve' | 'approveSelected') => {
    const original = instance?.[methodName];
    if (typeof original !== 'function') return;
    if (original.__sfWrapped) return;

    const wrapped = async () => {
    const valid = await this.validation.validate(row, 'approve');
if (!valid.ok) {
  await this.rejectBySystem(row, valid.reason ?? 'בקשה לא רלוונטית');
  return;
}

      return original.call(instance);
    };

    wrapped.__sfWrapped = true;
    instance[methodName] = wrapped;
  };

  wrap('approve');
  wrap('approveSelected');
}
get hasSelectableRows(): boolean {
  return this.filteredRequestsList.some(r => this.isRowSelectable(r));
}

// private async rejectInvalidRequests(context: 'load' | 'postBulk') {
//   if (!this.isSecretary || !this.curentUser) return;
//   if (this.autoRejectInFlight) return;
//   this.autoRejectInFlight = true;

//   try {
//     const pending = this.allRequests().filter(r => r.status === 'PENDING');
//     if (!pending.length) return;

//     let rejected = 0;

//     for (const r of pending) {
//       const valid = await this.isValidRequset(r, undefined, 'auto');
//       if (!valid.ok) {
//         const reason = valid.reason ?? 'בקשה לא רלוונטית';

//         // ✅ לדחות דרך קומפוננטת הפרטים
//         const res = await this.runDecisionViaDetailsComponent(r, 'reject', {
//           source: 'system',
//           reason,
//         });

//         if (res.ok) rejected++;
//       }
//     }

//     if (rejected > 0) {
//       this.showToast(
//         context === 'postBulk'
//           ? `נדחו אוטומטית ${rejected} בקשות לא רלוונטיות אחרי האישור`
//           : `נדחו אוטומטית ${rejected} בקשות לא רלוונטיות`,
//         'info'
//       );
//     }
//   } finally {
//     this.autoRejectInFlight = false;
//   }
// }


// private async isValidRequset(row: UiRequest, mode: 'auto' | 'approve' | 'reject' = 'auto') {
//   return this.validation.validate(row, mode);
// }


// private async isCriticalValidRequest(row: UiRequest, mode: 'auto' = 'auto') {
//   return this.validation.validate(row, mode);
// }

private async autoRejectCriticalInvalidRequests(context: 'load' | 'postBulk') {
  if (!this.isSecretary || !this.curentUser) return;
  if (this.autoRejectInFlight) return;
  this.autoRejectInFlight = true;

  try {
    const pending = this.allRequests().filter(r => r.status === 'PENDING');
    if (!pending.length) return;

    let rejected = 0;

    for (const r of pending) {
      // ✅ רק קריטי
const valid = await this.validation.validate(r, 'auto');
      if (!valid.ok) {
        const reason = valid.reason ?? 'הבקשה אינה רלוונטית (קריטי)';
        const ok = await this.rejectBySystem(r, reason);
        if (ok) rejected++;
      }
    }

    if (rejected > 0) {
      this.showToast(
        context === 'postBulk'
          ? `נדחו אוטומטית ${rejected} בקשות לא רלוונטיות (קריטי) אחרי פעולה`
          : `נדחו אוטומטית ${rejected} בקשות לא רלוונטיות (קריטי)`,
        'info'
      );
    }
  } finally {
    this.autoRejectInFlight = false;
  }
}


// private getExpiryReason(row: UiRequest): string | null {
//   const p: any = row.payload ?? {};
//   const now = new Date();

//   const isPast = (dateStr: string | null | undefined, timeStr?: string | null): boolean => {
//     if (!dateStr) return false;
//     const dt = this.combineDateTime(dateStr, timeStr);
//     return dt.getTime() < now.getTime();
//   };

//   switch (row.requestType) {
//     case 'CANCEL_OCCURRENCE': {
//   const dateStr = p.occur_date ?? row.fromDate ?? null;

//   const timeStr =
//     p.start_time ??
//     p.requested_start_time ??  
//     p.startTime ??
//     p.time ??
//     null;

//   if (isPast(dateStr, timeStr)) return 'עבר מועד השיעור לביטול';
//   return null;
// }

//     case 'INSTRUCTOR_DAY_OFF': {
//       const end = row.toDate ?? row.fromDate ?? null;
//       if (isPast(end, '23:59')) return 'עבר מועד חופשת המדריך';
//       return null;
//     }
//     case 'NEW_SERIES': {
//       const start = row.fromDate ?? p.series_start_date ?? p.start_date ?? null;
//  const timeStr =
//     p.requested_start_time ?? p.start_time ?? p.startTime ?? null;

//   if (isPast(start, timeStr ?? '00:00')) return 'עבר מועד תחילת הסדרה';
//   return null;      
//     }
//     case 'MAKEUP_LESSON':
//     case 'FILL_IN': {
//       const dateStr = row.fromDate ?? p.occur_date ?? null;
//       const timeStr = p.requested_start_time ?? p.start_time ?? p.startTime ?? null;
//       if (isPast(dateStr, timeStr)) return 'עבר מועד השיעור המבוקש';
//       return null;
//     }
//     default:
//       return null;
//   }
// }

private combineDateTime(dateStr: string, timeStr?: string | null): Date {
  const d = dateStr?.slice(0, 10);
  const t = (timeStr ?? '00:00').slice(0, 5);
  return new Date(`${d}T${t}:00`);
}

private getChildIdForRequest(row: UiRequest): string | null {
  const p: any = row.payload ?? {};
  return row.childId ?? p.child_id ?? p.childId ?? null;
}

private getInstructorIdForRequest(row: UiRequest): string | null {
  const p: any = row.payload ?? {};
  return (
    row.instructorId ??
    p.instructor_id_number ??
    p.instructor_id ??
    p.instructorId ??
    null
  );
}


private getParentUidForRequest(row: UiRequest): string | null {
  const p: any = row.payload ?? {};
  const uid = row.requesterUid;
  if (uid && uid !== 'PUBLIC') return uid;
  return p.parent_uid ?? p.parent?.uid ?? p.uid ?? null;
}


// private async checkChildActive(
//   db: any,
//   row: UiRequest,
//   mode: ValidationMode,
//   allowedStatuses?: Set<string>
// ): Promise<{ ok: boolean; reason?: string }> {

//   const childId = this.getChildIdForRequest(row);
//   if (!childId) return { ok: true };

//   try {
//     const { data, error } = await db
//       .from('children')
//       .select('status, scheduled_deletion_at')
//       .eq('child_uuid', childId)
//       .maybeSingle();

//     if (error) {
//       const r = this.handleDbFailure(mode, 'checkChildActive', error);
//       return r.ok ? { ok: true } : { ok: false, reason: r.reason };
//     }

//     if (!data) {
//       if (mode === 'auto') return { ok: true };
//       return { ok: false, reason: 'לא נמצא ילד במערכת' };
//     }

//     const status = (data as any)?.status ?? null;
//     const scheduledDeletionAt = (data as any)?.scheduled_deletion_at ?? null;

//     // ✅ נשאר לך החוק המיוחד ל-Deletion Scheduled עבור MAKEUP/FILL_IN
//     if (
//       status === 'Deletion Scheduled' &&
//       scheduledDeletionAt &&
//       (row.requestType === 'MAKEUP_LESSON' || row.requestType === 'FILL_IN')
//     ) {
//       const p: any = row.payload ?? {};
//       const dateStr = row.fromDate ?? p.occur_date ?? p.from_date ?? null;
//       const timeStr = p.requested_start_time ?? p.start_time ?? p.startTime ?? '00:00';

//       if (dateStr) {
//         const reqDt = this.combineDateTime(String(dateStr), String(timeStr));
//         const delDt = new Date(String(scheduledDeletionAt));
//         if (!isNaN(delDt.getTime()) && reqDt.getTime() >= delDt.getTime()) {
//           const delPretty = new Date(delDt).toLocaleString('he-IL');
//           return {
//             ok: false,
//             reason: `הבקשה נדחתה אוטומטית: הילד/ה מתוזמן/ת למחיקה ב-${delPretty}, והשיעור המבוקש לאחר מועד זה.`,
//           };
//         }
//       }
//     }

//     // ✅ אם אין allowedStatuses → לא בודקים סטטוס ילד
//     if (!allowedStatuses || allowedStatuses.size === 0) return { ok: true };

//     if (!allowedStatuses.has(status)) {
//       if (row.requestType === 'DELETE_CHILD') {
//         return { ok: false, reason: `כדי למחוק ילד, הסטטוס חייב להיות Pending Deletion Approval (כרגע: ${status})` };
//       }
//       return { ok: false, reason: `הילד אינו מתאים לבקשה (סטטוס: ${status})` };
//     }

//     return { ok: true };
//   } catch (e: any) {
//     const r = this.handleDbFailure(mode, 'checkChildActive', e);
//     return r.ok ? { ok: true } : { ok: false, reason: r.reason };
//   }
// }
// private async validateRequestByRules(
//   row: UiRequest,
//   mode: ValidationMode
// ): Promise<{ ok: boolean; reason?: string }> {

//   if (!row) return { ok: false, reason: 'בקשה לא תקינה' };

//   const rules = this.getRulesFor(row);

//   await ensureTenantContextReady();
//   const db = dbTenant();

//   for (const check of rules.checks) {
//   switch (check) {
//     case Check.Expiry: {
//       const expiryReason = this.getExpiryReason(row);
//       if (expiryReason) return { ok: false, reason: expiryReason };
//       break;
//     }

//     case Check.Requester: {
//       const r = await this.checkRequesterActive(db, row, mode);
//       if (!r.ok) return r;
//       break;
//     }

//     case Check.Child: {
//       const r = await this.checkChildActive(
//         db,
//         row,
//         mode,
//         rules.allowedChildStatuses
//       );
//       if (!r.ok) return r;
//       break;
//     }
//     case Check.FarmDayOff: {
//   const r = await this.checkFarmDayOffConflict(db, row, mode);
//   if (!r.ok) return r;
//   break;
// }


//     case Check.Instructor: {
//       const r = await this.checkInstructorActive(db, row, mode);
//       if (!r.ok) return r;
//       break;
//     }

//     case Check.ParentTarget: {
//       const r = await this.checkParentActive(db, row, mode);
//       if (!r.ok) return r;
//       break;
//     }
//   }
// }

//   return { ok: true };
// }

private normalizeTimeHHMM(v: any): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;

  // אם הגיע ISO עם תאריך (נדיר אצלך אבל שיהיה)
  // "2026-02-18T10:29:00.000Z" -> "10:29"
  if (s.includes('T')) {
    const timePart = s.split('T')[1] ?? '';
    return timePart.slice(0, 5);
  }

  // "10:29:00" -> "10:29"
  if (s.length >= 5) return s.slice(0, 5);

  return null;
}

private timeToMinutes(hhmm: string): number {
  const [hh, mm] = hhmm.split(':');
  const h = Number(hh);
  const m = Number(mm);
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

// חפיפה של דקות: [aStart,aEnd) מול [bStart,bEnd)
private overlapsMinutes(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  if (aEnd <= aStart || bEnd <= bStart) return false;
  return aStart < bEnd && bStart < aEnd;
}

private getRequestedDateAndWindow(row: UiRequest): { date: string; startMin: number; endMin: number } | null {
  const p: any = row.payload ?? {};

  // תאריך רלוונטי
  const date =
    (row.requestType === 'NEW_SERIES'
      ? (row.fromDate ?? p.series_start_date ?? p.start_date ?? null)
      : (row.fromDate ?? p.occur_date ?? p.from_date ?? null)
    );

  if (!date) return null;

  // שעות רלוונטיות
  const startHHMM = this.normalizeTimeHHMM(
    p.requested_start_time ?? p.start_time ?? p.startTime ?? p.time ?? null
  );

  // ✅ חדש: סוף מפורש מה־payload
  const endHHMM = this.normalizeTimeHHMM(
    p.requested_end_time ?? p.end_time ?? p.endTime ?? null
  );

  if (!startHHMM) return null;

  const startMin = this.timeToMinutes(startHHMM);

  // fallback אם אין requested_end_time
  let endMin: number;
  if (endHHMM) {
    endMin = this.timeToMinutes(endHHMM);
  } else {
    // ברירת מחדל (אם עדיין לא שולחים end): 30 דקות
    endMin = startMin + 30;
  }

  return { date: String(date).slice(0, 10), startMin, endMin };
}

// private async checkFarmDayOffConflict(db: any, row: UiRequest, mode: ValidationMode)
// : Promise<{ ok: boolean; reason?: string }> {

//   if (!['MAKEUP_LESSON', 'FILL_IN', 'INSTRUCTOR_DAY_OFF', 'NEW_SERIES'].includes(row.requestType)) {
//     return { ok: true };
//   }

//   try {
//     // ---------- INSTRUCTOR_DAY_OFF ----------
//     if (row.requestType === 'INSTRUCTOR_DAY_OFF') {
//       const from = (row.fromDate ?? null)?.slice(0, 10);
//       const to   = (row.toDate ?? row.fromDate ?? null)?.slice(0, 10);
//       if (!from || !to) return { ok: true };

//       // אם בבקשה יש שעות — נבדוק חפיפה לפי שעות.
//       // אם אין שעות — נתייחס לזה כיום מלא (יחסום גם שעות).
//       const p: any = row.payload ?? {};
//       const reqStartHHMM = this.normalizeTimeHHMM(p.requested_start_time ?? p.start_time ?? null);
//       const reqEndHHMM   = this.normalizeTimeHHMM(p.requested_end_time ?? p.end_time ?? null);

//       const hasWindow = !!(reqStartHHMM && reqEndHHMM);
//       const reqStartMin = hasWindow ? this.timeToMinutes(reqStartHHMM!) : 0;
//       const reqEndMin   = hasWindow ? this.timeToMinutes(reqEndHHMM!)   : 24 * 60;

//       const { data, error } = await db
//         .from('farm_days_off')
//         .select('id, reason, day_type, start_date, end_date, start_time, end_time')
//         .eq('is_active', true)
//         .lte('start_date', to)
//         .gte('end_date', from);

//       if (error) {
//         const r = this.handleDbFailure(mode, 'checkFarmDayOffConflict(INSTRUCTOR_DAY_OFF)', error);
//         return r.ok ? { ok: true } : { ok: false, reason: r.reason };
//       }

//       const offs = (data ?? []) as any[];
//       for (const off of offs) {
//         const dayType = String(off.day_type ?? '');

//         if (dayType === 'FULL_DAY') {
//           return {
//             ok: false,
//             reason: `הבקשה נדחתה אוטומטית: יש יום חופש חווה (יום מלא) שחופף לטווח ${from}–${to}${off.reason ? ` (${off.reason})` : ''}.`,
//           };
//         }

//         // שעות בחופש חווה
//         const offStart = this.normalizeTimeHHMM(off.start_time);
//         const offEnd   = this.normalizeTimeHHMM(off.end_time);
//         if (!offStart || !offEnd) {
//           return { ok: false, reason: `הבקשה נדחתה אוטומטית: יום חופש חווה מוגדר לפי שעות אך חסרות שעות במערכת.` };
//         }

//         const offStartMin = this.timeToMinutes(offStart);
//         const offEndMin   = this.timeToMinutes(offEnd);

//         // אם אין שעות בבקשת יום-חופש-מדריך → נחשב כ"יום מלא" ולכן כל שעות חופש חווה חופפות
//         // אם יש שעות בבקשה → בדיקת חפיפה
//         if (!hasWindow || this.overlapsMinutes(reqStartMin, reqEndMin, offStartMin, offEndMin)) {
//           return {
//             ok: false,
//             reason: `הבקשה נדחתה אוטומטית: יש יום חופש חווה שחופף (בתוך הטווח) בין ${offStart}-${offEnd}${off.reason ? ` (${off.reason})` : ''}.`,
//           };
//         }
//       }

//       return { ok: true };
//     }

//     // ---------- MAKEUP / FILL_IN / NEW_SERIES ----------
//     const w = this.getRequestedDateAndWindow(row);
//     if (!w?.date) return { ok: true };

//     const { data, error } = await db
//       .from('farm_days_off')
//       .select('id, reason, day_type, start_date, end_date, start_time, end_time')
//       .eq('is_active', true)
//       .lte('start_date', w.date)
//       .gte('end_date', w.date);

//     if (error) {
//       const r = this.handleDbFailure(mode, 'checkFarmDayOffConflict', error);
//       return r.ok ? { ok: true } : { ok: false, reason: r.reason };
//     }

//     const rows = (data ?? []) as any[];
//     for (const off of rows) {
//       const dayType = String(off.day_type ?? '');

//       if (dayType === 'FULL_DAY') {
//         return {
//           ok: false,
//           reason: `הבקשה נדחתה אוטומטית: יש יום חופש חווה (יום מלא) בתאריך ${w.date}${off.reason ? ` (${off.reason})` : ''}.`,
//         };
//       }

//       const offStart = this.normalizeTimeHHMM(off.start_time);
//       const offEnd   = this.normalizeTimeHHMM(off.end_time);

//       if (!offStart || !offEnd) {
//         return {
//           ok: false,
//           reason: `הבקשה נדחתה אוטומטית: יום חופש חווה בתאריך ${w.date} מוגדר לפי שעות אך חסרות שעות במערכת.`,
//         };
//       }

//       const offStartMin = this.timeToMinutes(offStart);
//       const offEndMin   = this.timeToMinutes(offEnd);

//       if (this.overlapsMinutes(w.startMin, w.endMin, offStartMin, offEndMin)) {
//         return {
//           ok: false,
//           reason: `הבקשה נדחתה אוטומטית: יש יום חופש חווה בתאריך ${w.date} בין ${offStart}-${offEnd}${off.reason ? ` (${off.reason})` : ''}.`,
//         };
//       }
//     }

//     return { ok: true };

//   } catch (e: any) {
//     const r = this.handleDbFailure(mode, 'checkFarmDayOffConflict', e);
//     return r.ok ? { ok: true } : { ok: false, reason: r.reason };
//   }
// }


private shouldValidateInstructor(row: UiRequest): boolean {
  switch (row.requestType) {
    case 'INSTRUCTOR_DAY_OFF':
    case 'CANCEL_OCCURRENCE':
    case 'NEW_SERIES':
    case 'MAKEUP_LESSON':
    case 'FILL_IN':
      return true;
    default:
      return false;
  }
}

// private async checkInstructorActive(db: any, row: UiRequest, mode: ValidationMode)
//   : Promise<{ ok: boolean; reason?: string }> {

//   const instructorId = this.getInstructorIdForRequest(row);
//   if (!instructorId) return { ok: true };

//   try {
//     const { data, error } = await db
//       .from('instructors')
//       .select('status')
//       .eq('id_number', instructorId)
//       .maybeSingle();

//     if (error) {
//       const r = this.handleDbFailure(mode, 'checkInstructorActive', error);
//       return r.ok ? { ok: true } : { ok: false, reason: r.reason };
//     }

//     if (!data) {
//       if (mode === 'auto') return { ok: true };
//       return { ok: false, reason: 'לא נמצא מדריך במערכת' };
//     }

//     const status = (data as any)?.status ?? null;

//     if (status !== 'Active') {
//       return { ok: false, reason: `המדריך אינו פעיל (סטטוס: ${status})` };
//     }

//     return { ok: true };
//   } catch (e: any) {
//     const r = this.handleDbFailure(mode, 'checkInstructorActive', e);
//     return r.ok ? { ok: true } : { ok: false, reason: r.reason };
//   }
// }


// private async checkParentActive(db: any, row: UiRequest, mode: ValidationMode)
//   : Promise<{ ok: boolean; reason?: string }> {

//   const parentUid = this.getParentUidForRequest(row);
//   if (!parentUid) return { ok: true };

//   try {
//     const { data, error } = await db
//       .from('parents')
//       .select('is_active')
//       .eq('uid', parentUid)
//       .maybeSingle();

//     if (error) {
//       const r = this.handleDbFailure(mode, 'checkParentActive', error);
//       return r.ok ? { ok: true } : { ok: false, reason: r.reason };
//     }

//     if ((data as any)?.is_active === false) return { ok: false, reason: 'ההורה אינו פעיל' };
//     return { ok: true };
//   } catch (e: any) {
//     const r = this.handleDbFailure(mode, 'checkParentActive', e);
//     return r.ok ? { ok: true } : { ok: false, reason: r.reason };
//   }
// }


private normalizeTimeToSeconds(t: string | null | undefined): string | null {
  if (!t) return null;
  const s = t.trim();
  if (!s) return null;
  if (s.length === 5) return `${s}:00`;
  return s;
}


private async rejectBySystem(row: UiRequest, reason: string): Promise<boolean> {
  if (!row?.id) return false;

  await ensureTenantContextReady();
  const db = dbTenant();

  const note = (reason || 'בקשה לא תקינה').trim();
  const decidedBy = this.curentUser?.uid ?? null;

  try {
    const { data, error } = await db
      .from('secretarial_requests')
      .update({
        status: 'REJECTED_BY_SYSTEM',
        decided_by_uid: decidedBy,
        decision_note: note,
        decided_at: new Date().toISOString(),
      })
      .eq('id', row.id)
      .eq('status', 'PENDING')
      .select('id')
      .maybeSingle();

    if (error) throw error;

    // אם לא עודכן (מישהו כבר טיפל) - לא לשקר ל-UI
    if (!data) return false;

    this.patchRequestStatus(row.id, 'REJECTED_BY_SYSTEM');
    return true;

  } catch (e) {
    console.error('rejectBySystem failed', e);
    return false;
  }
}
private getRequesterRoleForRequest(row: UiRequest): RequesterRole | null {
  const p: any = row.payload ?? {};
  return (row as any).requesterRole ?? p.requested_by_role ?? p.requestedByRole ?? null;
}

// private async checkRequesterActive(
//   db: any,
//   row: UiRequest,
//   mode: ValidationMode
// ): Promise<{ ok: boolean; reason?: string }> {

//   const uid = row.requesterUid;
// const role = this.getRequesterRoleForRequest(row); 

//   if (!uid || !role) return { ok: true };

//   try {
//     switch (role) {

//       case 'parent': {
//         const { data, error } = await db
//           .from('parents')
//           .select('is_active')
//           .eq('uid', uid)
//           .maybeSingle();

//         if (error) return this.handleDbFailure(mode, 'checkRequesterActive(parent)', error);
//         if (data?.is_active === false) {
//           return { ok: false, reason: 'ההורה שהגיש את הבקשה אינו פעיל' };
//         }
//         return { ok: true };
//       }

//       case 'instructor': {
//         const { data, error } = await db
//           .from('instructors')
//           .select('status')
//           .eq('uid', uid)   // 👈 חשוב: לפי uid, לא id_number
//           .maybeSingle();

//         if (error) return this.handleDbFailure(mode, 'checkRequesterActive(instructor)', error);
//         if (!data) {
//           return mode === 'auto'
//             ? { ok: true }
//             : { ok: false, reason: 'המדריך מגיש הבקשה לא נמצא במערכת' };
//         }
//         if (data.status !== 'Active') {
//           return { ok: false, reason: `המדריך מגיש הבקשה אינו פעיל (סטטוס: ${data.status})` };
//         }
//         return { ok: true };
//       }

//       case 'secretary':
//       case 'manager':
//       case 'admin':
//         return { ok: true };

//       default:
//         return { ok: true };
//     }
//   } catch (e: any) {
//     return this.handleDbFailure(mode, 'checkRequesterActive', e);
//   }
// }
private async openBulkDecisionDialog(
  mode: 'approve' | 'reject',
  rows: UiRequest[]
): Promise<BulkDecisionDialogResult> {
  const items = rows.map(r => ({
    id: r.id,
    requestType: this.getRequestTypeLabel(r.requestType), // ✅ יפה בעברית
    requestedByName: r.requestedByName,
    summary: r.summary,
    childName: r.childName,
    instructorName: r.instructorName,
    createdAt: r.createdAt,
  }));

  const ref = this.dialog.open(BulkDecisionDialogComponent, {
    data: {
      mode,
      title: mode === 'approve' ? 'אישור בקשות מסומנות' : 'דחיית בקשות מסומנות',
      items,
    },
    disableClose: true,
    panelClass: 'ui-bulk-dialog',
    backdropClass: 'ui-confirm-backdrop',
  });

  return (await firstValueFrom(ref.afterClosed())) ?? { confirmed: false };
}
private openBulkRunReportDialog(report: BulkRunReport) {
  this.dialog.open(BulkRunReportDialogComponent, {
    data: report,
    disableClose: false,
    panelClass: 'ui-bulk-report-dialog',
    backdropClass: 'ui-confirm-backdrop',
  });
}

private buildBulkReport(action: 'approve' | 'reject', results: BulkRunItemReport[]): BulkRunReport {
  const systemRejected = results.filter(r => r.kind === 'systemRejected');
  const failed = results.filter(r => r.kind === 'failed');
  const success = results.filter(r => r.kind === 'success');

  return {
    action,
    total: results.length,
    successCount: success.length,
    failedCount: failed.length,
    systemRejectedCount: systemRejected.length,
    results,
    systemRejected,
    failed,
  };
}


}



