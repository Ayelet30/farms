import {
  Component,
  OnInit,
  ViewChild,
  HostListener,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatSidenav, MatSidenavModule } from '@angular/material/sidenav';
import {
  ensureTenantContextReady,
  dbTenant,
  getSupabaseClient,
  getCurrentFarmMetaSync,
} from '../../services/legacy-compat';
import type { ChildRow } from '../../Types/detailes.model';
import { UiDialogService } from '../../services/ui-dialog.service';
import { Router, RouterModule } from '@angular/router';
import {
  MatDialog,
  MatDialogModule,
  MAT_DIALOG_DATA,
} from '@angular/material/dialog';
import {
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
  AbstractControl,
  ValidationErrors,
} from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { AddChildWizardComponent } from '../add-child-wizard/add-child-wizard.component';
import { ActivatedRoute } from '@angular/router';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

type SeriesDocRow = {
  lessonId: string;
  lessonType: string | null;
  dayOfWeek: string | null;
  startTime: string | null;
  endTime: string | null;
  anchorWeekStart: string | null;
  seriesEndDate: string | null;
  isOpenEnded: boolean | null;
  status: string | null;
  paymentDocsUrl: string | null;
  paymentPlanId: string | null;
  requiredDocs: string[];
  requireDocsAtBooking: boolean | null;
  instructorId: string | null;
  instructorName: string | null;
};

type ParentBrief = {
  uid: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
};


type ChildDetails = {
  child_uuid?: string;
  first_name?: string;
  last_name?: string;
  parent_uid?: string | null;
  gov_id?: string | null;
  birth_date?: string | null;
  gender?: string | null;
  funding_source_id?: string | null;
  status?: string | null;
  medical_notes?: string | null;
  behavior_notes?: string | null;
  parent?: ParentBrief | null;
  created_at?: string | null;
  updated_at?: string | null;
  deletion_requested_at?: string | null;
  scheduled_deletion_at?: string | null;
  deletion_note?: string | null;
};

type ChildDocumentRow = {
  id: string;
  childId: string;
  documentName: string;
  bucket: string;
  filePath: string;
  fileUrl: string | null;
  mimeType: string | null;
  fileSize: number | null;
  createdAt: string;
};

type HorseLite = {
  id: string;
  name: string;
  is_active: boolean;
};

type TermsSignatureRow = {
  signed_pdf_bucket: string | null;
  signed_pdf_path: string | null;
  created_at: string | null;
};

type ChildColumnKey =
  | 'first_name'
  | 'last_name'
  | 'gov_id'
  | 'birth_date'
  | 'gender'
  | 'funding_source_id'
  | 'status'
  | 'parent_status'
  | 'created_at'
  | 'updated_at';

type ChildColumnDef = {
  key: ChildColumnKey;
  label: string;
  visible: boolean;
};

type TermsFilter = 'all' | 'signed' | 'missing';
type IntakeFilter = 'all' | 'exists' | 'missing';
type ReferralFilter = 'all' | 'exists' | 'missing';
type SeriesFilter = 'all' | 'active' | 'none';
type MissingDocsFilter = 'all' | 'missing' | 'complete';

type SavedChildrenFilter = {
  name: string;
  filters: any;
  statusFilter: 'all' | 'active' | 'inactive' | 'pending';
  parentFilter: 'all' | 'withParent' | 'withoutParent';
};


@Component({
  selector: 'app-secretary-children',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatSidenavModule,
    MatDialogModule,
    AddChildWizardComponent,
    RouterModule,
  ],
  templateUrl: './secretary-children.component.html',
  styleUrls: ['./secretary-children.component.css'],
})
export class SecretaryChildrenComponent implements OnInit {
  readonly MAX_NAME_LEN = 20;
  readonly MAX_MEDICAL_NOTES = 300;
  readonly MAX_BEHAVIOR_NOTES = 300;

  healthFunds: { id: string; name: string }[] = [];
  readonly statusOptions = [
    { value: 'Active', label: 'פעיל' },
    { value: 'Deleted', label: 'לא פעיל' },
  ];

  advancedFilters = {
    terms: 'all' as TermsFilter,
    intake: 'all' as IntakeFilter,

    healthFundId: 'all',
    gender: 'all',

    birthFrom: '',
    birthTo: '',

    entryFrom: '',
    entryTo: '',

    termsFrom: '',
    termsTo: '',

    lessonFrom: '',
    lessonTo: '',

    instructorId: 'all',
    lessonType: 'all',
    lessonDay: 'all',

    series: 'all' as SeriesFilter,
    referral: 'all' as ReferralFilter,
    missingDocs: 'all' as MissingDocsFilter,
  };

  instructors: { id_number: string; first_name?: string | null; last_name?: string | null; name?: string | null }[] = [];
  lessonTypes: string[] = [];
  lessonDays: string[] = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

  termsByChild: Record<string, { signed: boolean; signedAt: string | null }> = {};
  intakeByChild: Record<string, boolean> = {};

  lessonMetaByChild: Record<string, {
    instructorIds: string[];
    lessonTypes: string[];
    days: string[];
    hasActiveSeries: boolean;
    hasReferral: boolean;
    missingReferral: boolean;
    missingRequiredDocs: boolean;
    lessonDates: string[];
  }> = {};

  savedFilters: SavedChildrenFilter[] = [];
  readonly FILTERS_STORAGE_KEY = 'secretary_children_saved_filters';

  readonly STORAGE_KEY = 'secretary_children_table_prefs';

  columns: ChildColumnDef[] = [
    { key: 'first_name', label: 'שם פרטי', visible: true },
    { key: 'last_name', label: 'שם משפחה', visible: true },
    { key: 'gov_id', label: 'תעודת זהות', visible: true },
    { key: 'birth_date', label: 'תאריך לידה', visible: false },
    { key: 'gender', label: 'מין', visible: false },
    { key: 'funding_source_id', label: 'קופת חולים', visible: false }, { key: 'status', label: 'סטטוס', visible: true },
    { key: 'parent_status', label: 'שיוך להורה', visible: true },
    { key: 'created_at', label: 'כניסה למערכת', visible: false },
    { key: 'updated_at', label: 'שינוי אחרון', visible: false },
  ];

  stats = {
    total: 0,
    filtered: 0,
    activeChildren: 0,
    inactiveChildren: 0,
    withParent: 0,
    withoutParent: 0,
  };

  children: ChildRow[] = [];
  isLoading = true;
  error: string | null = null;

  @ViewChild('drawer') drawer!: MatSidenav;

  childDocsLoading = false;
  childDocsError: string | null = null;
  childDocs: ChildDocumentRow[] = [];
  allChildDocs: ChildDocumentRow[] = [];
  uploadingChildDoc = false;
  newChildDocName = '';

  selectedId: string | null = null;
  drawerLoading = false;
  drawerChild: ChildDetails | null = null;

  childForm: FormGroup | null = null;
  editMode = false;
  private originalChild: ChildDetails | null = null;

  searchText = '';
  searchMode: 'name' | 'id' = 'name';
  statusFilter: 'all' | 'active' | 'inactive' | 'pending' = 'all';
  parentFilter: 'all' | 'withParent' | 'withoutParent' = 'all';
  showSearchPanel = false;
  showColumnsPanel = false;
  panelFocus: 'search' | 'filter' = 'search';
  showAddChildWizard = false;

