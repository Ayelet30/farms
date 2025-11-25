import { Component, OnInit, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

import { MatSidenavModule } from '@angular/material/sidenav';
import { ensureTenantContextReady, dbTenant } from '../services/legacy-compat';
import { RequestStatus, RequestType, SecretarialRequestDbRow, UiRequest } from '../Types/detailes.model';
import { CurrentUserService } from '../core/auth/current-user.service';

@Component({
  selector: 'app-secretarial-requests-page',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatButtonModule, MatSidenavModule],
  templateUrl: './secretarial-requests-page.component.html',
  styleUrls: ['./secretarial-requests-page.component.css'],
})
export class SecretarialRequestsPageComponent implements OnInit {

  private cu = inject(CurrentUserService);
  curentUser = this.cu.current;
  
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
  detailsOpened = false;                 // אם תרצי להשתמש בזה בעתיד
  selectedRequest: UiRequest | null = null;
  indexOfRowSelected: number | null = null;

    get filteredRequestsList(): UiRequest[] {
    const list = this.allRequests();      // סיגנל
    const status = this.statusFilter();   // סיגנל
    const term = this.searchTerm.trim().toLowerCase();
    const type = this.typeFilter;
    const from = this.dateFrom ? new Date(this.dateFrom) : null;
    const to = this.dateTo ? new Date(this.dateTo) : null;

    return list.filter((r) => {
      if (status !== 'ALL' && r.status !== status) return false;
      if (type !== 'ALL' && r.requestType !== type) return false;

      if (from || to) {
        const created = new Date(r.createdAt);
        if (from && created < from) return false;
        if (to) {
          const toEnd = new Date(to);
          toEnd.setHours(23, 59, 59, 999);
          if (created > toEnd) return false;
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

    // מנסים לשלוף פרטים נוחים מה-payload; אם אין – נ fallback
    const requestedByName =
      p.requested_by_name || p.parent_name || p.user_name || '—';
    const childName = p.child_name || null;
    const instructorName = p.instructor_name || null;

    return {
      id: row.id,
      requestType: row.request_type,
      status: row.status,
      createdAt: row.created_at,

      fromDate: row.from_date,
      toDate: row.to_date,

      summary: this.buildSummary(row, p),
      requestedByName,
      childName: childName || undefined,
      instructorName: instructorName || undefined,

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
      default:
        return p.summary || 'בקשה';
    }
  }

  // --------------------------------------------------
  // אינטראקציה עם הטבלה + כרטיס פרטים
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

  // אישור בקשה (כרגע עבור CANCEL_OCCURRENCE)
async approveSelected() {
  const current = this.selectedRequest;
  if (!current) return;

  const db = dbTenant();
  const { data, error } = await db.rpc('approve_secretarial_cancel_request', {
    p_request_id: current.id,
    p_decided_by_uid: this.curentUser!.uid,
    p_decision_note: null,
  });

  if (error) {
    console.error(error);
    // אפשר להראות הודעת שגיאה מתחת לכפתורים
    return;
  }

  // רענון הרשימה
  await this.loadRequestsFromDb();
  this.selectedRequest = null;
}


// דחייה
async rejectSelected() {
  const current = this.selectedRequest;
  if (!current) return;

  const db = dbTenant();
  const { data, error } = await db.rpc('reject_secretarial_request', {
    p_request_id: current.id,
    p_decided_by_uid: this.curentUser!.uid ,
    p_decision_note: null,
  });

  if (error) {
    console.error(error);
    return;
  }

  await this.loadRequestsFromDb();
}

reloadRequests() {
  // לא מנקים פילטרים – רק טוענים מחדש מה־DB
  this.loadRequestsFromDb();
}



}
