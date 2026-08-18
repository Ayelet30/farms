import {
  AfterViewInit,
  Component,
  OnDestroy,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { MatTabsModule } from '@angular/material/tabs';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import {
  MatPaginator,
  MatPaginatorModule,
} from '@angular/material/paginator';

import { HelthAgentService } from '../../services/helth-agent.service';
import { dbTenant } from '../../services/supabaseClient.service';
import {
  ClaimsApiService,
  ClaimOpenItem,
} from '../../services/claims-api.service';
import { SupabaseTenantService } from '../../services/supabase-tenant.service';

type HmoTab = 'CLALIT' | 'MACCABI' | 'MEUHEDET';

type ClaimStatus =
  | 'NONE'
  | 'OPENED_NOT_SUBMITTED'
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED';

type ReportFilter =
  | 'ALL'
  | 'REPORTABLE'
  | 'NOT_REPORTED'
  | 'PENDING'
  | 'RUNNING'
  | 'DONE'
  | 'FAILED'
  | 'BLOCKED';

interface LessonClaimRow {
  id: string;

  lesson_id: string;
  occur_date: string;

  instructor_id: string | null;
  instructorName: string;

  child_id: string;
  childName: string;

  childIdNumber: string | null;
  childFirstName: string | null;
  childLastName: string | null;

  start_time: string | null;
  end_time: string | null;

  attendance_status: string;

  occurred: boolean;
  chargeable: boolean;

  claimOpened: boolean;
  claimSubmitted: boolean;
  claimStatus: ClaimStatus;

  displayStatus: string;
  displayStatusText: string;
  canSelectClaim: boolean;
  automationError: string | null;

  reportMonth: string;
  reportMonthLabel: string;
}

interface FiltersState {
  childText: string;
  instructorText: string;

  occurred: 'ALL' | 'YES' | 'NO';
  chargeable: 'ALL' | 'YES' | 'NO';
  claimStatus: 'ALL' | ClaimStatus;

  dateFrom: string;
  dateTo: string;

  reportState: ReportFilter;
  reportMonth: string;

  missingId: 'ALL' | 'YES' | 'NO';
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
export class ClaimsPageComponent implements AfterViewInit, OnDestroy {
  constructor(
    private claimsApi: ClaimsApiService,
    private tenantSvc: SupabaseTenantService,
    private healthAgent: HelthAgentService
  ) {}

  agentDownloading = false;
agentDownloadError: string | null = null;

private readonly maccabiAgentDownloadUrl =
  'https://aztgdhcvucvpvsmusfpz.supabase.co/storage/v1/object/public/agent-releases/maccabi/1.0.0/MoachMaccabiAgent-Setup-1.0.0.exe';

  activeTab: HmoTab = 'CLALIT';

  agentInstalled = false;
  agentChecking = false;
  agentVersion: string | null = null;

  loading = false;
  loadError: string | null = null;
  sending = false;

  private agentCheckTimer: ReturnType<typeof setInterval> | null = null;

  lessons: LessonClaimRow[] = [];
  dataSource = new MatTableDataSource<LessonClaimRow>([]);

  selectedIds = new Set<string>();

  @ViewChild(MatPaginator) paginator!: MatPaginator;

  filters: FiltersState = this.createDefaultFilters();

  get displayedColumns(): string[] {
    const columns = [
      'select',
      'instructor',
      'child',
      'date',
      'time',
      'occurred',
      'chargeable',
    ];

    if (this.activeTab === 'CLALIT') {
      columns.push('claimOpened');
    }

    columns.push('claimStatus', 'actions');

    return columns;
  }

  async ngAfterViewInit(): Promise<void> {
    await this.tenantSvc.ensureTenantContextReady?.();

    this.dataSource.paginator = this.paginator;

    await this.checkHealthAgent();
    await this.reloadCurrentTab();

    this.agentCheckTimer = setInterval(() => {
      void this.checkHealthAgent();
    }, 15_000);
  }

  ngOnDestroy(): void {
    if (this.agentCheckTimer) {
      clearInterval(this.agentCheckTimer);
      this.agentCheckTimer = null;
    }
  }

  private createDefaultFilters(): FiltersState {
    return {
      childText: '',
      instructorText: '',
      occurred: 'ALL',
      chargeable: 'ALL',
      claimStatus: 'ALL',
      dateFrom: '',
      dateTo: '',
      reportState: 'ALL',
      reportMonth: '',
      missingId: 'ALL',
    };
  }

  async onTabChange(index: number): Promise<void> {
    this.activeTab =
      index === 0
        ? 'CLALIT'
        : index === 1
          ? 'MACCABI'
          : 'MEUHEDET';

    this.selectedIds.clear();
    this.filters = this.createDefaultFilters();

    await this.reloadCurrentTab();
  }

  async checkHealthAgent(): Promise<void> {
    if (this.agentChecking) {
      return;
    }

    this.agentChecking = true;

    try {
      const health = await this.healthAgent.checkHealth();

      this.agentInstalled = Boolean(health?.ok);
      this.agentVersion = health?.version ?? null;
    } catch {
      this.agentInstalled = false;
      this.agentVersion = null;
    } finally {
      this.agentChecking = false;
    }
  }

  async downloadHealthAgent(): Promise<void> {
  if (this.agentDownloading) {
    return;
  }

  this.agentDownloading = true;
  this.agentDownloadError = null;

  try {
    /*
     * בדיקה מקדימה מאפשרת להציג הודעה ברורה אם NetFree,
     * הדפדפן או שרת הקבצים חוסמים את הכתובת.
     */
    const response = await fetch(this.maccabiAgentDownloadUrl, {
      method: 'HEAD',
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(
        `Download file returned HTTP ${response.status}`
      );
    }

    const downloadLink = document.createElement('a');

    downloadLink.href = this.maccabiAgentDownloadUrl;
    downloadLink.target = '_blank';
    downloadLink.rel = 'noopener noreferrer';
    downloadLink.download =
      'MoachMaccabiAgent-Setup-1.0.0.exe';

    document.body.appendChild(downloadLink);
    downloadLink.click();
    downloadLink.remove();
  } catch (error) {
    console.error('downloadHealthAgent failed:', error);

    this.agentDownloadError =
      'לא הצלחנו להתחיל את ההורדה. ייתכן שסינון האינטרנט חסם את קובץ ההתקנה. ניתן לפנות לתמיכה או לנסות שוב.';
  } finally {
    this.agentDownloading = false;
  }
}

  async reloadCurrentTab(): Promise<void> {
    if (this.loading) {
      return;
    }

    this.loading = true;
    this.loadError = null;

    const previousSelected = new Set(this.selectedIds);

    try {
      await this.loadClaimsLessons();
      this.applyFilters();

      const visibleIds = new Set(
        this.dataSource.data.map((row) => row.id)
      );

      this.selectedIds = new Set(
        Array.from(previousSelected).filter((id) => visibleIds.has(id))
      );
    } catch (error) {
      console.error('reloadCurrentTab failed:', error);

      this.loadError = 'לא הצלחנו לטעון את נתוני השיעורים.';
      this.lessons = [];
      this.dataSource.data = [];
      this.selectedIds.clear();
    } finally {
      this.loading = false;
    }
  }

  private async loadClaimsLessons(): Promise<void> {
  const dbc = dbTenant();

  const fromDate = new Date(
    Date.now() - 8 * 7 * 24 * 60 * 60 * 1000
  )
    .toISOString()
    .slice(0, 10);

  const toDate = new Date(
    Date.now() + 8 * 7 * 24 * 60 * 60 * 1000
  )
    .toISOString()
    .slice(0, 10);

  const commonColumns = `
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
  `;

  const maccabiColumns = `,
    child_id_number,
    child_first_name,
    child_last_name,
    display_status,
    display_status_text,
    can_select_claim,
    automation_error
  `;

  const selectedColumns =
    commonColumns +
    (this.activeTab === 'MACCABI'
      ? maccabiColumns
      : '');

  const pageSize = 1000;
  const allRows: any[] = [];

  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const rangeFrom = page * pageSize;
    const rangeTo = rangeFrom + pageSize - 1;

    const { data, error } = await dbc
      .from(this.getViewNameByTab())
      .select(selectedColumns)
      .gte('occur_date', fromDate)
      .lte('occur_date', toDate)
      .order('occur_date', { ascending: false })
      .order('start_time', { ascending: true })
      .order('lesson_id', { ascending: true })
      .range(rangeFrom, rangeTo);

    if (error) {
      throw error;
    }

    const currentRows = data ?? [];

    allRows.push(...currentRows);

    hasMore = currentRows.length === pageSize;
    page++;

    // מנגנון הגנה מפני לולאה בלתי מוגבלת
    if (page >= 20) {
      console.warn(
        'Claims loading stopped after 20,000 rows'
      );

      hasMore = false;
    }
  }

  this.lessons = allRows.map((row: any) =>
    this.mapLessonRow(row)
  );

  const monthDebug = this.lessons.reduce(
  (result, row) => {
    const key = row.reportMonth || 'EMPTY';

    result[key] = (result[key] ?? 0) + 1;

    return result;
  },
  {} as Record<string, number>
);

console.log('CLAIMS MONTH DEBUG:', monthDebug);
console.log('REPORT MONTH OPTIONS:', this.reportMonths);

  this.dataSource.data = this.lessons;

  console.log(
    `Loaded ${this.lessons.length} claims lessons`,
    {
      tab: this.activeTab,
      fromDate,
      toDate,
    }
  );
}

  private mapLessonRow(row: any): LessonClaimRow {
    const lessonId = String(row.lesson_id);
    const occurDate = String(row.occur_date);

    const attendanceStatus = String(
      row.attendance_status ?? 'unknown'
    )
      .trim()
      .toLowerCase();

    const occurred = [
      'present',
      'arrived',
      'attended',
      'yes',
      'הגיע',
      'נכח',
      'בוצע',
    ].includes(attendanceStatus);

    const rawChargeable = Boolean(row.chargeable);
    const chargeable = rawChargeable && occurred;

    const reportMonth = occurDate.slice(0, 7);
    const [year, month] = reportMonth.split('-');

    const childIdNumber = row.child_id_number
      ? String(row.child_id_number)
      : null;

    const displayStatus = String(
      row.display_status ??
        (row.claim_submitted ? 'DONE' : 'NOT_REPORTED')
    );

    const displayStatusText = String(
      row.display_status_text ??
        (row.claim_submitted ? 'דווח' : 'טרם דווח')
    );

    return {
      id: `${lessonId}__${occurDate}`,

      lesson_id: lessonId,
      occur_date: occurDate,

      instructor_id: row.instructor_id
        ? String(row.instructor_id)
        : null,

      instructorName: String(row.instructor_name ?? ''),

      child_id: String(row.child_id),
      childName: String(row.child_name ?? ''),

      childIdNumber,

      childFirstName: row.child_first_name
        ? String(row.child_first_name)
        : null,

      childLastName: row.child_last_name
        ? String(row.child_last_name)
        : null,

      start_time: row.start_time ?? null,
      end_time: row.end_time ?? null,

      attendance_status: String(
        row.attendance_status ?? 'unknown'
      ),

      occurred,
      chargeable,

      claimOpened: Boolean(row.claim_opened),
      claimSubmitted: Boolean(row.claim_submitted),

      claimStatus: (row.claim_status ?? 'NONE') as ClaimStatus,

      displayStatus,
      displayStatusText,

      canSelectClaim:
        this.activeTab === 'MACCABI'
          ? Boolean(row.can_select_claim) && Boolean(childIdNumber)
          : chargeable,

      automationError: row.automation_error
        ? String(row.automation_error)
        : null,

      reportMonth,
      reportMonthLabel: `${month}/${year}`,
    };
  }

  private getViewNameByTab(): string {
    switch (this.activeTab) {
      case 'CLALIT':
        return 'claims_lessons_clalit_v';

      case 'MACCABI':
        return 'claims_lessons_maccabi_v';

      case 'MEUHEDET':
        return 'claims_lessons_meuhedet_v';
    }
  }

  applyFilters(): void {
    const filter = this.filters;

    const normalize = (value: string | null | undefined): string =>
      String(value ?? '')
        .trim()
        .toLowerCase();

    const childSearch = normalize(filter.childText);
    const instructorSearch = normalize(filter.instructorText);

    const filtered = this.lessons.filter((row) => {
      if (
        childSearch &&
        !normalize(row.childName).includes(childSearch) &&
        !normalize(row.childIdNumber).includes(childSearch)
      ) {
        return false;
      }

      if (
        instructorSearch &&
        !normalize(row.instructorName).includes(instructorSearch)
      ) {
        return false;
      }

      if (filter.occurred !== 'ALL') {
        const expected = filter.occurred === 'YES';

        if (row.occurred !== expected) {
          return false;
        }
      }

      if (filter.chargeable !== 'ALL') {
        const expected = filter.chargeable === 'YES';

        if (row.chargeable !== expected) {
          return false;
        }
      }

      if (
        filter.claimStatus !== 'ALL' &&
        row.claimStatus !== filter.claimStatus
      ) {
        return false;
      }

      if (
        filter.reportMonth &&
        row.reportMonth !== filter.reportMonth
      ) {
        return false;
      }

      if (filter.missingId !== 'ALL') {
        const isMissing = !row.childIdNumber;
        const expectedMissing = filter.missingId === 'YES';

        if (isMissing !== expectedMissing) {
          return false;
        }
      }

      if (!this.matchesReportState(row, filter.reportState)) {
        return false;
      }

      if (
        filter.dateFrom &&
        row.occur_date < filter.dateFrom
      ) {
        return false;
      }

      if (
        filter.dateTo &&
        row.occur_date > filter.dateTo
      ) {
        return false;
      }

      return true;
    });

    this.dataSource.data = filtered;

    const filteredIds = new Set(filtered.map((row) => row.id));

    for (const id of Array.from(this.selectedIds)) {
      if (!filteredIds.has(id)) {
        this.selectedIds.delete(id);
      }
    }

    this.paginator?.firstPage();
  }

  private matchesReportState(
    row: LessonClaimRow,
    reportState: ReportFilter
  ): boolean {
    switch (reportState) {
      case 'ALL':
        return true;

      case 'REPORTABLE':
        return this.isRowSelectable(row);

      case 'BLOCKED':
        return !this.isRowSelectable(row);

      case 'PENDING':
        return ['PENDING', 'RUNNING'].includes(row.displayStatus);

      default:
        return row.displayStatus === reportState;
    }
  }

  resetFilters(): void {
    this.filters = this.createDefaultFilters();
    this.applyFilters();
  }

  setReportFilter(value: ReportFilter): void {
    this.filters.reportState =
      this.filters.reportState === value ? 'ALL' : value;

    this.applyFilters();
  }

  isRowSelectable(row: LessonClaimRow): boolean {
    if (!row.occurred || !row.chargeable) {
      return false;
    }

    if (this.activeTab === 'MACCABI') {
      return row.canSelectClaim && Boolean(row.childIdNumber);
    }

    if (this.activeTab === 'CLALIT') {
      return row.claimStatus !== 'APPROVED';
    }

    return true;
  }

  rowBlockReason(row: LessonClaimRow): string {
    if (!row.occurred) {
      return 'השיעור לא סומן כהתקיים';
    }

    if (!row.chargeable) {
      return 'השיעור אינו מחויב לקופה';
    }

    if (
      this.activeTab === 'MACCABI' &&
      !row.childIdNumber
    ) {
      return 'חסרה תעודת זהות לילד';
    }

    if (row.displayStatus === 'DONE') {
      return 'השיעור כבר דווח';
    }

    if (row.displayStatus === 'RUNNING') {
      return 'הדיווח מתבצע כעת';
    }

    if (row.displayStatus === 'PENDING') {
      return 'השיעור ממתין לדיווח';
    }

    return this.isRowSelectable(row)
      ? ''
      : 'לא ניתן לדווח את השיעור';
  }

  get reportableCount(): number {
    return this.lessons.filter((row) =>
      this.isRowSelectable(row)
    ).length;
  }

  get pendingCount(): number {
    return this.lessons.filter((row) =>
      ['PENDING', 'RUNNING'].includes(row.displayStatus)
    ).length;
  }

  get doneCount(): number {
    return this.lessons.filter(
      (row) => row.displayStatus === 'DONE'
    ).length;
  }

  get failedCount(): number {
    return this.lessons.filter(
      (row) => row.displayStatus === 'FAILED'
    ).length;
  }

  get reportMonths(): string[] {
    return [
      ...new Set(this.lessons.map((row) => row.reportMonth)),
    ].sort().reverse();
  }

  reportMonthLabel(value: string): string {
    const [year, month] = value.split('-');
    return `${month}/${year}`;
  }

  get selectedCount(): number {
    return this.selectedIds.size;
  }

  get selectedRows(): LessonClaimRow[] {
    const rowsById = new Map(
      this.lessons.map((row) => [row.id, row])
    );

    return Array.from(this.selectedIds)
      .map((id) => rowsById.get(id))
      .filter((row): row is LessonClaimRow => Boolean(row));
  }

  isSelected(row: LessonClaimRow): boolean {
    return this.selectedIds.has(row.id);
  }

  toggleRow(row: LessonClaimRow, checked: boolean): void {
    if (!this.isRowSelectable(row)) {
      return;
    }

    if (checked) {
      this.selectedIds.add(row.id);
    } else {
      this.selectedIds.delete(row.id);
    }
  }

  getCurrentPageRows(): LessonClaimRow[] {
    const rows = this.dataSource.data ?? [];

    if (!this.paginator) {
      return rows;
    }

    const start =
      this.paginator.pageIndex * this.paginator.pageSize;

    return rows.slice(
      start,
      start + this.paginator.pageSize
    );
  }

  getSelectableRowsInPage(): LessonClaimRow[] {
    return this.getCurrentPageRows().filter((row) =>
      this.isRowSelectable(row)
    );
  }

  isAllSelectedOnPage(): boolean {
    const rows = this.getSelectableRowsInPage();

    return (
      rows.length > 0 &&
      rows.every((row) => this.selectedIds.has(row.id))
    );
  }

  isSomeSelectedOnPage(): boolean {
    const rows = this.getSelectableRowsInPage();

    if (!rows.length) {
      return false;
    }

    const someSelected = rows.some((row) =>
      this.selectedIds.has(row.id)
    );

    return someSelected && !this.isAllSelectedOnPage();
  }

  masterToggle(checked: boolean): void {
    const rows = this.getSelectableRowsInPage();

    for (const row of rows) {
      if (checked) {
        this.selectedIds.add(row.id);
      } else {
        this.selectedIds.delete(row.id);
      }
    }
  }

  selectAllFiltered(): void {
    this.dataSource.data
      .filter((row) => this.isRowSelectable(row))
      .forEach((row) => this.selectedIds.add(row.id));
  }

  clearSelection(): void {
    this.selectedIds.clear();
  }

  get canOpenSelectedClaims(): boolean {
    return this.selectedRows.some(
      (row) =>
        row.chargeable &&
        row.claimStatus === 'NONE'
    );
  }

  async reportSelectedToFundingSource(): Promise<void> {
    if (!this.selectedRows.length || this.sending) {
      return;
    }

    if (
      this.activeTab === 'MACCABI' &&
      !this.agentInstalled
    ) {
      alert('יש להפעיל את תוכנת הדיווח למכבי.');
      return;
    }

    this.sending = true;

    try {
      if (this.activeTab === 'CLALIT') {
        await this.submitSelectedClaims();
        return;
      }

      if (this.activeTab === 'MACCABI') {
        await this.reportToMaccabiAutomation();
        return;
      }

      console.log(
        'דיווח למאוחדת:',
        this.selectedRows
      );
    } finally {
      this.sending = false;
    }
  }

  private async reportToMaccabiAutomation(): Promise<void> {
    const tenant = this.tenantSvc.requireTenant();

    const selectedRows = this.selectedRows.filter((row) =>
      this.isRowSelectable(row)
    );

    if (!selectedRows.length) {
      alert('לא נבחרו שיעורים שניתן לדווח.');
      return;
    }

    const grouped = new Map<string, any>();

    for (const row of selectedRows) {
      const reportMonth = row.occur_date.slice(0, 7);
      const key = `${reportMonth}__${row.childIdNumber}`;

      if (!grouped.has(key)) {
        grouped.set(key, {
          reportMonth,
          child_id: row.child_id,
          child_name: row.childName,
          child_id_number: row.childIdNumber,
          child_first_name: row.childFirstName,
          child_last_name: row.childLastName,
          lessons: [],
        });
      }

      grouped.get(key).lessons.push({
        lesson_id: row.lesson_id,
        occur_date: row.occur_date,
        start_time: row.start_time,
        end_time: row.end_time,
        instructor_id: row.instructor_id,
        instructor_name: row.instructorName,
        attendance_status: row.attendance_status,
        chargeable: row.chargeable,
      });
    }

    const response = await fetch(
      '/api/createMaccabiAutomationJob',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          schema: tenant.schema,
          groups: Array.from(grouped.values()),
        }),
      }
    );

    const result = await response.json();

    if (!response.ok || !result?.ok) {
      console.error(
        'createMaccabiAutomationJob failed:',
        result
      );

      alert(
        result?.message ??
          'שגיאה ביצירת משימת הדיווח למכבי.'
      );

      return;
    }

    alert(
      `המשימה נשלחה לאוטומציה.\nמספר משימה: ${result.jobId}`
    );

    this.selectedIds.clear();
    await this.reloadCurrentTab();
  }

  async openSelectedClaims(): Promise<void> {
    const tenant = this.tenantSvc.requireTenant();

    const targets = this.selectedRows.filter(
      (row) =>
        row.chargeable &&
        row.claimStatus === 'NONE'
    );

    if (!targets.length) {
      return;
    }

    const items: ClaimOpenItem[] = targets.map((row) => ({
      lesson_id: row.lesson_id,
      occur_date: row.occur_date,

      // TODO: להחליף בשליפה מה־DB.
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
      const result = await this.claimsApi.openClaimsClalit({
        schema: tenant.schema,
        items,
      });

      const failed =
        result.results?.filter((item) => !item.ok) ?? [];

      if (failed.length) {
        console.warn('Claims failed:', failed);
        alert(
          `${failed.length} תביעות לא נפתחו. הפרטים הודפסו בקונסול.`
        );
      }
    } catch (error) {
      console.error('openClaimsClalit failed:', error);
      alert('אירעה שגיאה בפתיחת התביעות.');
    }

    await this.reloadCurrentTab();
  }

  async submitSelectedClaims(): Promise<void> {
    const dbc = dbTenant();

    const targets = this.selectedRows.filter(
      (row) =>
        row.chargeable &&
        (
          row.claimStatus === 'OPENED_NOT_SUBMITTED' ||
          row.claimStatus === 'REJECTED'
        )
    );

    if (!targets.length) {
      return;
    }

    for (const row of targets) {
      const { error } = await dbc.rpc(
        'submit_lesson_claim_clalit',
        {
          p_lesson_id: row.lesson_id,
          p_occur_date: row.occur_date,
        }
      );

      if (error) {
        console.error(
          'submit_lesson_claim_clalit failed:',
          row,
          error
        );
      }
    }

    this.selectedIds.clear();
    await this.reloadCurrentTab();
  }

  canDeleteClaimRow(row: LessonClaimRow): boolean {
    return (
      this.activeTab === 'CLALIT' &&
      row.claimOpened &&
      (
        row.claimStatus === 'OPENED_NOT_SUBMITTED' ||
        row.claimStatus === 'REJECTED'
      )
    );
  }

  async deleteClaimRow(
    row: LessonClaimRow
  ): Promise<void> {
    if (!this.canDeleteClaimRow(row)) {
      return;
    }

    const confirmed = window.confirm(
      `למחוק את התביעה של ${row.childName} מתאריך ${row.occur_date}?`
    );

    if (!confirmed) {
      return;
    }

    const dbc = dbTenant();

    const { error } = await dbc.rpc(
      'delete_lesson_claim_clalit',
      {
        p_lesson_id: row.lesson_id,
        p_occur_date: row.occur_date,
      }
    );

    if (error) {
      console.error(
        'delete_lesson_claim_clalit failed:',
        row,
        error
      );

      alert('מחיקת התביעה נכשלה.');
      return;
    }

    this.selectedIds.delete(row.id);
    await this.reloadCurrentTab();
  }

  statusLabel(status: ClaimStatus): string {
    switch (status) {
      case 'NONE':
        return 'ללא תביעה';

      case 'OPENED_NOT_SUBMITTED':
        return 'נפתחה ולא הוגשה';

      case 'PENDING':
        return 'הוגשה וממתינה';

      case 'APPROVED':
        return 'אושרה';

      case 'REJECTED':
        return 'נדחתה';
    }
  }

  statusClass(status: ClaimStatus): string {
    switch (status) {
      case 'NONE':
        return 'st-none';

      case 'OPENED_NOT_SUBMITTED':
        return 'st-opened';

      case 'PENDING':
        return 'st-pending';

      case 'APPROVED':
        return 'st-approved';

      case 'REJECTED':
        return 'st-rejected';
    }
  }

  displayStatusClass(status: string): string {
    return `st-${status.toLowerCase()}`;
  }
}