  horses: HorseLite[] = [];
  childHorses: Record<string, string[]> = {};
  savingChildHorses: Record<string, boolean> = {};

  termsLoading = false;
  termsBucket: string | null = null;
  termsPath: string | null = null;
  termsCreatedAt: string | null = null;

  seriesDocsLoading = false;
  seriesDocsError: string | null = null;
  seriesDocs: SeriesDocRow[] = [];


  uploadingSeriesDocLessonId: string | null = null;
  constructor(
    private ui: UiDialogService,
    private fb: FormBuilder,
    private dialog: MatDialog,
    private sanitizer: DomSanitizer,
    private router: Router,
    private route: ActivatedRoute,
  ) { }

  async ngOnInit(): Promise<void> {
    try {
      this.loadTablePrefs();
      await ensureTenantContextReady();
      await this.loadFundingSources();
      await this.loadChildren();
      await this.loadFilterLookups();
      this.loadSavedFilters();
      const childId = this.route.snapshot.queryParamMap.get('childId');
      if (childId) {
        setTimeout(() => this.openDetails(childId), 0);
      }
      this.updateStats();
    } catch (e: any) {
      this.error =
        'Failed to initialize tenant context or load children: ' +
        (e?.message ?? e);
      this.isLoading = false;
      console.error(e);
    }
  }

  @HostListener('document:click')
  closePanelsOnOutsideClick() {
    this.showSearchPanel = false;
    this.showColumnsPanel = false;
  }

  get visibleColumns(): ChildColumnDef[] {
    return this.columns.filter((c) => c.visible);
  }

  private hebrewNameValidator(): (c: AbstractControl) => ValidationErrors | null {
    const re = /^[\u0590-\u05FF\s'"\-]+$/;
    return (c: AbstractControl) => {
      const v = String(c.value ?? '').trim();
      if (!v) return null;
      return re.test(v) ? null : { hebrewName: true };
    };
  }

  isActiveStatus(status: string | null | undefined): boolean {
    return String(status ?? '').toLowerCase() === 'active';
  }

  goToChildLessonsHistory() {
    if (!this.drawerChild?.child_uuid) {
      this.ui.alert('לא ניתן לעבור להיסטוריית שיעורים – ילד לא מזוהה', 'שיעורים');
      return;
    }

    this.router.navigate(['/secretary/monthly-summary'], {
      queryParams: {
        childId: this.drawerChild.child_uuid,
        fromChild: true,
      },
    });
  }

  goToParentPaymentsFromChild() {
    const parentUid = this.drawerChild?.parent_uid;
    if (!parentUid) {
      this.ui.alert(
        'לילד הזה אין הורה משויך, לכן אין אפשרות לסנן תשלומים.',
        'תשלומים'
      );
      return;
    }

    this.router.navigate(['/secretary/payments'], {
      queryParams: { parentUid },
    });
  }

  private async dbc() {
    await ensureTenantContextReady();
    const dbc = dbTenant();
    if (!dbc) throw new Error('dbTenant() returned undefined - tenant not ready');
    return dbc;
  }

  async loadChildren(): Promise<void> {
    this.isLoading = true;
    this.error = null;

    try {
      const db = await this.dbc();

      const { data, error } = await db
        .from('children')
        .select(`
          child_uuid,
          first_name,
          last_name,
          parent_uid,
          gov_id,
          birth_date,
          gender,
          funding_source_id,
          status,
          created_at,
          updated_at,deletion_requested_at,
scheduled_deletion_at,deletion_note
        `)
        .order('first_name', { ascending: true })
        .order('last_name', { ascending: true });

      if (error) throw error;

      this.children = (data ?? []) as ChildRow[];
      this.updateStats();
    } catch (e: any) {
      this.error = e?.message ?? 'Failed to fetch children.';
      this.children = [];
      console.error(e);
    } finally {
      this.isLoading = false;
      await this.loadHorsesAndChildMapping();
    }
  }

  private async loadHorsesAndChildMapping(): Promise<void> {
    try {
      const db = await this.dbc();

      const { data: horsesData, error: horsesErr } = await db
        .from('horses')
        .select('id, name, is_active')
        .order('name', { ascending: true });

      if (horsesErr) {
        console.error('loadHorses error:', horsesErr);
        this.horses = [];
      } else {
        this.horses = (horsesData ?? []) as HorseLite[];
      }

      const childIds = this.children
        .map((c) => (c as any).child_uuid)
        .filter(Boolean) as string[];

      if (!childIds.length) return;

      const { data: mappingData, error: mapErr } = await db
        .from('child_horses')
        .select('child_id, horse_id')
        .in('child_id', childIds);

      if (mapErr) {
        console.error('loadChildHorses mapping error:', mapErr);
        return;
      }

      const mapping: Record<string, string[]> = {};
      for (const row of mappingData ?? []) {
        const cid = (row as any).child_id as string;
        const hid = (row as any).horse_id as string;
        if (!mapping[cid]) mapping[cid] = [];
        if (!mapping[cid].includes(hid)) mapping[cid].push(hid);
      }
      this.childHorses = mapping;
    } catch (e) {
      console.error('loadHorsesAndChildMapping fatal:', e);
    }
  }
  async uploadSeriesReferral(
    event: Event,
    lessonId: string,
  ): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) return;
    if (!this.isAllowedReferralFile(file)) {
      await this.ui.alert(
        'ניתן להעלות רק קובצי PDF או תמונות (PNG/JPG/WEBP).',
        'קובץ לא נתמך'
      );
      input.value = '';
      return;
    }

