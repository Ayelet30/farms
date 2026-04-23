import { Component, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { MatTabsModule } from '@angular/material/tabs';
import { MatTableModule } from '@angular/material/table';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatPaginatorModule, MatPaginator } from '@angular/material/paginator';
import { MatTableDataSource } from '@angular/material/table';

import { dbTenant, ensureTenantContextReady } from '../../services/supabaseClient.service';
import { ClaimsApiService, ClaimOpenItem } from '../../services/claims-api.service';
import { SupabaseTenantService } from '../../services/supabase-tenant.service';

type HmoTab = 'CLALIT' | 'MACCABI' | 'MEUHEDET';
type ClaimStatus = 'NONE' | 'OPENED_NOT_SUBMITTED' | 'PENDING' | 'APPROVED' | 'REJECTED';

interface LessonClaimRow {
  id: string; // `${lesson_id}__${occur_date}`

  lesson_id: string;
  occur_date: string;

  instructor_id: string | null;
  instructorName: string;

  child_id: string;
  childName: string;

  start_time: string | null;
  end_time: string | null;

  attendance_status: string;

  occurred: boolean;
  chargeable: boolean;

  claimOpened: boolean;
  claimSubmitted: boolean;
  claimStatus: ClaimStatus;
}

interface FiltersState {
  childText: string;
  instructorText: string;
  occurred: 'ALL' | 'YES' | 'NO';
  chargeable: 'ALL' | 'YES' | 'NO';
  claimStatus: 'ALL' | ClaimStatus;
  dateFrom: string; // YYYY-MM-DD
  dateTo: string;   // YYYY-MM-DD
}

@Component({
  selector: 'app-claims-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatTabsModule,
    MatTableModule,
    MatCheckboxModule,
    MatSelectModule,
    MatInputModule,
    MatButtonModule,
    MatPaginatorModule,
  ],
  templateUrl: './claims-page.component.html',
  styleUrls: ['./claims-page.component.scss'],
})
export class ClaimsPageComponent implements AfterViewInit {
  constructor(private claimsApi: ClaimsApiService,
              private tenantSvc: SupabaseTenantService
  ) {}

  activeTab: HmoTab = 'CLALIT';

  displayedColumns: string[] = [
    'select',
    'instructor',
    'child',
    'date',
    'time',
    'occurred',
    'chargeable',
    'claimOpened',
    'claimStatus',
    'actions',
  ];

  lessons: LessonClaimRow[] = [];
  dataSource = new MatTableDataSource<LessonClaimRow>([]);

  @ViewChild(MatPaginator) paginator!: MatPaginator;

  selectedIds = new Set<string>();

  filters: FiltersState = {
    childText: '',
    instructorText: '',
    occurred: 'ALL',
    chargeable: 'ALL',
    claimStatus: 'ALL',
    dateFrom: '',
    dateTo: '',
  };

  async ngAfterViewInit() {
    await this.tenantSvc.ensureTenantContextReady?.();
    this.dataSource.paginator = this.paginator;
    await this.reloadClalit();
  }

  // =========================================
  // טעינה
  // =========================================
  private async reloadClalit() {
    const prevSelected = new Set(this.selectedIds);

    await this.loadClaimsLessonsClalit();
    this.applyFilters();

    const visibleIds = new Set(this.dataSource.data.map(r => r.id));
    this.selectedIds = new Set(Array.from(prevSelected).filter(id => visibleIds.has(id)));
  }