    try {
      this.uploadingSeriesDocLessonId = lessonId;

      const db = await this.dbc();
      const client = getSupabaseClient();

      const fileExt = file.name.split('.').pop()?.toLowerCase() || 'pdf';
      const safeExt = fileExt || 'pdf';
      const fileName = `${lessonId}-${Date.now()}.${safeExt}`;

      // אפשר לשנות את שם הבאקט לפי מה שיש אצלך בפועל
      const bucketName = 'referrals';
      const filePath = `series-referrals/${fileName}`;

      const { error: uploadError } = await client.storage
        .from(bucketName)
        .upload(filePath, file, {
          upsert: true,
          contentType: file.type || undefined,
        });

      if (uploadError) throw uploadError;

      const { data: publicData } = client.storage
        .from(bucketName)
        .getPublicUrl(filePath);

      const publicUrl = publicData?.publicUrl;
      if (!publicUrl) {
        throw new Error('לא נוצר URL למסמך שהועלה');
      }

      const { error: updateError } = await db
        .from('lessons')
        .update({
          payment_docs_url: publicUrl,
        })
        .eq('id', lessonId);

      if (updateError) throw updateError;

      this.seriesDocs = this.seriesDocs.map((row) =>
        row.lessonId === lessonId
          ? { ...row, paymentDocsUrl: publicUrl }
          : row
      );

      await this.ui.alert('ההפניה הועלתה ונשמרה בהצלחה.', 'העלאת הפניה');
    } catch (e: any) {
      console.error('uploadSeriesReferral error:', e);
      await this.ui.alert(
        'העלאת ההפניה נכשלה: ' + (e?.message ?? e),
        'שגיאה'
      );
    } finally {
      this.uploadingSeriesDocLessonId = null;
      input.value = '';
    }
  }
  private isAllowedReferralFile(file: File): boolean {
    const allowedMimeTypes = [
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/jpg',
      'image/webp',
    ];

    return allowedMimeTypes.includes(file.type);
  }
  get filteredChildren(): ChildRow[] {
    let rows = [...this.children];

    const raw = (this.searchText || '').trim();

    if (raw) {
      if (this.searchMode === 'name') {
        const q = raw.toLowerCase();
        rows = rows.filter((c: any) => {
          const hay = `${c.first_name || ''} ${c.last_name || ''}`.toLowerCase();
          return hay.includes(q);
        });
      } else {
        const qId = raw.replace(/\s/g, '');
        rows = rows.filter((c: any) => {
          const id = (c.gov_id || '').toString().replace(/\s/g, '');
          return qId !== '' && id.startsWith(qId);
        });
      }
    }

    if (this.statusFilter !== 'all') {
      rows = rows.filter((c: any) => {
        const status = String(c.status ?? '').toLowerCase();

        if (this.statusFilter === 'active') {
          return status === 'active';
        }

        if (this.statusFilter === 'inactive') {
          return status === 'deleted' || status === 'inactive';
        }

        if (this.statusFilter === 'pending') {
          return status.includes('pending');
        }

        return true;
      });
    }

    if (this.parentFilter === 'withParent') {
      rows = rows.filter((c: any) => !!c.parent_uid);
    } else if (this.parentFilter === 'withoutParent') {
      rows = rows.filter((c: any) => !c.parent_uid);
    }

    const f = this.advancedFilters;

    if (f.healthFundId !== 'all') {
      rows = rows.filter((c: any) => c.funding_source_id === f.healthFundId);
    }

    if (f.gender !== 'all') {
      rows = rows.filter((c: any) => c.gender === f.gender);
    }

    if (f.birthFrom) {
      rows = rows.filter((c: any) => c.birth_date && new Date(c.birth_date) >= new Date(f.birthFrom));
    }

    if (f.birthTo) {
      rows = rows.filter((c: any) => c.birth_date && new Date(c.birth_date) <= this.endOfDay(f.birthTo));
    }

    if (f.entryFrom) {
      rows = rows.filter((c: any) => c.created_at && new Date(c.created_at) >= new Date(f.entryFrom));
    }

    if (f.entryTo) {
      rows = rows.filter((c: any) => c.created_at && new Date(c.created_at) <= this.endOfDay(f.entryTo));
    }

    if (f.terms !== 'all') {
      rows = rows.filter((c: any) => {
        const signed = !!this.termsByChild[c.child_uuid]?.signed;
        return f.terms === 'signed' ? signed : !signed;
      });
    }

    if (f.termsFrom) {
      rows = rows.filter((c: any) => {
        const signedAt = this.termsByChild[c.child_uuid]?.signedAt;
        return signedAt && new Date(signedAt) >= new Date(f.termsFrom);
      });
    }

    if (f.termsTo) {
      rows = rows.filter((c: any) => {
        const signedAt = this.termsByChild[c.child_uuid]?.signedAt;
        return signedAt && new Date(signedAt) <= this.endOfDay(f.termsTo);
      });
    }

    if (f.intake !== 'all') {
      rows = rows.filter((c: any) => {
        const exists = !!this.intakeByChild[c.child_uuid];
        return f.intake === 'exists' ? exists : !exists;
      });
    }

    if (f.instructorId !== 'all') {
      rows = rows.filter((c: any) =>
        this.lessonMetaByChild[c.child_uuid]?.instructorIds.includes(f.instructorId)
      );
    }

    if (f.lessonType !== 'all') {
      rows = rows.filter((c: any) =>
        this.lessonMetaByChild[c.child_uuid]?.lessonTypes.includes(f.lessonType)
      );
    }

    if (f.lessonDay !== 'all') {
      rows = rows.filter((c: any) =>
        this.lessonMetaByChild[c.child_uuid]?.days.includes(f.lessonDay)
      );
    }

    if (f.series !== 'all') {
      rows = rows.filter((c: any) => {
        const hasSeries = !!this.lessonMetaByChild[c.child_uuid]?.hasActiveSeries;
        return f.series === 'active' ? hasSeries : !hasSeries;
      });
    }

    if (f.referral !== 'all') {
      rows = rows.filter((c: any) => {
        const meta = this.lessonMetaByChild[c.child_uuid];
        const hasReferral = !!meta?.hasReferral;
        const missingReferral = !!meta?.missingReferral;

        if (f.referral === 'exists') return hasReferral;
        return missingReferral;
      });
    }

    if (f.missingDocs !== 'all') {
      rows = rows.filter((c: any) => {
        const missing = !!this.lessonMetaByChild[c.child_uuid]?.missingRequiredDocs;
        return f.missingDocs === 'missing' ? missing : !missing;
      });
    }

    if (f.lessonFrom || f.lessonTo) {
      rows = rows.filter((c: any) => {
        const dates = this.lessonMetaByChild[c.child_uuid]?.lessonDates ?? [];
        return dates.some((d) => {
          const date = new Date(d);
          if (f.lessonFrom && date < new Date(f.lessonFrom)) return false;
          if (f.lessonTo && date > this.endOfDay(f.lessonTo)) return false;
          return true;
        });
      });
    }
    return rows;
  }

  private isChildActive(row: any): boolean {
    return this.isActiveStatus(row?.status);
  }

  private endOfDay(value: string): Date {
    const d = new Date(value);
    d.setHours(23, 59, 59, 999);
    return d;
  }

  loadSavedFilters(): void {
    try {
      const raw = localStorage.getItem(this.FILTERS_STORAGE_KEY);
      this.savedFilters = raw ? JSON.parse(raw) : [];
    } catch {
      this.savedFilters = [];
    }
  }

  saveCurrentFilter(): void {
    const name = prompt('שם לסינון הקבוע:');
    if (!name?.trim()) return;

    this.savedFilters.push({
      name: name.trim(),
      filters: structuredClone(this.advancedFilters),
      statusFilter: this.statusFilter,
      parentFilter: this.parentFilter,
    });

    localStorage.setItem(this.FILTERS_STORAGE_KEY, JSON.stringify(this.savedFilters));
  }

  applySavedFilter(item: SavedChildrenFilter): void {
    this.advancedFilters = structuredClone(item.filters);
    this.statusFilter = item.statusFilter;
    this.parentFilter = item.parentFilter;
    this.onFiltersChanged();
  }

  deleteSavedFilter(index: number): void {
    this.savedFilters.splice(index, 1);
    localStorage.setItem(this.FILTERS_STORAGE_KEY, JSON.stringify(this.savedFilters));
  }

  onFiltersChanged(): void {
    this.updateStats();
  }

  clearFilters() {
    this.searchText = '';
    this.searchMode = 'name';
    this.statusFilter = 'all';
    this.parentFilter = 'all';

    this.advancedFilters = {
      terms: 'all',
      intake: 'all',

      healthFundId: 'all',
      gender: 'all',

      birthFrom: '',
      birthTo: '',

      entryFrom: '',
      entryTo: '',

      termsFrom: '',
      termsTo: '',

      lessonFrom: '',
      lessonTo: '',

      instructorId: 'all',
      lessonType: 'all',
      lessonDay: 'all',

      series: 'all',
      referral: 'all',
      missingDocs: 'all',
    };

    this.updateStats();
  }

  get activeFilterChips(): { label: string; clear: () => void }[] {
    const chips: { label: string; clear: () => void }[] = [];
    const f = this.advancedFilters;

    if (this.statusFilter !== 'all') {
      chips.push({
        label: 'סטטוס: ' + this.getStatusFilterLabel(),
        clear: () => this.statusFilter = 'all',
      });
    }

    if (this.parentFilter !== 'all') {
      chips.push({
        label: 'שיוך להורה: ' + (this.parentFilter === 'withParent' ? 'יש הורה' : 'ללא הורה'),
        clear: () => this.parentFilter = 'all',
      });
    }

    if (f.terms !== 'all') {
      chips.push({
        label: 'תקנון: ' + (f.terms === 'signed' ? 'חתום' : 'לא חתום'),
        clear: () => f.terms = 'all',
      });
    }

    if (f.healthFundId !== 'all') {
      chips.push({
        label: 'קופ"ח: ' + this.getFundingSourceName(f.healthFundId),
        clear: () => f.healthFundId = 'all',
      });
    }

    if (f.gender !== 'all') {
      chips.push({
        label: 'מגדר: ' + f.gender,
        clear: () => f.gender = 'all',
      });
    }

    if (f.instructorId !== 'all') {
      chips.push({
        label: 'מדריך: ' + this.getInstructorName(f.instructorId),
        clear: () => f.instructorId = 'all',
      });
    }

    if (f.lessonFrom || f.lessonTo) {
      chips.push({
        label: `שיעורים: ${f.lessonFrom || '...'} - ${f.lessonTo || '...'}`,
        clear: () => {
          f.lessonFrom = '';
          f.lessonTo = '';
        },
      });
    }

    return chips;
  }

  getInstructorName(id: string | null | undefined): string {
    if (!id || id === 'all') return 'כל המדריכים';

    const instructor = this.instructors.find((i) => i.id_number === id);

    if (!instructor) return id;

    const fullName = `${instructor.first_name ?? ''} ${instructor.last_name ?? ''}`.trim();

    return instructor.name || fullName || id;
  }


  getStatusFilterLabel(): string {
    if (this.statusFilter === 'active') return 'פעיל';
    if (this.statusFilter === 'inactive') return 'לא פעיל';
    if (this.statusFilter === 'pending') return 'ממתין אישור';
    return 'הכול';
  }

  clearChip(chip: { clear: () => void }): void {
    chip.clear();
    this.onFiltersChanged();
  }

  toggleSearchPanelFromBar() {
    this.panelFocus = 'search';
    this.showColumnsPanel = false;
    this.showSearchPanel = !this.showSearchPanel;
  }

  toggleFromSearchIcon(event: MouseEvent) {
    event.stopPropagation();
    this.panelFocus = 'search';
    this.showColumnsPanel = false;
    this.showSearchPanel = !this.showSearchPanel;
  }

  toggleFromFilterIcon(event: MouseEvent) {
    event.stopPropagation();
    this.panelFocus = 'filter';
    this.showColumnsPanel = false;
    this.showSearchPanel = !this.showSearchPanel;
  }

  toggleColumnsPanel(event?: MouseEvent) {
    if (event) event.stopPropagation();
    this.showSearchPanel = false;
    this.showColumnsPanel = !this.showColumnsPanel;
  }

  moveColumnLeft(index: number): void {
    if (index <= 0) return;
    const arr = [...this.columns];
    [arr[index - 1], arr[index]] = [arr[index], arr[index - 1]];
    this.columns = arr;
    this.saveTablePrefs();
  }

  moveColumnRight(index: number): void {
    if (index >= this.columns.length - 1) return;
    const arr = [...this.columns];
    [arr[index], arr[index + 1]] = [arr[index + 1], arr[index]];
    this.columns = arr;
    this.saveTablePrefs();
  }

  saveTablePrefs(): void {
    localStorage.setItem(
      this.STORAGE_KEY,
      JSON.stringify({ columns: this.columns })
    );
  }

  private loadTablePrefs(): void {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.columns)) {
        this.columns = parsed.columns;
      }
    } catch (e) {
      console.warn('loadTablePrefs failed', e);
    }
  }

  private updateStats(): void {
    const all = this.children ?? [];
    const filtered = this.filteredChildren ?? [];

    this.stats = {
      total: all.length,
      filtered: filtered.length,
      activeChildren: all.filter((c: any) => this.isChildActive(c)).length,
      inactiveChildren: all.filter((c: any) => !this.isChildActive(c)).length,
      withParent: all.filter((c: any) => !!c.parent_uid).length,
      withoutParent: all.filter((c: any) => !c.parent_uid).length,
    };
  }

  exportToExcel(): void {
    try {
      const rows = this.filteredChildren.map((child: any) => {
        const row: Record<string, any> = {};

        this.visibleColumns.forEach((col) => {
          row[col.label] = this.getExportCellValue(child, col.key);
        });

        return row;
      });

      if (!rows.length) {
        this.ui.alert('אין נתונים לייצוא.', 'ייצוא לאקסל');
        return;
      }

      const worksheet: XLSX.WorkSheet = XLSX.utils.json_to_sheet(rows);

      worksheet['!cols'] = this.visibleColumns.map((col) => ({
        wch: Math.max(col.label.length + 4, 18),
      }));

      const workbook: XLSX.WorkBook = {
        Sheets: { ילדים: worksheet },
        SheetNames: ['ילדים'],
      };

      const excelBuffer: ArrayBuffer = XLSX.write(workbook, {
        bookType: 'xlsx',
        type: 'array',
      });

      const blob = new Blob([excelBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=UTF-8',
      });

      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');

      saveAs(blob, `children-export-${yyyy}-${mm}-${dd}.xlsx`);
    } catch (error) {
      console.error('exportToExcel failed', error);
      this.ui.alert('אירעה שגיאה בעת ייצוא לאקסל.', 'שגיאה');
    }
  }

  hasActiveAdvancedFilters(): boolean {
    const f = this.advancedFilters;
    return (
      f.terms !== 'all' ||
      f.intake !== 'all' ||
      f.healthFundId !== 'all' ||
      !!f.entryFrom ||
      !!f.entryTo
    );
  }

  private getExportCellValue(child: any, key: ChildColumnKey): string {
    switch (key) {
      case 'first_name':
        return child.first_name || '—';

      case 'last_name':
        return child.last_name || '—';

      case 'gov_id':
        return child.gov_id || '—';

      case 'birth_date':
        return child.birth_date ? this.formatDateForExcel(child.birth_date) : '—';

      case 'gender':
        return child.gender || '—';

      case 'funding_source_id':
        return this.getFundingSourceName(child.funding_source_id) || '—';

      case 'status':
        return this.isActiveStatus(child.status) ? 'פעיל' : 'לא פעיל';

      case 'parent_status':
        return child.parent_uid ? 'יש הורה משויך' : 'ללא הורה';

      case 'created_at':
        return child.created_at ? this.formatDateForExcel(child.created_at) : '—';

      case 'updated_at':
        return child.updated_at ? this.formatDateForExcel(child.updated_at) : '—';

      default:
        return '—';
    }
  }

  private formatDateForExcel(value: string): string {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;

    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();

    return `${dd}/${mm}/${yyyy}`;
  }

  async openDetails(id?: string) {
    if (!id) return;

    this.selectedId = id;
    this.drawer.open();
    await this.loadDrawerData(id);
  }

  closeDetails() {
    this.drawer.close();
    this.selectedId = null;
    this.drawerChild = null;
    this.editMode = false;
    this.childForm = null;
    this.originalChild = null;

    this.termsBucket = null;
    this.termsPath = null;
    this.termsCreatedAt = null;
    this.termsLoading = false;
    this.seriesDocs = [];
    this.seriesDocsLoading = false;
    this.seriesDocsError = null;
  }

  openAddChildDialog() {
    this.showAddChildWizard = true;
  }

  private async loadDrawerData(id: string) {
    this.drawerLoading = true;

    this.termsBucket = null;
    this.termsPath = null;
    this.termsCreatedAt = null;

    try {
      const db = await this.dbc();

      const { data: c, error: cErr } = await db
        .from('children')
        .select(`
          child_uuid,
          first_name,
          last_name,
          gov_id,
          birth_date,
          gender,
          parent_uid,
          funding_source_id,
          status,
          medical_notes,
          behavior_notes,
          created_at,
updated_at,
deletion_requested_at,
scheduled_deletion_at,deletion_note
        `)
        .eq('child_uuid', id)
        .single();

      if (cErr) throw cErr;

      let parent: ParentBrief | null = null;

      if (c?.parent_uid) {
        const { data: p, error: pErr } = await db
          .from('parents')
          .select('uid, first_name,last_name, phone, email')
          .eq('uid', c.parent_uid)
          .maybeSingle();

        if (!pErr && p) parent = p as ParentBrief;
      }

      this.drawerChild = { ...(c as ChildDetails), parent, child_uuid: id };
      this.buildChildForm(this.drawerChild);

      await this.loadChildTermsSignature(id);
      await this.loadChildSeriesDocs(id);
      await this.loadChildDocuments(id);
    } catch (e) {
      console.error('loadDrawerData error:', e);
      this.drawerChild = null;
    } finally {
      this.drawerLoading = false;
    }
  }

  private async loadChildDocuments(childId: string): Promise<void> {
    this.childDocsLoading = true;
    this.childDocsError = null;
    this.childDocs = [];

    try {
      const db = await this.dbc();

      const { data, error } = await db
        .from('child_documents')
        .select(`
        id,
        child_id,
        document_name,
        bucket,
        file_path,
        file_url,
        mime_type,
        file_size,
        created_at
      `)
        .eq('child_id', childId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const docs = (data ?? []).map((row: any) => ({
        id: row.id,
        childId: row.child_id,
        documentName: row.document_name,
        bucket: row.bucket,
        filePath: row.file_path,
        fileUrl: row.file_url,
        mimeType: row.mime_type,
        fileSize: row.file_size,
        createdAt: row.created_at,
      }));

      this.allChildDocs = docs;

      this.childDocs = docs.filter(
        (doc: { documentName: string; }) => doc.documentName?.trim() !== 'אינטק'
      );

    } catch (e: any) {
      console.error('loadChildDocuments error:', e);
      this.childDocsError = e?.message ?? 'שגיאה בטעינת מסמכי הילד';
    } finally {
      this.childDocsLoading = false;
    }
  }

  async uploadChildDocument(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file || !this.drawerChild?.child_uuid) return;

    const docName = this.newChildDocName.trim();
    if (!docName) {
      await this.ui.alert('יש להזין שם קובץ לפני ההעלאה.', 'שם קובץ חסר');
      input.value = '';
      return;
    }

    if (!this.isAllowedReferralFile(file)) {
      await this.ui.alert(
        'ניתן להעלות רק קובצי PDF או תמונות (PNG/JPG/WEBP).',
        'קובץ לא נתמך'
      );
      input.value = '';
      return;
    }

    try {
      this.uploadingChildDoc = true;

      const db = await this.dbc();
      const client = getSupabaseClient();

      const childId = this.drawerChild.child_uuid;
      const fileExt = file.name.split('.').pop()?.toLowerCase() || 'pdf';
      const bucketName = 'child-documents';

      const farm = getCurrentFarmMetaSync();
      const schemaName = farm?.schema_name || localStorage.getItem('selectedSchema');

      if (!schemaName) {
        throw new Error('לא נמצאה סכמה פעילה לשמירת המסמך');
      }

      const filePath = `${schemaName}/${childId}/${Date.now()}-${crypto.randomUUID()}.${fileExt}`;

      const { error: uploadError } = await client.storage
        .from(bucketName)
        .upload(filePath, file, {
          upsert: false,
          contentType: file.type || undefined,
        });

      if (uploadError) throw uploadError;

      const { data: publicData } = client.storage
        .from(bucketName)
        .getPublicUrl(filePath);

      const publicUrl = publicData?.publicUrl ?? null;

      const { data, error } = await db
        .from('child_documents')
        .insert({
          child_id: childId,
          document_name: docName,
          bucket: bucketName,
          file_path: filePath,
          file_url: publicUrl,
          mime_type: file.type || null,
          file_size: file.size,
        })
        .select()
        .single();

      if (error) throw error;

      await this.loadChildDocuments(childId);

      this.newChildDocName = '';

      await this.ui.alert('המסמך הועלה בהצלחה.', 'מסמכי ילד');
    } catch (e: any) {
      console.error('uploadChildDocument error:', e);
      await this.ui.alert('העלאת המסמך נכשלה: ' + (e?.message ?? e), 'שגיאה');
    } finally {
      this.uploadingChildDoc = false;
      input.value = '';
    }
  }

  get intakeDoc(): ChildDocumentRow | null {
    return this.allChildDocs.find(d => d.documentName?.trim() === 'אינטק') ?? null;
  }

  hasIntake(): boolean {
    return !!this.intakeDoc;
  }

  prepareIntakeUpload(): void {
    this.newChildDocName = 'אינטק';
  }

  openChildDocument(doc: ChildDocumentRow): void {
    if (!doc.fileUrl) {
      this.ui.alert('אין קישור זמין למסמך.', 'מסמכי ילד');
      return;
    }

    this.dialog.open(TermsPdfDialogComponent, {
      width: 'min(980px, 96vw)',
      height: 'min(90vh, 900px)',
      data: {
        title: doc.documentName,
        url: this.sanitizer.bypassSecurityTrustResourceUrl(doc.fileUrl),
      },
    });
  }

  async deleteChildDocument(doc: ChildDocumentRow): Promise<void> {
  const ok = confirm(`האם את בטוחה שאת רוצה למחוק את הקובץ "${doc.documentName}"?`);
  if (!ok) return;

  try {
    const db = await this.dbc();
    const client = getSupabaseClient();

    if (doc.bucket && doc.filePath) {
      const { error: storageError } = await client.storage
        .from(doc.bucket)
        .remove([doc.filePath]);

      if (storageError) {
        console.warn('Storage delete failed:', storageError);
      }
    }

    const { error } = await db
      .from('child_documents')
      .delete()
      .eq('id', doc.id);

    if (error) throw error;

    if (this.drawerChild?.child_uuid) {
      await this.loadChildDocuments(this.drawerChild.child_uuid);
    }

    await this.ui.alert('הקובץ נמחק בהצלחה.', 'מסמכי ילד');
  } catch (e: any) {
    console.error('deleteChildDocument error:', e);
    await this.ui.alert('מחיקת הקובץ נכשלה: ' + (e?.message ?? e), 'שגיאה');
  }
}

  private async loadChildTermsSignature(childId: string) {
    this.termsLoading = true;
    try {
      const db = await this.dbc();

      const { data, error } = await db
        .from('child_terms_signatures')
        .select('signed_pdf_bucket, signed_pdf_path, created_at')
        .eq('child_id', childId)
        .not('signed_pdf_bucket', 'is', null)
        .not('signed_pdf_path', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      const row = (data ?? null) as TermsSignatureRow | null;
      this.termsBucket = row?.signed_pdf_bucket ?? null;
      this.termsPath = row?.signed_pdf_path ?? null;
      this.termsCreatedAt = row?.created_at ?? null;
    } catch (e) {
      console.error('loadChildTermsSignature error:', e);
      this.termsBucket = null;
      this.termsPath = null;
      this.termsCreatedAt = null;
    } finally {
      this.termsLoading = false;
    }
  }

  private async loadChildSeriesDocs(childId: string) {
    this.seriesDocsLoading = true;
    this.seriesDocsError = null;
    this.seriesDocs = [];

    try {
      const db = await this.dbc();

      const { data, error } = await db
        .from('lessons')
        .select(`
  id,
  lesson_type,
  day_of_week,
  start_time,
  end_time,
  anchor_week_start,
  series_end_date,
  is_open_ended,
  status,
  payment_docs_url,
  payment_plan_id,
  instructor_id,
  payment_plans (
    required_docs,
    require_docs_at_booking
  )
`)
        .eq('child_id', childId)
        .eq('lesson_type', 'סידרה')
        .order('anchor_week_start', { ascending: false })
        .order('day_of_week', { ascending: true })
        .order('start_time', { ascending: true });

      if (error) throw error;

      const rows = data ?? [];

const instructorIds = Array.from(
  new Set(rows.map((r: any) => r.instructor_id).filter(Boolean))
);

let instructorNameById: Record<string, string> = {};

if (instructorIds.length) {
  const { data: instRaw, error: instError } = await db
    .from('instructors')
    .select('id_number, first_name, last_name')
    .in('id_number', instructorIds);

  if (instError) throw instError;

  instructorNameById = Object.fromEntries(
    (instRaw ?? []).map((i: any) => [
      i.id_number,
      `${i.first_name ?? ''} ${i.last_name ?? ''}`.trim(),
    ])
  );
}

this.seriesDocs = rows.map((row: any) => ({
  lessonId: row.id,
  lessonType: row.lesson_type ?? null,
  dayOfWeek: row.day_of_week ?? null,
  startTime: row.start_time ?? null,
  endTime: row.end_time ?? null,
  anchorWeekStart: row.anchor_week_start ?? null,
  seriesEndDate: row.series_end_date ?? null,
  isOpenEnded: row.is_open_ended ?? null,
  status: row.status ?? null,
  paymentDocsUrl: row.payment_docs_url ?? null,
  paymentPlanId: row.payment_plan_id ?? null,
  requiredDocs: row.payment_plans?.required_docs ?? [],
  requireDocsAtBooking: row.payment_plans?.require_docs_at_booking ?? null,
  instructorId: row.instructor_id ?? null,
  instructorName: row.instructor_id
    ? instructorNameById[row.instructor_id] ?? row.instructor_id
    : null,
}));


    } catch (e: any) {
      console.error('loadChildSeriesDocs error:', e);
      this.seriesDocsError = e?.message ?? 'שגיאה בטעינת סדרות והפניות';
      this.seriesDocs = [];
    } finally {
      this.seriesDocsLoading = false;
    }
  }


  getChildTitle(): string {
    const gender = this.drawerChild?.gender;

    if (this.editMode) {
      if (gender === 'זכר') return 'עריכת הילד';
      if (gender === 'נקבה') return 'עריכת הילדה';
      return 'עריכת ילד/ה';
    } else {
      if (gender === 'זכר') return 'פרטי הילד';
      if (gender === 'נקבה') return 'פרטי הילדה';
      return 'פרטי ילד/ה';
    }
  }

  seriesRequiresDocs(row: SeriesDocRow): boolean {
    return !!row.requireDocsAtBooking && Array.isArray(row.requiredDocs) && row.requiredDocs.length > 0;
  }

  getRequiredDocsText(row: SeriesDocRow): string {
    if (!row.requiredDocs?.length) return '';
    return row.requiredDocs.join(', ');
  }
  getSeriesEndDisplay(row: SeriesDocRow): string {
    if (row.isOpenEnded) return 'סדרה ללא הגבלה';
    return row.seriesEndDate || '—';
  }

  async openTermsPdf() {
    if (!this.termsBucket || !this.termsPath) {
      await this.ui.alert('אין תקנון חתום להצגה לילד זה.', 'תקנון');
      return;
    }

    try {
      const client = getSupabaseClient();

      const { data, error } = await client.storage
        .from(this.termsBucket)
        .createSignedUrl(this.termsPath, 60 * 60);

      if (error) throw error;

      const url = data?.signedUrl;
      if (!url) throw new Error('No signedUrl returned');

      this.dialog.open(TermsPdfDialogComponent, {
        width: 'min(980px, 96vw)',
        height: 'min(90vh, 900px)',
        data: {
          title: 'תקנון חתום (PDF)',
          url: this.sanitizer.bypassSecurityTrustResourceUrl(url),
        },
      });
    } catch (e: any) {
      console.error('openTermsPdf error:', e);
      await this.ui.alert(
        'לא הצלחתי לפתוח את ה-PDF: ' + (e?.message ?? e),
        'תקנון'
      );
    }
  }

  openSeriesDoc(url: string | null | undefined) {
    if (!url) {
      this.ui.alert('אין מסמך להצגה עבור סדרה זו.', 'הפניות');
      return;
    }

    this.dialog.open(TermsPdfDialogComponent, {
      width: 'min(980px, 96vw)',
      height: 'min(90vh, 900px)',
      data: {
        title: 'הפניית סדרה',
        url: this.sanitizer.bypassSecurityTrustResourceUrl(url),
      },
    });
  }

  private buildChildForm(child: ChildDetails) {
    this.childForm = this.fb.group({
      first_name: [
        child.first_name ?? '',
        [
          Validators.required,
          Validators.maxLength(this.MAX_NAME_LEN),
          this.hebrewNameValidator(),
        ],
      ],
      last_name: [
        child.last_name ?? '',
        [
          Validators.required,
          Validators.maxLength(this.MAX_NAME_LEN),
          this.hebrewNameValidator(),
        ],
      ],
      funding_source_id: [child.funding_source_id ?? null],
      status: [child.status ?? null],
      medical_notes: [
        child.medical_notes ?? '',
        [Validators.maxLength(this.MAX_MEDICAL_NOTES)],
      ],
      behavior_notes: [
        child.behavior_notes ?? '',
        [Validators.maxLength(this.MAX_BEHAVIOR_NOTES)],
      ],
      created_at: [
        child.created_at ? this.toDateTimeLocal(child.created_at) : '',
      ],
      inactive_date: [
        child.scheduled_deletion_at
          ? String(child.scheduled_deletion_at).slice(0, 10)
          : this.todayDate(),
      ],
      deletion_note: [
        child.deletion_note ?? '',
        [Validators.maxLength(300)],
      ],
    });

    this.originalChild = { ...child };
    this.editMode = false;
  }

  private toDateTimeLocal(value: string): string {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';

    const pad = (n: number) => String(n).padStart(2, '0');

    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  enterEditModeChild() {
    if (!this.drawerChild || !this.childForm) return;
    this.editMode = true;
  }

  cancelChildEdit() {
    if (!this.originalChild) {
      this.editMode = false;
      return;
    }
    this.buildChildForm(this.originalChild);
    this.editMode = false;
  }

  private async loadFilterLookups(): Promise<void> {
    const db = await this.dbc();

    const childIds = this.children
      .map((c: any) => c.child_uuid)
      .filter(Boolean);

    if (!childIds.length) return;

    const { data: instructorsData, error: instructorsError } = await db
      .from('instructors')
      .select('id_number, first_name, last_name')
      .order('first_name', { ascending: true });

    if (instructorsError) {
      console.error('load instructors failed:', instructorsError);
      this.instructors = [];
    } else {
      this.instructors = (instructorsData ?? []).map((i: any) => ({
        ...i,
        name: `${i.first_name ?? ''} ${i.last_name ?? ''}`.trim(),
      }));
    }

    const { data: termsData } = await db
      .from('child_terms_signatures')
      .select('child_id, signed_pdf_bucket, signed_pdf_path, created_at')
      .in('child_id', childIds)
      .not('signed_pdf_bucket', 'is', null)
      .not('signed_pdf_path', 'is', null);

    this.termsByChild = {};
    for (const row of termsData ?? []) {
      const cid = (row as any).child_id;
      const current = this.termsByChild[cid];

      if (!current || new Date((row as any).created_at) > new Date(current.signedAt || 0)) {
        this.termsByChild[cid] = {
          signed: true,
          signedAt: (row as any).created_at ?? null,
        };
      }
    }

    const { data: docsData } = await db
      .from('child_documents')
      .select('child_id, document_name')
      .in('child_id', childIds);

    this.intakeByChild = {};
    for (const row of docsData ?? []) {
      if (String((row as any).document_name ?? '').trim() === 'אינטק') {
        this.intakeByChild[(row as any).child_id] = true;
      }
    }

    const { data: lessonsData } = await db
      .from('lessons')
      .select(`
      id,
      child_id,
      instructor_id,
      lesson_type,
      day_of_week,
      anchor_week_start,
      series_end_date,
      is_open_ended,
      status,
      payment_docs_url,
      payment_plans (
        required_docs,
        require_docs_at_booking
      )
    `)
      .in('child_id', childIds);

    this.lessonMetaByChild = {};
    const typeSet = new Set<string>();

    for (const row of lessonsData ?? []) {
      const r: any = row;
      const cid = r.child_id;
      if (!cid) continue;

      if (!this.lessonMetaByChild[cid]) {
        this.lessonMetaByChild[cid] = {
          instructorIds: [],
          lessonTypes: [],
          days: [],
          hasActiveSeries: false,
          hasReferral: false,
          missingReferral: false,
          missingRequiredDocs: false,
          lessonDates: [],
        };
      }

      const meta = this.lessonMetaByChild[cid];

      if (r.instructor_id && !meta.instructorIds.includes(r.instructor_id)) {
        meta.instructorIds.push(r.instructor_id);
      }

      if (r.lesson_type) {
        typeSet.add(r.lesson_type);
        if (!meta.lessonTypes.includes(r.lesson_type)) meta.lessonTypes.push(r.lesson_type);
      }

      if (r.day_of_week && !meta.days.includes(r.day_of_week)) {
        meta.days.push(r.day_of_week);
      }

      const isActive = String(r.status ?? '').toLowerCase() === 'active' || r.status === 'אושר';
      const isSeries = r.lesson_type === 'סידרה' || r.lesson_type === 'סדרה';

      if (isSeries && isActive) {
        meta.hasActiveSeries = true;
      }

      if (r.payment_docs_url) {
        meta.hasReferral = true;
      }

      const requiresDocs =
        !!r.payment_plans?.require_docs_at_booking &&
        Array.isArray(r.payment_plans?.required_docs) &&
        r.payment_plans.required_docs.length > 0;

      if (requiresDocs && !r.payment_docs_url) {
        meta.missingReferral = true;
        meta.missingRequiredDocs = true;
      }

      if (r.anchor_week_start) {
        meta.lessonDates.push(r.anchor_week_start);
      }
    }

    this.lessonTypes = Array.from(typeSet).sort();
  }

  async saveChildEdits() {
    if (!this.drawerChild || !this.childForm || !this.selectedId) return;

    const raw = this.childForm.getRawValue();
    const becameInactive =
      this.isActiveStatus(this.originalChild?.status) &&
      raw.status === 'Deleted';

    const becameActive =
      !this.isActiveStatus(this.originalChild?.status) &&
      raw.status === 'Active';
    if (raw.created_at) {
      raw.created_at = new Date(raw.created_at).toISOString();
    }

    const fieldsToCompare: (keyof ChildDetails)[] = [
      'first_name',
      'last_name',
      'funding_source_id',
      'status',
      'medical_notes',
      'behavior_notes',
      'created_at',
    ];

    const delta: Partial<ChildDetails> = {};
    if (
      this.isActiveStatus(raw.status) &&
      this.drawerChild?.scheduled_deletion_at &&
      raw.inactive_date
    ) {
      (delta as any).scheduled_deletion_at = raw.inactive_date;
    }
    if (becameActive) {
      (delta as any).deletion_requested_at = null;
      (delta as any).scheduled_deletion_at = null;
    }
    for (const key of fieldsToCompare) {
      const oldVal = (this.originalChild as any)?.[key] ?? null;
      const newVal = (raw as any)?.[key] ?? null;
      if (oldVal !== newVal) {
        (delta as any)[key] = newVal;
      }
    }
    if (
      this.isActiveStatus(raw.status) &&
      this.drawerChild?.scheduled_deletion_at &&
      raw.inactive_date
    ) {
      (delta as any).scheduled_deletion_at = raw.inactive_date;
    }
    if (Object.keys(delta).length === 0) {
      this.editMode = false;
      return;
    }
    if (becameInactive) {
      const inactiveDate = raw.inactive_date;

      if (!inactiveDate) {
        await this.ui.alert('חובה לבחור תאריך הפיכת ילד ללא פעיל', 'שגיאה');
        return;
      }

      const db = await this.dbc();

      const deletionNote = String(raw.deletion_note ?? '').trim();

      const { error } = await db.rpc('schedule_child_inactivation', {
        p_child_uuid: this.selectedId,
        p_inactive_date: inactiveDate,
        p_deletion_note: deletionNote || null,
      });

      if (error) throw error;

      await this.loadChildren();
      await this.openDetails(this.selectedId);

      this.editMode = false;

      await this.ui.alert(
        inactiveDate === this.todayDate()
          ? 'הילד הוגדר כלא פעיל והשיעורים שלו נמחקו.'
          : 'נקבע תאריך עתידי להפיכת הילד ללא פעיל.',
        'בוצע'
      );

      return;
    }
    try {
      const db = await this.dbc();

      const { error } = await db
        .from('children')
        .update(delta)
        .eq('child_uuid', this.selectedId);

      if (error) throw error;

      this.drawerChild = {
        ...(this.drawerChild as ChildDetails),
        ...delta,
      };
      this.originalChild = { ...this.drawerChild };

      this.children = this.children.map((c) =>
        (c as any).child_uuid === this.selectedId
          ? { ...c, ...delta }
          : c,
      );

      this.updateStats();
      this.editMode = false;
    } catch (e: any) {
      console.error(e);
      await this.ui.alert(
        'שמירת השינויים נכשלה: ' + (e?.message ?? e),
        'שמירה נכשלה',
      );
    }
  }

  childHasHorse(childId: string | undefined, horseId: string): boolean {
    if (!childId) return false;
    const list = this.childHorses[childId] || [];
    return list.includes(horseId);
  }

  horseNamesForChild(childId: string | undefined): string {
    if (!childId) return '';
    const ids = this.childHorses[childId] || [];
    if (!ids.length) return '';
    const nameById = new Map(this.horses.map((h) => [h.id, h.name]));
    return ids
      .map((id) => nameById.get(id))
      .filter(Boolean)
      .join(', ');
  }

  formatTimeShort(value: string | null | undefined): string {
    if (!value) return '—';
    return String(value).slice(0, 5);
  }

  async toggleChildHorse(
    childId: string | undefined,
    horseId: string,
    checked: boolean,
  ) {
    if (!childId) return;
    const key = childId;
    this.savingChildHorses[key] = true;

    try {
      const db = await this.dbc();

      const current = new Set(this.childHorses[key] || []);

      if (checked) {
        if (!current.has(horseId)) {
          const { error } = await db
            .from('child_horses')
            .insert({ child_id: childId, horse_id: horseId });
          if (error) throw error;
          current.add(horseId);
        }
      } else {
        if (current.has(horseId)) {
          const { error } = await db
            .from('child_horses')
            .delete()
            .eq('child_id', childId)
            .eq('horse_id', horseId);
          if (error) throw error;
          current.delete(horseId);
        }
      }

      this.childHorses[key] = Array.from(current);
    } catch (e) {
      console.error('toggleChildHorse error:', e);
      await this.ui.alert('שמירת התאמת הסוס נכשלה', 'שמירה נכשלה');
    } finally {
      this.savingChildHorses[key] = false;
    }
  }

  handleChildAddedFromWizard() {
    this.loadChildren();
    this.showAddChildWizard = false;
  }

  closeWizard() {
    this.showAddChildWizard = false;
  }
  private async loadFundingSources(): Promise<void> {
    const db = await this.dbc();

    const { data, error } = await db
      .from('funding_sources')
      .select('id, name')
      .eq('is_system', true)
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) throw error;

    this.healthFunds = data ?? [];
  }

  getFundingSourceName(id: string | null | undefined): string {
    if (!id) return '—';
    return this.healthFunds.find(f => f.id === id)?.name ?? '—';
  }
  private readonly hebrewDayIndex: Record<string, number> = {
    'ראשון': 0,
    'שני': 1,
    'שלישי': 2,
    'רביעי': 3,
    'חמישי': 4,
    'שישי': 5,
    'שבת': 6,
  };

  getSeriesActualStartDate(row: SeriesDocRow): string {
    if (!row.anchorWeekStart || !row.dayOfWeek) return '—';

    const dayOffset = this.hebrewDayIndex[row.dayOfWeek];
    if (dayOffset === undefined) return row.anchorWeekStart;

    const [year, month, day] = row.anchorWeekStart.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    date.setDate(date.getDate() + dayOffset);

    return this.formatDateDdMmYyyy(date);
  }

  private formatDateDdMmYyyy(date: Date): string {
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();

    return `${dd}/${mm}/${yyyy}`;
  }
  getChildAgeDisplay(birthDate: string | null | undefined): string {
    if (!birthDate) return '';

    const birth = new Date(birthDate);
    if (Number.isNaN(birth.getTime())) return '';

    const today = new Date();

    let years = today.getFullYear() - birth.getFullYear();
    let months = today.getMonth() - birth.getMonth();

    if (today.getDate() < birth.getDate()) {
      months--;
    }

    if (months < 0) {
      years--;
      months += 12;
    }

    return `${years}.${months}`;
  }
  goToParentCard(): void {
    const parentUid = this.drawerChild?.parent_uid;

    if (!parentUid) {
      return;
    }

    this.router.navigate(['/secretary/parents'], {
      queryParams: {
        parentUid,
      },
    });
  }
  todayDate(): string {
    return new Date().toISOString().slice(0, 10);
  }
  async cancelScheduledChildDeletion(): Promise<void> {
    if (!this.selectedId) return;

    const ok = await this.ui.confirm({
      title: 'ביטול מחיקה עתידית',
      message: 'לבטל את ההפיכה העתידית ללא פעיל? הילד יישאר פעיל והתאריכים יימחקו.',
      okText: 'כן, לבטל',
      cancelText: 'לא',
      dangerText: 'ביטול מחיקה עתידית',
    });
    if (!ok) return;

    try {
      const db = await this.dbc();

      const { error } = await db
        .from('children')
        .update({
          status: 'Active',
          deletion_requested_at: null,
          scheduled_deletion_at: null,
          deletion_note: null,

        })
        .eq('child_uuid', this.selectedId);

      if (error) throw error;

      await this.loadChildren();
      await this.openDetails(this.selectedId);

      await this.ui.alert('המחיקה העתידית בוטלה בהצלחה.', 'בוצע');
    } catch (e: any) {
      console.error(e);
      await this.ui.alert(
        'ביטול המחיקה העתידית נכשל: ' + (e?.message ?? e),
        'שגיאה'
      );
    }
  }
}

@Component({
  selector: 'app-terms-pdf-dialog',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="pdf-head">
      <div class="pdf-title">{{ data.title || 'קובץ' }}</div>
      <button class="pdf-close" (click)="close()">✕</button>
    </div>

    <div class="viewer-body">
      <ng-container *ngIf="isImage(); else pdfTpl">
        <img
          class="image-frame"
          [src]="data.url"
          [alt]="data.title || 'image'"
        />
      </ng-container>

      <ng-template #pdfTpl>
        <iframe
          class="pdf-frame"
          [src]="data.url"
          title="PDF"
          loading="lazy"
        ></iframe>
      </ng-template>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      height: 100%;
    }

    .pdf-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 12px;
      border-bottom: 1px solid #e6e6e6;
      font-family: "Heebo", system-ui, Arial, sans-serif;
      box-sizing: border-box;
      height: 52px;
    }

    .pdf-title {
      font-weight: 800;
    }

    .pdf-close {
      border: none;
      background: transparent;
      font-size: 18px;
      cursor: pointer;
      line-height: 1;
      padding: 6px 10px;
    }

    .viewer-body {
      width: 100%;
      height: calc(100% - 52px);
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      background: #f8f8f8;
    }

    .image-frame {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      display: block;
    }

    .pdf-frame {
      width: 100%;
      height: 100%;
      border: 0;
      display: block;
    }
  `],
})
export class TermsPdfDialogComponent {
  readonly data = inject(MAT_DIALOG_DATA) as { title: string; url: SafeResourceUrl };
  private dialog = inject(MatDialog);

  isImage(): boolean {
    const url = String(this.data?.url ?? '').toLowerCase();
    return (
      url.includes('.png') ||
      url.includes('.jpg') ||
      url.includes('.jpeg') ||
      url.includes('.webp') ||
      url.includes('.gif')
    );
  }

  close() {
    this.dialog.closeAll();
  }
  todayDate(): string {
    return new Date().toISOString().slice(0, 10);
  }

}