  private async loadClaimsLessonsClalit() {
    const dbc = dbTenant();

    const fromDate = new Date(Date.now() - 8 * 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const toDate   = new Date(Date.now() + 8 * 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);

    const { data, error } = await dbc
      .from('claims_lessons_clalit_v')
      .select(`
        lesson_id,
        occur_date,
        child_id,
        child_name,
        instructor_id,
        instructor_name,
        start_time,
        end_time,
        attendance_status,
        chargeable,
        claim_opened,
        claim_submitted,
        claim_status
      `)
      .gte('occur_date', fromDate)
      .lte('occur_date', toDate)
      .order('occur_date', { ascending: true })
      .order('start_time', { ascending: true });

    if (error) {
      console.error('Error loading claims lessons:', error);
      this.lessons = [];
      this.dataSource.data = [];
      return;
    }

    const rows = (data ?? []) as any[];

    const mapped: LessonClaimRow[] = rows.map((r: any) => {
      const lesson_id = String(r.lesson_id);
      const occur_date = String(r.occur_date);

      const att = String(r.attendance_status ?? 'unknown').toLowerCase();
      const occurred = ['present', 'arrived', 'attended', 'yes'].includes(att);

      const chargeable = Boolean(r.chargeable) && occurred;
      const claimStatus = (r.claim_status ?? 'NONE') as ClaimStatus;

      return {
        id: `${lesson_id}__${occur_date}`,
        lesson_id,
        occur_date,

        instructor_id: r.instructor_id ? String(r.instructor_id) : null,
        instructorName: String(r.instructor_name ?? ''),

        child_id: String(r.child_id),
        childName: String(r.child_name ?? ''),

        start_time: r.start_time ?? null,
        end_time: r.end_time ?? null,

        attendance_status: String(r.attendance_status ?? 'unknown'),
        occurred,
        chargeable,

        claimOpened: Boolean(r.claim_opened),
        claimSubmitted: Boolean(r.claim_submitted),
        claimStatus,
      };
    });

    this.lessons = mapped;
    this.dataSource.data = mapped;
  }

  // =========================================
  // סינון
  // =========================================
  applyFilters() {
    const f = this.filters;
    const norm = (s: string) => (s || '').trim().toLowerCase();

    const childQ = norm(f.childText);
    const instQ = norm(f.instructorText);

    const from = f.dateFrom ? new Date(f.dateFrom) : null;
    const to = f.dateTo ? new Date(f.dateTo) : null;

    const filtered = this.lessons.filter((r) => {
      if (childQ && !norm(r.childName).includes(childQ)) return false;
      if (instQ && !norm(r.instructorName).includes(instQ)) return false;

      if (f.occurred !== 'ALL') {
        const want = f.occurred === 'YES';
        if (r.occurred !== want) return false;
      }

      if (f.chargeable !== 'ALL') {
        const want = f.chargeable === 'YES';
        if (r.chargeable !== want) return false;
      }

      if (f.claimStatus !== 'ALL') {
        if (r.claimStatus !== f.claimStatus) return false;
      }

      if (from) {
        const d = new Date(r.occur_date);
        if (d < from) return false;
      }
      if (to) {
        const d = new Date(r.occur_date);
        if (d > to) return false;
      }

      return true;
    });

    this.dataSource.data = filtered;

    const visibleIds = new Set(filtered.map(x => x.id));
    for (const id of Array.from(this.selectedIds)) {
      if (!visibleIds.has(id)) this.selectedIds.delete(id);
    }

    if (this.paginator) this.paginator.firstPage();
  }

  resetFilters() {
    this.filters = {
      childText: '',
      instructorText: '',
      occurred: 'ALL',
      chargeable: 'ALL',
      claimStatus: 'ALL',
      dateFrom: '',
      dateTo: '',
    };
    this.applyFilters();
  }

  // =========================================
  // בחירה
  // =========================================
  isRowSelectable(row: LessonClaimRow): boolean {
    return row.chargeable && row.claimStatus !== 'APPROVED';
  }

  isSelected(row: LessonClaimRow): boolean {
    return this.selectedIds.has(row.id);
  }

  toggleRow(row: LessonClaimRow, checked: boolean) {
    if (!this.isRowSelectable(row)) return;
    checked ? this.selectedIds.add(row.id) : this.selectedIds.delete(row.id);
  }

  getCurrentPageRows(): LessonClaimRow[] {
    const data = this.dataSource.data || [];
    if (!this.paginator) return data;
    const start = this.paginator.pageIndex * this.paginator.pageSize;
    return data.slice(start, start + this.paginator.pageSize);
  }

  getSelectableRowsInPage(): LessonClaimRow[] {
    return this.getCurrentPageRows().filter(r => this.isRowSelectable(r));
  }

  isAllSelectedOnPage(): boolean {
    const rows = this.getSelectableRowsInPage();
    return rows.length > 0 && rows.every(r => this.selectedIds.has(r.id));
  }

  isSomeSelectedOnPage(): boolean {
    const rows = this.getSelectableRowsInPage();
    if (rows.length === 0) return false;
    const any = rows.some(r => this.selectedIds.has(r.id));
    return any && !this.isAllSelectedOnPage();
  }

  masterToggle(checked: boolean) {
    const rows = this.getSelectableRowsInPage();
    for (const r of rows) checked ? this.selectedIds.add(r.id) : this.selectedIds.delete(r.id);
  }

  // =========================================
  // תנאי כפתורים
  // =========================================
  get selectedRows(): LessonClaimRow[] {
    const map = new Map(this.lessons.map(r => [r.id, r]));
    return Array.from(this.selectedIds)
      .map(id => map.get(id))
      .filter((x): x is LessonClaimRow => !!x);
  }

  get canOpenSelectedClaims(): boolean {
    return this.selectedRows.some(r => r.chargeable && r.claimStatus === 'NONE');
  }

  get canSubmitSelectedClaims(): boolean {
    return this.selectedRows.some(r =>
      r.chargeable && (r.claimStatus === 'OPENED_NOT_SUBMITTED' || r.claimStatus === 'REJECTED')
    );
  }

  // =========================================
  // פתיחת תביעה דרך Firebase
  // =========================================
  async openSelectedClaims() {

    const tenant = this.tenantSvc.requireTenant();
    const tenantSchema = tenant.schema;
    const tenantId = tenant.id;

    const targets = this.selectedRows.filter(r => r.chargeable && r.claimStatus === 'NONE');
    if (!targets.length) return;

    // TODO: כרגע דמו סטטי. בהמשך נשלוף מה-DB לפי lesson_id/occur_date
    const schema = tenantSchema; 
    const items: ClaimOpenItem[] = targets.map(r => ({
      lesson_id: r.lesson_id,
      occur_date: r.occur_date,

      insuredId: '333570000',
      insuredFirstName: 'איל',
      insuredLastName: 'בדיר',

      sectionCode: 10022,
      careCode: 1,
      careDate: '13052020',
      doctorId: 99425,

      clinicId: 0,
      onlineServiceType: 0,
    }));

    try {
      const res = await this.claimsApi.openClaimsClalit({ schema, items });

      const bad = res.results?.filter(x => !x.ok) ?? [];
      if (bad.length) {
        console.warn('FAILED ITEMS:', bad.map(x => ({
          lesson_id: x.lesson_id,
          occur_date: x.occur_date,
          resultCode: x.resultCode,
          errorDescription: x.errorDescription,
          answerDetails: x.answerDetails,
        })));
      }

    } catch (e: any) {
      console.error('openClaimsClalit failed:', {
        code: e?.code,
        message: e?.message,
        details: e?.details,
      });
    }

    await this.reloadClalit();
  }

  // =========================================
  // עדיין RPC (בינתיים)
  // =========================================
  async submitSelectedClaims() {
    const dbc = dbTenant();
    const targets = this.selectedRows.filter(r =>
      r.chargeable && (r.claimStatus === 'OPENED_NOT_SUBMITTED' || r.claimStatus === 'REJECTED')
    );
    if (!targets.length) return;

    for (const row of targets) {
      const { error } = await dbc.rpc('submit_lesson_claim_clalit', {
        p_lesson_id: row.lesson_id,
        p_occur_date: row.occur_date,
      });
      if (error) console.error('submit_lesson_claim_clalit failed:', row, error);
    }

    await this.reloadClalit();
  }

  canDeleteClaimRow(row: LessonClaimRow): boolean {
    return row.claimOpened && (row.claimStatus === 'OPENED_NOT_SUBMITTED' || row.claimStatus === 'REJECTED');
  }

  async deleteClaimRow(row: LessonClaimRow) {
    if (!this.canDeleteClaimRow(row)) return;

    const dbc = dbTenant();
    const { error } = await dbc.rpc('delete_lesson_claim_clalit', {
      p_lesson_id: row.lesson_id,
      p_occur_date: row.occur_date,
    });

    if (error) {
      console.error('delete_lesson_claim_clalit failed:', row, error);
      return;
    }

    this.selectedIds.delete(row.id);
    await this.reloadClalit();
  }

  markChargeable(_row: LessonClaimRow) {}

  statusLabel(s: ClaimStatus): string {
    switch (s) {
      case 'NONE': return 'ללא';
      case 'OPENED_NOT_SUBMITTED': return 'נפתחה (לא הוגשה)';
      case 'PENDING': return 'הוגשה - ממתינה';
      case 'APPROVED': return 'אושרה';
      case 'REJECTED': return 'נדחתה';
    }
  }

  statusClass(s: ClaimStatus): string {
    switch (s) {
      case 'NONE': return 'st-none';
      case 'OPENED_NOT_SUBMITTED': return 'st-opened';
      case 'PENDING': return 'st-pending';
      case 'APPROVED': return 'st-approved';
      case 'REJECTED': return 'st-rejected';
    }
  }
}
