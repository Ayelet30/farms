import {
  Component,
  OnInit,
  ViewChild,
  HostListener,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatSidenav, MatSidenavModule } from '@angular/material/sidenav';
import { WaitingListDialog } from '../../shared/components/waiting-list-dialog/waiting-list-dialog';
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
type SeriesReferral = {
  id: string;
  url: string;
  name: string;
  uploadedAt: string | null;
  validUntil: string | null;
};


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
  paymentPlanName: string | null;

  currentPaymentPlanId: string | null;
  currentPaymentPlanName: string | null;

  paymentPlanSchedule: {
    paymentPlanId: string;
    paymentPlanName: string;
    effectiveFrom: string;
  }[];

  paymentDocsHistory: SeriesReferral[];

  requiredDocs: string[];
  requireDocsAtBooking: boolean | null;

  instructorId: string | null;
  instructorName: string | null;
};

type IntakeType = 'REGULAR' | 'INTAKE_ZERO' | 'INTAKE';

type ChildLessonHistoryRow = {
  lessonId: string;
  occurDate: string;
  dayOfWeek: string | null;
  startTime: string | null;
  endTime: string | null;
  instructorId: string | null;
  instructorName: string | null;
  lessonType: string | null;
  status: string;
  attendanceStatus: string | null;
  isCancellation: boolean;
  isBillable: boolean | null;
  isMakeupAllowed: boolean | null;
  officeNotes: string | null;
  instructorNotes: string | null;
  childId: string;
  exceptionDate: string;
  rawStatus: string;

  makeupLessonText: string | null;
  intakeType: IntakeType;
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
  documentType: string;
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

type ExistsFilter = 'all' | 'exists' | 'missing';

type HelmetFilter =
  | 'all'
  | 'exists'
  | 'missing'
  | 'purchased'
  | 'home';


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
    WaitingListDialog
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

    healthDeclaration: 'all' as ExistsFilter,
    paymentCard: 'all' as ExistsFilter,
    helmet: 'all' as HelmetFilter,
  };

  instructors: { id_number: string; first_name?: string | null; last_name?: string | null; name?: string | null }[] = [];
  lessonTypes: string[] = [];
  lessonDays: string[] = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

  termsByChild: Record<string, { signed: boolean; signedAt: string | null }> = {};
  intakeByChild: Record<string, boolean> = {};

  healthDeclarationByChild: Record<string, boolean> = {};
  paymentCardByParent: Record<string, boolean> = {};

  paymentPlanOptions: {
    id: string;
    name: string;
  }[] = [];

  seriesPaymentPlanEditor = {
    lessonId: null as string | null,
    paymentPlanId: null as string | null,
    effectiveFrom: '',
    saving: false,
    error: '',
  };


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
  savingEdit = false;
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

  parentsByUid: Record<
    string,
    {
      uid: string;
      first_name: string;
      last_name: string;
      email: string | null;
    }
  > = {};

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
  statusFilter: 'all' | 'active' | 'inactive' | 'pending' = 'active';
  parentFilter: 'all' | 'withParent' | 'withoutParent' = 'all';
  showSearchPanel = false;
  showColumnsPanel = false;
  panelFocus: 'search' | 'filter' = 'search';
  showAddChildWizard = false;
  showWaitingListDialog = false;
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

  showLessonsHistory = false;
  lessonsHistoryLoading = false;
  lessonsHistoryError: string | null = null;

  lessonsHistory: ChildLessonHistoryRow[] = [];
  lessonsHistoryFrom = '';
  lessonsHistoryTo = '';
  lessonsHistoryStatus = 'all';
  lessonsHistoryDateSort: 'asc' | 'desc' = 'desc';

  seriesEndEditor = {
    lessonId: null as string | null,
    endDate: '',
    saving: false,
    error: '',
  };

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
      this.loadHistoryColumnPrefs();
      await ensureTenantContextReady();
      await this.loadFundingSources();
      await this.loadPaymentPlanOptions();
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
    this.intakeMenuKey = null;
    this.showSearchPanel = false;
    this.showColumnsPanel = false;
  }

  intakeMenuKey: string | null = null;

toggleIntakeMenu(
  event: MouseEvent,
  lesson: ChildLessonHistoryRow
): void {
  event.stopPropagation();

  if (this.intakeSaving[this.intakeRowKey(lesson)]) return;

  const key = this.intakeRowKey(lesson);
  this.intakeMenuKey = this.intakeMenuKey === key ? null : key;
}

async chooseIntakeType(
  event: MouseEvent,
  lesson: ChildLessonHistoryRow,
  value: IntakeType
): Promise<void> {
  event.stopPropagation();
  this.intakeMenuKey = null;

  if (lesson.intakeType === value) return;

  await this.saveLessonIntakeType(lesson, value);
}

  get visibleColumns(): ChildColumnDef[] {
    return this.columns.filter((c) => c.visible);
  }

  private hebrewNameValidator(): (
    control: AbstractControl
  ) => ValidationErrors | null {
    const hebrewNameRegex = /^[\u0590-\u05FF\s'"\-]+$/;

    return (control: AbstractControl): ValidationErrors | null => {
      const value = String(control.value ?? '')
        .normalize('NFKC')
        .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
        .replace(/\u00A0/g, ' ')
        .trim();

      if (!value) {
        return null;
      }

      return hebrewNameRegex.test(value)
        ? null
        : { hebrewName: true };
    };
  }

  private cleanHebrewName(value: unknown): string {
    return String(value ?? '')
      .normalize('NFKC')
      .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  isActiveStatus(status: string | null | undefined): boolean {
    return String(status ?? '').toLowerCase() === 'active';
  }

  async goToChildLessonsHistory(): Promise<void> {
    if (!this.drawerChild?.child_uuid) {
      await this.ui.alert('לא ניתן לפתוח את השיעורים – ילד לא מזוהה', 'שיעורים');
      return;
    }

    this.showLessonsHistory = true;
    await this.loadChildLessonsHistory();
  }

  closeChildLessonsHistory(): void {
    this.showLessonsHistory = false;
    this.lessonsHistoryError = null;
  }

  private async loadPaymentPlanOptions(): Promise<void> {
    try {
      const db = await this.dbc();

      const { data, error } = await db
        .from('payment_plans')
        .select('id, name')
        .eq('is_active', true)
        .order('name', { ascending: true });

      if (error) throw error;

      this.paymentPlanOptions = (data ?? []).map((row: any) => ({
        id: row.id,
        name: row.name,
      }));
    } catch (e) {
      console.error('loadPaymentPlanOptions error:', e);
      this.paymentPlanOptions = [];
    }
  }

 async loadChildLessonsHistory(): Promise<void> {
  const childId = this.drawerChild?.child_uuid;
  if (!childId || this.lessonsHistoryLoading) return;

  this.lessonsHistoryLoading = true;
  this.lessonsHistoryError = null;

  try {
    const db = await this.dbc();

    let query = db
      .from('lessons_occurrences')
      .select('*')
      .eq('child_id', childId)
      .order('occur_date', { ascending: false });

    if (this.lessonsHistoryFrom) {
      query = query.gte('occur_date', this.lessonsHistoryFrom);
    }

    if (this.lessonsHistoryTo) {
      query = query.lte('occur_date', this.lessonsHistoryTo);
    }

    const { data, error } = await query.limit(1000);
    if (error) throw error;

    const rawRows = data ?? [];
    const attendanceRows: any[] = [];
    const noteRows: any[] = [];
    for (const table of ['lesson_attendance', 'lesson_notes_simple']) {
      let offset = 0;
      while (true) {
        let q = db.from(table).select('*').eq('child_id', childId);
        q = table === 'lesson_attendance'
          ? q.order('lesson_id').order('occur_date')
          : q.order('id');
        const result = await q.range(offset, offset + 99);
        if (result.error) throw result.error;
        const page = result.data ?? [];
        (table === 'lesson_attendance' ? attendanceRows : noteRows).push(...page);
        if (page.length < 100) break;
        offset += page.length;
      }
    }
    this.historyNoteRows = noteRows;
    const attendanceMap = new Map<string, string>(attendanceRows.map((r: any) =>
      [`${r.lesson_id}_${String(r.occur_date).slice(0, 10)}`, r.attendance_status]
    ));
    const notesText = (id: string, date: string, office: boolean): string | null => {
      const values = noteRows.filter((n: any) =>
        String(n.lesson_id) === id && String(n.occur_date).slice(0, 10) === date &&
        (office ? n.category === 'office' : ['general', 'medical', 'behavioral'].includes(n.category))
      ).sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at)));
      return values.map((n: any) => n.note).filter(Boolean).join('\n\n') || null;
    };


    const intakeByOccurrence = new Map<string, IntakeType>();

    const lessonIds: string[] = Array.from(
      new Set<string>(
        rawRows
          .map((row: any) => String(row.lesson_id ?? ''))
          .filter((id: string) => !!id)
      )
    );

    for (let i = 0; i < lessonIds.length; i += 100) {
      const batch = lessonIds.slice(i, i + 100);
      let offset = 0;

      while (true) {
        let metadataQuery = db
          .from('lesson_occurrence_metadata')
          .select('lesson_id, occur_date, intake_type')
          .in('lesson_id', batch)
          .order('lesson_id')
          .order('occur_date');

        if (this.lessonsHistoryFrom) {
          metadataQuery = metadataQuery.gte(
            'occur_date',
            this.lessonsHistoryFrom
          );
        }

        if (this.lessonsHistoryTo) {
          metadataQuery = metadataQuery.lte(
            'occur_date',
            this.lessonsHistoryTo
          );
        }

        const {
          data: metadata,
          error: metadataError,
        } = await metadataQuery.range(offset, offset + 99);

        if (metadataError) throw metadataError;

        const page = metadata ?? [];

        for (const entry of page) {
          const key =
            `${entry.lesson_id}_${String(entry.occur_date).slice(0, 10)}`;

          intakeByOccurrence.set(
            key,
            entry.intake_type as IntakeType
          );
        }

        if (page.length < 100) break;
        offset += page.length;
      }
    }

    const instructorIds: string[] = Array.from(
      new Set<string>(
        rawRows
          .map((row: any) =>
            String(row.instructor_id ?? row.instructor_id_number ?? '')
          )
          .filter((id: string) => !!id)
      )
    );

    let instructorNameById: Record<string, string> = {};

    if (instructorIds.length) {
      const {
        data: instructorsData,
        error: instructorsError,
      } = await db
        .from('instructors')
        .select('id_number, first_name, last_name')
        .in('id_number', instructorIds);

      if (instructorsError) throw instructorsError;

      instructorNameById = Object.fromEntries(
        (instructorsData ?? []).map((instructor: any) => [
          instructor.id_number,
          `${instructor.first_name ?? ''} ${instructor.last_name ?? ''}`.trim(),
        ])
      );
    }

    this.lessonsHistory = rawRows.map(
      (row: any): ChildLessonHistoryRow => {
        const lessonId = String(row.lesson_id ?? row.id ?? '');

        const occurDate = String(
          row.occur_date ??
          row.occurrence_date ??
          row.lesson_date ??
          ''
        ).slice(0, 10);

        const instructorId =
          row.instructor_id ?? row.instructor_id_number ?? null;

        const isCancellation = Boolean(
          row.is_cancellation ||
          row.canceled_at ||
          ['canceled', 'cancelled', 'בוטל', 'מבוטל'].includes(
            String(row.status ?? row.lesson_status ?? '')
              .trim()
              .toLowerCase()
          )
        );

        return {
          lessonId,
          occurDate,
          childId,
          exceptionDate: String(row.original_occur_date ?? occurDate).slice(0, 10),
          rawStatus: String(row.status ?? ''),
          instructorNotes: notesText(lessonId, occurDate, false),
          dayOfWeek: row.day_of_week ?? null,
          startTime: row.start_time ?? null,
          endTime: row.end_time ?? null,
          instructorId,
          instructorName:
            row.instructor_name ??
            (instructorId ? instructorNameById[instructorId] : null) ??
            null,

          lessonType: row.lesson_type ?? row.appointment_kind ?? null,

          intakeType:
            intakeByOccurrence.get(`${lessonId}_${occurDate}`) ??
            'REGULAR',

          status: this.getLessonHistoryStatus(row, isCancellation),
          attendanceStatus:
            attendanceMap.get(`${lessonId}_${occurDate}`) ?? null,
          isCancellation,

          isBillable: this.nullableBoolean(
            row.is_billable ?? row.chargeable
          ),
          isMakeupAllowed: this.nullableBoolean(row.is_makeup_allowed),

          officeNotes:
            notesText(lessonId, occurDate, true),

          makeupLessonText:
            row.makeup_lesson_text ??
            row.makeup_for_text ??
            (row.makeup_for_lesson_id
              ? `שיעור ${row.makeup_for_lesson_id}`
              : null) ??
            (row.completed_by_lesson_id
              ? `הושלם בשיעור ${row.completed_by_lesson_id}`
              : null),
        };
      }
    );
  } catch (e: any) {
    console.error('loadChildLessonsHistory error:', e);
    this.lessonsHistory = [];
    this.lessonsHistoryError =
      e?.message ?? 'שגיאה בטעינת היסטוריית השיעורים';
  } finally {
    this.lessonsHistoryLoading = false;
  }
}

intakeSaving: Record<string, boolean> = {};

intakeRowKey(row: ChildLessonHistoryRow): string {
  return `${row.lessonId}_${String(row.occurDate).slice(0, 10)}`;
}

async saveLessonIntakeType(
  row: ChildLessonHistoryRow,
  value: string
): Promise<void> {
  if (!['REGULAR', 'INTAKE_ZERO', 'INTAKE'].includes(value)) return;

  const key = this.intakeRowKey(row);
  if (this.intakeSaving[key]) return;

  const occurDate = String(row.occurDate ?? '').slice(0, 10);
  if (!row.lessonId || !occurDate) return;

  this.intakeSaving[key] = true;

  try {
    const db = await this.dbc();

    const { data, error } = await db
      .from('lesson_occurrence_metadata')
      .upsert(
        {
          lesson_id: row.lessonId,
          occur_date: occurDate,
          intake_type: value,
        },
        { onConflict: 'lesson_id,occur_date' }
      )
      .select('intake_type')
      .single();

    if (error) throw error;

    row.intakeType = data.intake_type as IntakeType;
  } catch (error: any) {
    console.error('saveLessonIntakeType error:', error);

    await this.ui.alert(
      'שמירת סימון האינטייק נכשלה: ' +
        (error?.message ?? error),
      'שגיאה'
    );
  } finally {
    this.intakeSaving[key] = false;
  }
}


  historyColumnDefs = [
    { key: 'date', label: 'תאריך', visible: true },
    { key: 'time', label: 'שעה', visible: true },
    { key: 'instructor', label: 'מדריך', visible: true },
    { key: 'type', label: 'סוג שיעור', visible: true },
    { key: 'status', label: 'סטטוס', visible: true },
    { key: 'attendance', label: 'נוכחות', visible: true },
    { key: 'billable', label: 'מחויב', visible: true },
    { key: 'makeup', label: 'ניתן להשלמה', visible: true },
    { key: 'instructorNotes', label: 'הערות מדריך', visible: true },
    { key: 'officeNotes', label: 'הערת משרד', visible: true },
  ];
  historyRowEditing: string | null = null;
  historyColumnsOpen = false;
  isHistoryRowEditing(row: ChildLessonHistoryRow): boolean {
    return this.historyRowEditing === this.historySaveKey(row, 'edit');
  }
  toggleHistoryRowEdit(row: ChildLessonHistoryRow): void {
    if (Object.values(this.historyBusy).some(Boolean)) return;
    this.historyRowEditing = this.isHistoryRowEditing(row)
      ? null : this.historySaveKey(row, 'edit');
    this.intakeMenuKey = null;
    this.historyEditError = '';
  }
  historyRowBusy(): boolean {
    return Object.values(this.historyBusy).some(Boolean);
  }
  historyNoteRows: any[] = [];
  historyBusy: Record<string, boolean> = {};
  historyEditError = '';
  historyNoteEditor: {
    open: boolean; saving: boolean; error: string;
    row: ChildLessonHistoryRow | null; office: boolean;
    entries: Array<{ id: string; note: string; original: string; category: string; createdAt: string }>;
    newNote: string;
  } = { open: false, saving: false, error: '', row: null, office: false, entries: [], newNote: '' };

  historyColumnVisible(key: string): boolean {
    return this.historyColumnDefs.find(c => c.key === key)?.visible !== false;
  }
  private historyPrefsKey(): string {
    const farm = getCurrentFarmMetaSync();
    // Tenant-scoped browser preference; no clinical data stored here.
    return `children-history-columns-v2:${farm?.schema_name ?? 'current'}`;
  }
  loadHistoryColumnPrefs(): void {
    try {
      const saved = JSON.parse(localStorage.getItem(this.historyPrefsKey()) ?? '{}');
      for (const c of this.historyColumnDefs) {
        if (typeof saved[c.key] === 'boolean') c.visible = saved[c.key];
      }
      if (!this.historyColumnDefs.some(c => c.visible)) this.historyColumnDefs[0].visible = true;
    } catch { /* defaults */ }
  }
  saveHistoryColumnPrefs(): void {
    if (!this.historyColumnDefs.some(c => c.visible)) this.historyColumnDefs[0].visible = true;
    try {
      localStorage.setItem(this.historyPrefsKey(), JSON.stringify(
        Object.fromEntries(this.historyColumnDefs.map(c => [c.key, c.visible]))
      ));
    } catch { /* preferences remain active in this session */ }
  }
  historySaveKey(row: ChildLessonHistoryRow, field: string): string {
    return `${row.lessonId}_${row.occurDate}_${row.childId}_${field}`;
  }
  async saveHistoryAttendance(row: ChildLessonHistoryRow, value: string): Promise<void> {
    if (!this.isHistoryRowEditing(row)) return;
    if (!['unknown', 'present', 'absent', 'excused'].includes(value)) return;
    const key = this.historySaveKey(row, 'attendance');
    if (this.historyBusy[key]) return;
    this.historyBusy[key] = true;
    this.historyEditError = '';
    try {
      const db = await this.dbc();
      const result = await db.from('lesson_attendance').upsert({
        lesson_id: row.lessonId, child_id: row.childId, occur_date: row.occurDate,
        attendance_status: value, marked_at: new Date().toISOString(),
        marked_by_role: 'secretary',
      }, { onConflict: 'lesson_id,child_id,occur_date' }).select('attendance_status').single();
      if (result.error) throw result.error;
      row.attendanceStatus = result.data.attendance_status;
    } catch (e: any) {
      this.historyEditError = 'שמירת הנוכחות נכשלה: ' + (e?.message ?? e);
    } finally { this.historyBusy[key] = false; }
  }
  async saveHistoryFlag(row: ChildLessonHistoryRow, field: 'is_billable' | 'is_makeup_allowed', value: boolean): Promise<void> {
    if (!this.isHistoryRowEditing(row)) return;
    const key = this.historySaveKey(row, 'flags');
    if (this.historyBusy[key]) return;
    this.historyBusy[key] = true;
    this.historyEditError = '';
    try {
      const db = await this.dbc();
      // Farm closures override these fields in the view. Do not claim a successful override.
      const off = await db.from('farm_days_off')
        .select('day_type,start_time,end_time').eq('is_active', true)
        .lte('start_date', row.occurDate).gte('end_date', row.occurDate);
      if (off.error) throw off.error;
      if ((off.data ?? []).some((d: any) => d.day_type === 'FULL_DAY' ||
        (['HALF_DAY', 'HOURS'].includes(d.day_type) && row.startTime && row.endTime &&
         row.startTime < d.end_time && row.endTime > d.start_time))) {
        throw new Error('בחופשת חווה ערכים אלה נקבעים על ידי חופשת החווה ולא ניתן לשנותם כאן.');
      }
      const existing = await db.from('lesson_occurrence_exceptions')
        .select('id,status,is_billable,is_makeup_allowed')
        .eq('lesson_id', row.lessonId).eq('occur_date', row.exceptionDate).maybeSingle();
      if (existing.error) throw existing.error;
      if (existing.data) {
        const result = await db.from('lesson_occurrence_exceptions')
          .update({ [field]: value }).eq('id', existing.data.id)
          .eq(field, existing.data[field]).select('id').maybeSingle();
        if (result.error) throw result.error;
        if (!result.data) throw new Error('הנתונים השתנו במקביל. רענני את הרשימה ונסי שוב.');
      } else {
        const base = await db.from('lessons').select('status').eq('id', row.lessonId).single();
        if (base.error) throw base.error;
        const allowed = ['ממתין לאישור', 'אושר', 'בוטל', 'הושלם', 'נשלחה בקשה להשלמה', 'נשלחה בקשה למילוי מקום'];
        if (!allowed.includes(String(base.data.status))) throw new Error('סטטוס השיעור אינו נתמך לעריכת חריג.');
        const result = await db.from('lesson_occurrence_exceptions').insert({
          lesson_id: row.lessonId, occur_date: row.exceptionDate,
          status: base.data.status,
          is_billable: row.isBillable ?? true,
          is_makeup_allowed: row.isMakeupAllowed ?? false,
          [field]: value,
        }).select('id').single();
        if (result.error) throw result.error;
      }
      if (field === 'is_billable') row.isBillable = value;
      else row.isMakeupAllowed = value;
    } catch (e: any) {
      this.historyEditError = 'שמירת השינוי נכשלה: ' + (e?.message ?? e);
    } finally { this.historyBusy[key] = false; }
  }
  openHistoryNotes(row: ChildLessonHistoryRow, office: boolean): void {
    if (!this.isHistoryRowEditing(row)) return;
    this.historyNoteEditor = {
      open: true, saving: false, error: '', row, office, newNote: '',
      entries: this.historyNoteRows.filter(n => String(n.lesson_id) === row.lessonId &&
        String(n.child_id) === row.childId && String(n.occur_date).slice(0, 10) === row.occurDate &&
        (office ? n.category === 'office' : ['general','medical','behavioral'].includes(n.category)))
        .map(n => ({ id: n.id, note: n.note ?? '', original: n.note ?? '', category: n.category, createdAt: n.created_at })),
    };
  }
  closeHistoryNotes(): void {
    if (!this.historyNoteEditor.saving) this.historyNoteEditor.open = false;
  }
  async saveHistoryNotes(): Promise<void> {
    const editor = this.historyNoteEditor;
    const row = editor.row;
    if (!row || editor.saving) return;
    editor.saving = true; editor.error = '';
    try {
      const db = await this.dbc();
      for (const entry of editor.entries) {
        if (entry.note === entry.original) continue;
        if (!entry.note.trim()) throw new Error('אין לרוקן הערה קיימת. ניתן לערוך את תוכנה.');
        const result = await db.from('lesson_notes_simple').update({ note: entry.note.trim() })
          .eq('id', entry.id).eq('lesson_id', row.lessonId).eq('child_id', row.childId)
          .eq('occur_date', row.occurDate).eq('note', entry.original).select('id,note').maybeSingle();
        if (result.error) throw result.error;
        if (!result.data) throw new Error('הערה השתנתה במקביל או שאין הרשאת עריכה. רענני את הרשימה.');
        entry.original = result.data.note; entry.note = result.data.note;
        const local = this.historyNoteRows.find(n => n.id === entry.id);
        if (local) local.note = entry.note;
      }
      if (editor.newNote.trim()) {
        const result = await db.from('lesson_notes_simple').insert({
          lesson_id: row.lessonId, child_id: row.childId, occur_date: row.occurDate,
          category: editor.office ? 'office' : 'general', note: editor.newNote.trim(),
        }).select('*').single();
        if (result.error) throw result.error;
        this.historyNoteRows.push(result.data);
        editor.entries.push({ id: result.data.id, note: result.data.note, original: result.data.note,
          category: result.data.category, createdAt: result.data.created_at });
        editor.newNote = '';
      }
      editor.open = false;
    } catch (e: any) { editor.error = e?.message ?? 'שמירת ההערות נכשלה'; }
    finally {
      const notes = this.historyNoteRows.filter(n => String(n.lesson_id) === row.lessonId &&
        String(n.child_id) === row.childId && String(n.occur_date).slice(0, 10) === row.occurDate);
      row.officeNotes = notes.filter(n => n.category === 'office').map(n => n.note).join('\n\n') || null;
      row.instructorNotes = notes.filter(n => ['general','medical','behavioral'].includes(n.category)).map(n => n.note).join('\n\n') || null;
      editor.saving = false;
    }
  }

  get filteredLessonsHistory(): ChildLessonHistoryRow[] {
    let rows = [...this.lessonsHistory];

    if (this.lessonsHistoryStatus !== 'all') {
      rows = rows.filter(
        row => row.status === this.lessonsHistoryStatus
      );
    }

    rows.sort((a, b) => {
      const aDate = a.occurDate ?? '';
      const bDate = b.occurDate ?? '';

      return this.lessonsHistoryDateSort === 'asc'
        ? aDate.localeCompare(bDate)
        : bDate.localeCompare(aDate);
    });

    return rows;
  }

  private nullableBoolean(value: unknown): boolean | null {
    return typeof value === 'boolean' ? value : null;
  }

  private getLessonHistoryStatus(row: any, isCancellation: boolean): string {
    if (isCancellation) return 'בוטל';
    if (row.completed_by_lesson_id || row.makeup_completed_at) return 'הושלם';
    if (row.moved_to_date || row.is_moved) return 'הועבר';

    const raw = String(row.lesson_status ?? row.status ?? '').toLowerCase();
    if (['done', 'completed', 'התקיים'].includes(raw)) return 'התקיים';
    if (['approved', 'אושר'].includes(raw)) return 'מאושר';
    if (['pending', 'ממתין'].includes(raw)) return 'ממתין';

    const occurDate = String(row.occur_date ?? row.occurrence_date ?? row.lesson_date ?? '');
    return occurDate && occurDate < this.todayDate() ? 'התקיים' : 'עתידי';
  }

  lessonAttendanceLabel(value: string | null): string {
    const normalized = String(value ?? '').toUpperCase();
    if (['V', 'PRESENT', 'ATTENDED', 'נוכח'].includes(normalized)) return 'נכח/ה';
    if (['X', 'ABSENT', 'לא נוכח'].includes(normalized)) return 'לא נכח/ה';
    return value || 'לא דווח';
  }

  yesNoUnknown(value: boolean | null): string {
    if (value === true) return 'כן';
    if (value === false) return 'לא';
    return '—';
  }

  exportChildLessonsHistory(): void {
    const rows = this.filteredLessonsHistory.map((row, index) => ({
      'מספר': index + 1,
      'תאריך': row.occurDate ? this.formatDateForExcel(row.occurDate) : '—',
      'יום': row.dayOfWeek ?? '—',
      'שעה': `${this.formatTimeShort(row.startTime)}–${this.formatTimeShort(row.endTime)}`,
      'מדריך': row.instructorName ?? '—',
      'סוג שיעור': row.lessonType ?? '—',
      'סטטוס': row.status,
      'נוכחות': this.lessonAttendanceLabel(row.attendanceStatus),
      'מחויב': this.yesNoUnknown(row.isBillable),
      'ניתן להשלמה': this.yesNoUnknown(row.isMakeupAllowed),
      'שיעור השלמה': row.makeupLessonText ?? '—',
      'הערות מדריך': row.instructorNotes ?? '',
      'הערת משרד': row.officeNotes ?? '',
    }));

    const sheet = XLSX.utils.json_to_sheet(rows);
    sheet['!cols'] = [8, 13, 10, 15, 20, 18, 14, 14, 12, 16, 30, 35]
      .map(width => ({ wch: width }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'שיעורי הילד');
    const file = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const childName = `${this.drawerChild?.first_name ?? ''}-${this.drawerChild?.last_name ?? ''}`;
    saveAs(new Blob([file]), `שיעורים-${childName || 'ילד'}.xlsx`);
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
      await this.loadParentsForChildren();
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

  private async loadParentsForChildren(): Promise<void> {
    try {
      const parentUids = Array.from(
        new Set(
          this.children
            .map((child: any) => child.parent_uid)
            .filter(Boolean)
        )
      ) as string[];

      this.parentsByUid = {};

      if (!parentUids.length) return;

      const db = await this.dbc();

      const { data, error } = await db
        .from('parents')
        .select('uid, first_name, last_name, email')
        .in('uid', parentUids);

      if (error) throw error;

      this.parentsByUid = Object.fromEntries(
        (data ?? []).map((parent: any) => [
          parent.uid,
          {
            uid: parent.uid,
            first_name: parent.first_name ?? '',
            last_name: parent.last_name ?? '',
            email: parent.email ?? null,
          },
        ])
      );
    } catch (error) {
      console.error('loadParentsForChildren failed:', error);
      this.parentsByUid = {};
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
  referralBusy = false;

referralDrafts: Record<string, {
  file: File | null;
  validUntil: string;
}> = {};

referralDraft(lessonId: string) {
  return this.referralDrafts[lessonId] ??= {
    file: null,
    validUntil: '',
  };
}

selectSeriesReferral(event: Event, lessonId: string): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0] ?? null;

  if (!this.referralBusy) {
    this.referralDraft(lessonId).file = file;
  }

  input.value = '';
}

referralExpired(doc: SeriesReferral): boolean {
  if (!doc.validUntil) return false;

  const now = new Date();
  const today = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');

  return doc.validUntil < today;
}

/**
 * קוראים מחדש לפני שמירה.
 * מוסיפים גם קישור קיים שלא נכנס להיסטוריה,
 * למשל אם הועלה דרך מסך אחר.
 */
private async readSeriesReferrals(lessonId: string) {
  const db = await this.dbc();

  const { data, error } = await db
    .from('lessons')
    .select('id, payment_docs_url, payment_docs_history')
    .eq('id', lessonId)
    .single();

  if (error) throw error;

  const original: SeriesReferral[] =
    Array.isArray(data.payment_docs_history)
      ? data.payment_docs_history
      : [];

  const docs = [...original];

  if (
    data.payment_docs_url &&
    !docs.some(doc => doc.url === data.payment_docs_url)
  ) {
    docs.push({
      id: crypto.randomUUID(),
      url: data.payment_docs_url,
      name: 'הפניה קודמת',
      uploadedAt: null,
      validUntil: null,
    });
  }

  return {
    original,
    docs,
    currentUrl: data.payment_docs_url as string | null,
  };
}

/**
 * עדכון ההיסטוריה והקישור הנוכחי באותה פעולת DB.
 * תנאי השמירה מונעים דריסה של שינוי ממסך אחר.
 */
private async saveSeriesReferrals(
  lessonId: string,
  previous: {
    original: SeriesReferral[];
    currentUrl: string | null;
  },
  docs: SeriesReferral[],
  currentUrl: string | null,
): Promise<void> {
  const db = await this.dbc();

  let query = db
    .from('lessons')
    .update({
      payment_docs_history: docs,
      payment_docs_url: currentUrl,
    })
    .eq('id', lessonId)
    .eq(
      'payment_docs_history',
      JSON.stringify(previous.original)
    );

  query = previous.currentUrl === null
    ? query.is('payment_docs_url', null)
    : query.eq('payment_docs_url', previous.currentUrl);

  const { data, error } = await query
    .select('id')
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    throw new Error(
      'ההפניות השתנו במקביל או שאין הרשאת עדכון. ' +
      'פתחי מחדש את פרטי הילד ונסי שוב.'
    );
  }

  this.seriesDocs = this.seriesDocs.map(series =>
    series.lessonId === lessonId
      ? {
          ...series,
          paymentDocsHistory: docs,
          paymentDocsUrl: currentUrl,
        }
      : series
  );
}

async uploadSeriesReferral(lessonId: string): Promise<void> {
  if (this.referralBusy) return;

  const draft = this.referralDraft(lessonId);
  const file = draft.file;

  if (!file) return;

  if (!this.isAllowedReferralFile(file)) {
    await this.ui.alert(
      'ניתן להעלות PDF או תמונות PNG/JPG/WEBP.',
      'קובץ לא נתמך'
    );
    return;
  }

  const validUntil = draft.validUntil || null;

  this.referralBusy = true;
  this.uploadingSeriesDocLessonId = lessonId;

  let uploadedPath: string | null = null;
  let saved = false;

  const client = getSupabaseClient();

  try {
    const previous = await this.readSeriesReferrals(lessonId);
    const id = crypto.randomUUID();
    const extension = file.name.split('.').pop()?.toLowerCase()
      || 'pdf';

    const path = `series-referrals/${lessonId}/${id}.${extension}`;

    const { error: uploadError } = await client.storage
      .from('referrals')
      .upload(path, file, {
        upsert: false,
        contentType: file.type || undefined,
      });

    if (uploadError) throw uploadError;
    uploadedPath = path;

    const { data } = client.storage
      .from('referrals')
      .getPublicUrl(path);

    if (!data.publicUrl) {
      throw new Error('לא נוצר קישור למסמך.');
    }

    const doc: SeriesReferral = {
      id,
      url: data.publicUrl,
      name: file.name,
      uploadedAt: new Date().toISOString(),
      validUntil,
    };

    await this.saveSeriesReferrals(
      lessonId,
      previous,
      [...previous.docs, doc],
      doc.url
    );

    saved = true;

    this.referralDrafts[lessonId] = {
      file: null,
      validUntil: '',
    };

    await this.ui.alert(
      'ההפניה נוספה. ההפניות הקודמות נשמרו בהיסטוריה.',
      'ההפניה נשמרה'
    );
  } catch (error: any) {
    // קובץ שהועלה אך לא שויך לסדרה אינו נדרש.
    if (uploadedPath && !saved) {
      try {
        const { error: cleanupError } = await client.storage
          .from('referrals')
          .remove([uploadedPath]);

        if (cleanupError) {
          console.warn('Referral cleanup failed:', cleanupError);
        }
      } catch (cleanupError) {
        console.warn('Referral cleanup failed:', cleanupError);
      }
    }

    await this.ui.alert(
      'העלאת ההפניה נכשלה: ' + (error?.message ?? error),
      'שגיאה'
    );
  } finally {
    this.referralBusy = false;
    this.uploadingSeriesDocLessonId = null;
  }
}

async deleteSeriesReferral(
  series: SeriesDocRow,
  doc: SeriesReferral
): Promise<void> {
  if (this.referralBusy) return;

  this.referralBusy = true;

  try {
    const confirmed = await this.ui.confirm({
      title: 'מחיקת הפניה',
      message:
        `להסיר את "${doc.name}" מהסדרה? ` +
        'אם זו ההפניה הנוכחית, ההפניה האחרונה שנותרה תשמש במקומה.',
      okText: 'מחיקת הפניה',
      cancelText: 'ביטול',
      dangerText: 'מחיקת הפניה',
    });

    if (!confirmed) return;

    const previous = await this.readSeriesReferrals(series.lessonId);

    if (!previous.docs.some(item => item.id === doc.id)) {
      throw new Error(
        'ההפניה כבר השתנתה. פתחי מחדש את פרטי הילד.'
      );
    }

    const remaining = previous.docs.filter(
      item => item.id !== doc.id
    );

    const nextUrl = previous.currentUrl === doc.url
      ? remaining[remaining.length - 1]?.url ?? null
      : previous.currentUrl;

    await this.saveSeriesReferrals(
      series.lessonId,
      previous,
      remaining,
      nextUrl
    );
  } catch (error: any) {
    await this.ui.alert(
      'מחיקת ההפניה נכשלה: ' + (error?.message ?? error),
      'שגיאה'
    );
  } finally {
    this.referralBusy = false;
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

    if (!meta?.hasActiveSeries) return false;

    return f.referral === 'exists'
      ? meta.hasReferral
      : meta.missingReferral;
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

  get filteredChildrenParents(): Array<{
    uid: string;
    first_name: string;
    last_name: string;
    email: string;
  }> {
    const uniqueParents = new Map<
      string,
      {
        uid: string;
        first_name: string;
        last_name: string;
        email: string;
      }
    >();

    for (const child of this.filteredChildren as any[]) {
      const parentUid = child.parent_uid;

      if (!parentUid) continue;

      const parent = this.parentsByUid[parentUid];
      const email = String(parent?.email ?? '')
        .trim()
        .toLowerCase();

      if (!parent || !this.isValidEmail(email)) continue;

      uniqueParents.set(parentUid, {
        uid: parentUid,
        first_name: parent.first_name,
        last_name: parent.last_name,
        email,
      });
    }

    return Array.from(uniqueParents.values());
  }

  private isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  async sendEmailToFilteredChildrenParents(): Promise<void> {
    const parents = this.filteredChildrenParents;

    if (!parents.length) {
      await this.ui.alert(
        'לא נמצאו כתובות מייל תקינות להורי הילדים המוצגים.',
        'שליחת הודעה'
      );
      return;
    }

    const emails = parents.map(parent => parent.email);

    await navigator.clipboard.writeText(emails.join('; '));

    if (emails.length > 80) {
      window.open(
        'https://mail.google.com/mail/?view=cm&fs=1',
        '_blank'
      );

      await this.ui.alert(
        `${emails.length} כתובות הועתקו ללוח.\n` +
        `בגלל כמות הנמענים, יש להדביק אותן ידנית בשדה BCC.`,
        'כתובות הועתקו'
      );

      return;
    }

    const bcc = encodeURIComponent(emails.join(','));
    const subject = encodeURIComponent('הודעה מחוות בראשית');

    const gmailUrl =
      `https://mail.google.com/mail/?view=cm&fs=1&bcc=${bcc}&su=${subject}`;

    window.open(gmailUrl, '_blank');
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
    this.statusFilter = 'active';
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

      healthDeclaration: 'all',
      paymentCard: 'all',
      helmet: 'all',
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

    if (f.intake !== 'all') {
  chips.push({
    label: 'אינטק: ' + (
      f.intake === 'exists' ? 'יש אינטק' : 'אין אינטק'
    ),
    clear: () => f.intake = 'all',
  });
}

if (f.referral !== 'all') {
  chips.push({
    label: 'הפניה: ' + (
      f.referral === 'exists' ? 'יש הפניה' : 'חסרה הפניה'
    ),
    clear: () => f.referral = 'all',
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

  async openDetails(id?: string): Promise<void> {
    if (!id) return;

    // אם עברנו לילד אחר - סוגרים טפסים פתוחים
    if (this.selectedId !== id) {
      // יציאה ממצב עריכה
      this.editMode = false;
      this.closeWaitingListDialog();
    }

    // הצגת הילד החדש
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
    this.showLessonsHistory = false;
    this.lessonsHistory = [];
    this.lessonsHistoryError = null;
  }

  openAddChildDialog() {
    this.showAddChildWizard = true;
  }


  openWaitingListDialog(): void {
    if (!this.drawerChild?.child_uuid) return;
    this.showWaitingListDialog = true;
  }

  closeWaitingListDialog(): void {
    this.showWaitingListDialog = false;
  }

  getWaitingListChildAge(): number | null {
    const birthDate = this.drawerChild?.birth_date;

    if (!birthDate) return null;

    const parts = birthDate.slice(0, 10).split('-').map(Number);

    if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) {
      return null;
    }

    const [year, month, day] = parts;
    const today = new Date();

    let age = today.getFullYear() - year;

    if (
      today.getMonth() + 1 < month ||
      (today.getMonth() + 1 === month && today.getDate() < day)
    ) {
      age--;
    }

    return age >= 0 ? age : null;
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
        document_type,
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
        documentType: row.document_type ?? 'GENERAL',
        bucket: row.bucket,
        filePath: row.file_path,
        fileUrl: row.file_url,
        mimeType: row.mime_type,
        fileSize: row.file_size,
        createdAt: row.created_at,
      }));

      this.allChildDocs = docs;


this.childDocs = docs.filter(
  (  doc: { documentType: string; }) => doc.documentType !== 'INTAKE'
);

this.intakeByChild = {
  ...this.intakeByChild,
  [childId]: docs.some(
    (    doc: { documentType: string; }) => doc.documentType === 'INTAKE'
  ),
};

this.updateStats();

    } catch (e: any) {
      console.error('loadChildDocuments error:', e);
      this.childDocsError = e?.message ?? 'שגיאה בטעינת מסמכי הילד';
    } finally {
      this.childDocsLoading = false;
    }
  }

   async uploadChildDocument(
  event: Event,
  documentType: 'GENERAL' | 'INTAKE' = 'GENERAL'
): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  const childId = this.drawerChild?.child_uuid;

  if (!file || !childId || this.uploadingChildDoc) return;

  const docName = documentType === 'INTAKE'
    ? 'אינטק'
    : this.newChildDocName.trim();

  if (!docName) {
    await this.ui.alert(
      'יש להזין שם קובץ לפני ההעלאה.',
      'שם קובץ חסר'
    );
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
          document_type: documentType,
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
  return this.allChildDocs.find(
    doc => doc.documentType === 'INTAKE'
  ) ?? null;
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

  private async loadChildSeriesDocs(childId: string): Promise<void> {
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
        payment_docs_history,
        payment_docs_url,
        payment_plan_id,
        instructor_id,
        payment_plans (
          name,
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

      // -----------------------------
      // שמות מדריכים
      // -----------------------------

      const instructorIds = Array.from(
        new Set(
          rows
            .map((r: any) => r.instructor_id)
            .filter(Boolean)
        )
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

      // -----------------------------
      // שינויי מסלול לפי תאריך
      // -----------------------------

      const lessonIds = rows
        .map((r: any) => r.id)
        .filter(Boolean);

      let periods: any[] = [];

      if (lessonIds.length) {
        const { data: periodsData, error: periodsError } = await db
          .from('lesson_payment_plan_periods')
          .select(`
          id,
          lesson_id,
          payment_plan_id,
          effective_from,
          created_at
        `)
          .in('lesson_id', lessonIds)
          .order('effective_from', { ascending: true });

        if (periodsError) throw periodsError;

        periods = periodsData ?? [];
      }

      // -----------------------------
      // שמות כל מסלולי התשלום
      // כולל מסלולים לא פעילים
      // -----------------------------

      const allPaymentPlanIds = Array.from(
        new Set(
          [
            ...rows.map((r: any) => r.payment_plan_id),
            ...periods.map((p: any) => p.payment_plan_id),
          ].filter(Boolean)
        )
      );

      let paymentPlanNameById: Record<string, string> = {};

      if (allPaymentPlanIds.length) {
        const { data: plansData, error: plansError } = await db
          .from('payment_plans')
          .select('id, name')
          .in('id', allPaymentPlanIds);

        if (plansError) throw plansError;

        paymentPlanNameById = Object.fromEntries(
          (plansData ?? []).map((p: any) => [
            p.id,
            p.name,
          ])
        );
      }

      const today = this.getTodayIsoDate();

      // -----------------------------
      // בניית הסדרות למסך
      // -----------------------------

      this.seriesDocs = rows.map((row: any) => {
        const paymentPlanData = Array.isArray(row.payment_plans)
          ? row.payment_plans[0]
          : row.payment_plans;

        const seriesPeriods = periods
          .filter((p: any) => p.lesson_id === row.id)
          .sort((a: any, b: any) =>
            String(a.effective_from).localeCompare(
              String(b.effective_from)
            )
          );

        const currentPeriod = [...seriesPeriods]
          .filter((p: any) =>
            String(p.effective_from) <= today
          )
          .sort((a: any, b: any) =>
            String(b.effective_from).localeCompare(
              String(a.effective_from)
            )
          )[0];

        const basePaymentPlanId =
          row.payment_plan_id ?? null;

        const currentPaymentPlanId =
          currentPeriod?.payment_plan_id ??
          basePaymentPlanId;

        return {
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
          paymentDocsHistory: Array.isArray(row.payment_docs_history)
  ? row.payment_docs_history
  : [],

          paymentPlanId: basePaymentPlanId,

          paymentPlanName: basePaymentPlanId
            ? (
              paymentPlanNameById[basePaymentPlanId] ??
              paymentPlanData?.name ??
              null
            )
            : null,

          currentPaymentPlanId,

          currentPaymentPlanName: currentPaymentPlanId
            ? paymentPlanNameById[currentPaymentPlanId] ?? null
            : null,

          paymentPlanSchedule: seriesPeriods.map((p: any) => ({
            paymentPlanId: p.payment_plan_id,

            paymentPlanName:
              paymentPlanNameById[p.payment_plan_id] ??
              'מסלול לא ידוע',

            effectiveFrom: p.effective_from,
          })),

          requiredDocs:
            paymentPlanData?.required_docs ?? [],

          requireDocsAtBooking:
            paymentPlanData?.require_docs_at_booking ?? null,

          instructorId:
            row.instructor_id ?? null,

          instructorName: row.instructor_id
            ? (
              instructorNameById[row.instructor_id] ??
              row.instructor_id
            )
            : null,
        } as SeriesDocRow;
      });

    } catch (e: any) {
      console.error('loadChildSeriesDocs error:', e);

      this.seriesDocsError =
        e?.message ??
        'שגיאה בטעינת סדרות והפניות';

      this.seriesDocs = [];
    } finally {
      this.seriesDocsLoading = false;
    }
  }

  toggleLessonsHistoryDateSort(): void {
    this.lessonsHistoryDateSort =
      this.lessonsHistoryDateSort === 'asc'
        ? 'desc'
        : 'asc';
  }

  getTodayIsoDate(): string {
    const d = new Date();

    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');

    return `${yyyy}-${mm}-${dd}`;
  }

  openSeriesPaymentPlanEditor(series: SeriesDocRow): void {
    if (
      this.seriesEndEditor.lessonId === series.lessonId
    ) {
      this.closeSeriesEndEditor();
    }

    this.seriesPaymentPlanEditor = {
      lessonId: series.lessonId,

      paymentPlanId:
        series.currentPaymentPlanId ??
        series.paymentPlanId ??
        null,

      effectiveFrom: this.isSeriesCurrentlyOpen(series)
        ? this.getTodayIsoDate()
        : '',

      saving: false,
      error: '',
    };
  }

  closeSeriesPaymentPlanEditor(): void {
    if (this.seriesPaymentPlanEditor.saving) return;

    this.seriesPaymentPlanEditor = {
      lessonId: null,
      paymentPlanId: null,
      effectiveFrom: '',
      saving: false,
      error: '',
    };
  }

  async saveSeriesPaymentPlan(series: SeriesDocRow): Promise<void> {
    const paymentPlanId = this.seriesPaymentPlanEditor.paymentPlanId;
    const effectiveFrom = this.seriesPaymentPlanEditor.effectiveFrom;

    this.seriesPaymentPlanEditor.error = '';

    if (!paymentPlanId) {
      this.seriesPaymentPlanEditor.error = 'יש לבחור מסלול תשלום.';
      return;
    }

    if (!effectiveFrom) {
      this.seriesPaymentPlanEditor.error = 'יש לבחור תאריך תחולה.';
      return;
    }

    const startDate = series.anchorWeekStart?.slice(0, 10) ?? null;
const endDate = series.seriesEndDate?.slice(0, 10);

    if (!startDate) {
      this.seriesPaymentPlanEditor.error =
        'לא ניתן לזהות את תאריך תחילת הסדרה.';
      return;
    }

    if (effectiveFrom < startDate) {
      this.seriesPaymentPlanEditor.error =
        'תאריך תחולת המסלול לא יכול להיות לפני תחילת הסדרה.';
      return;
    }

    if (endDate && effectiveFrom > endDate) {
      this.seriesPaymentPlanEditor.error =
        'תאריך תחולת המסלול לא יכול להיות אחרי סיום הסדרה.';
      return;
    }

    if (
      this.seriesPaymentPlanEditor.saving ||
      this.seriesPaymentPlanEditor.lessonId !== series.lessonId
    ) {
      return;
    }

    const childId = this.drawerChild?.child_uuid ?? null;

    this.seriesPaymentPlanEditor.saving = true;

    try {
      const db = await this.dbc();

      const { error } = await db.rpc('change_series_payment_plan', {
        p_lesson_id: series.lessonId,
        p_payment_plan_id: paymentPlanId,
        p_effective_from: effectiveFrom,
        p_created_by_uid: null,
        p_note: 'שינוי מסלול מכרטיס ילד',
      });

      if (error) {
        throw error;
      }

      /*
       * חשוב:
       * מיד לאחר השמירה טוענים מחדש מה-DB.
       * לא מעדכנים רק מקומית את שם המסלול,
       * כדי שגם היסטוריית המסלולים והמסלול האפקטיבי
       * יחושבו מחדש לפי הנתונים האמיתיים.
       */
      if (childId) {
        await this.loadChildSeriesDocs(childId);
      }

      /*
       * איפוס ישיר של העורך.
       * לא משתמשים כאן ב-closeSeriesPaymentPlanEditor()
       * כי בזמן הזה saving עדיין true.
       */
      this.seriesPaymentPlanEditor = {
        lessonId: null,
        paymentPlanId: null,
        effectiveFrom: '',
        saving: false,
        error: '',
      };

      await this.ui.alert(
        'מסלול התשלום עודכן בהצלחה.',
        'שינוי מסלול תשלום'
      );

    } catch (e: any) {
      console.error('[saveSeriesPaymentPlan] failed', e);

      this.seriesPaymentPlanEditor.saving = false;

      this.seriesPaymentPlanEditor.error =
        e?.message ?? 'שמירת מסלול התשלום נכשלה.';
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
    if (row.seriesEndDate) {
      return row.seriesEndDate;
    }

    if (row.isOpenEnded) {
      return 'סדרה ללא הגבלה';
    }

    return '—';
  }

  isSeriesCurrentlyOpen(row: SeriesDocRow): boolean {
    return row.isOpenEnded === true && !row.seriesEndDate;
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
        this.cleanHebrewName(child.first_name),
        [
          Validators.required,
          Validators.maxLength(this.MAX_NAME_LEN),
          this.hebrewNameValidator(),
        ],
      ],
      last_name: [
        this.cleanHebrewName(child.last_name),
        [
          Validators.required,
          Validators.maxLength(this.MAX_NAME_LEN),
          this.hebrewNameValidator(),
        ],
      ],
      gov_id: [
        child.gov_id ?? '',
        [Validators.pattern(/^\d{9}$/)],
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

    if (this.childForm.invalid) {
      this.childForm.markAllAsTouched();


    }
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

  const docsData: Array<{
  child_id: string;
  document_name: string | null;
  document_type: string;
}> = [];

for (let i = 0; i < childIds.length; i += 100) {
  const batch = childIds.slice(i, i + 100);
  let offset = 0;

  while (true) {
    const { data, error } = await db
      .from('child_documents')
      .select('id, child_id, document_name, document_type')
      .in('child_id', batch)
      .order('id', { ascending: true })
      .range(offset, offset + 99);

    if (error) throw error;

    const page = data ?? [];
    docsData.push(...page);

    if (page.length < 100) break;
    offset += page.length;
  }
}

    this.intakeByChild = {};
    this.healthDeclarationByChild = {};

    for (const row of docsData ?? []) {
      const childId = String((row as any).child_id ?? '');
      
      const documentName = String(
        (row as any).document_name ?? ''
      )
        .replace(/\s+/g, ' ')
        .trim();

      if (!childId) continue;

      if (row.document_type === 'INTAKE') {
  this.intakeByChild[childId] = true;
}

      if (
        documentName === 'הצהרת בריאות' ||
        documentName === 'הצהרת בריאות חתומה' ||
        documentName.includes('הצהרת בריאות')
      ) {
        this.healthDeclarationByChild[childId] = true;
      }
    }

    const lessonsData: any[] = [];

for (let i = 0; i < childIds.length; i += 100) {
  const batch = childIds.slice(i, i + 100);
  let offset = 0;

  while (true) {
    const { data, error } = await db
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
        payment_docs_history,
        payment_docs_url,
        payment_plans (
          required_docs,
          require_docs_at_booking
        )
      `)
      .in('child_id', batch)
      .order('id', { ascending: true })
      .range(offset, offset + 99);

    if (error) throw error;

    const page = data ?? [];
    lessonsData.push(...page);

    if (page.length < 100) break;
    offset += page.length;
  }
}

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

      const today = this.getTodayIsoDate();

const status = String(r.status ?? '').trim().toLowerCase();
const lessonType = String(r.lesson_type ?? '').trim();

const isSeries = ['סידרה', 'סדרה', 'SERIES']
  .includes(lessonType.toUpperCase());

const isApproved = ['active', 'approved', 'אושר']
  .includes(status);

const startDate = String(r.anchor_week_start ?? '').slice(0, 10);
const endDate = String(r.series_end_date ?? '').slice(0, 10);

const isActiveSeries =
  isSeries &&
  isApproved &&
  (!startDate || startDate <= today) &&
  (!endDate || endDate >= today);

if (isActiveSeries) {
  meta.hasActiveSeries = true;

  const referrals: SeriesReferral[] =
    Array.isArray(r.payment_docs_history)
      ? [...r.payment_docs_history]
      : [];

  const currentUrl = String(r.payment_docs_url ?? '').trim();

  // תמיכה בהפניות ישנות שנשמרו רק כקישור
  if (
    currentUrl &&
    !referrals.some(doc =>
      String(doc.url ?? '').trim() === currentUrl
    )
  ) {
    referrals.push({
      id: `legacy_${r.id}`,
      url: currentUrl,
      name: 'הפניה קודמת',
      uploadedAt: null,
      validUntil: null,
    });
  }

  const hasValidReferral = referrals.some(doc =>
    !!String(doc.url ?? '').trim() &&
    !this.referralExpired(doc)
  );

  if (hasValidReferral) {
    meta.hasReferral = true;
  } else {
    meta.missingReferral = true;
  }

  const plan = Array.isArray(r.payment_plans)
    ? r.payment_plans[0]
    : r.payment_plans;

  if (
    !hasValidReferral &&
    plan?.require_docs_at_booking &&
    Array.isArray(plan.required_docs) &&
    plan.required_docs.length > 0
  ) {
    meta.missingRequiredDocs = true;
  }
}

      if (r.anchor_week_start) {
        meta.lessonDates.push(r.anchor_week_start);
      }
    }

    this.lessonTypes = Array.from(typeSet).sort();

    console.log('בדיקת סינון אינטק', {
  filters: { ...this.advancedFilters },
  statusFilter: this.statusFilter,
  loadedChildren: this.children.length,
  childrenWithIntake: Object.values(this.intakeByChild)
    .filter(Boolean).length,
  displayedChildren: this.filteredChildren.length,
});

console.table(
  this.children
    .filter(child => this.intakeByChild[child.child_uuid])
    .map(child => ({
      name: `${child.first_name ?? ''} ${child.last_name ?? ''}`,
      status: child.status,
      active: this.isChildActive(child),
    }))
);
  }

  private isIntakeDocumentName(value: unknown): boolean {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .trim() === 'אינטק';
}

  openSeriesEndEditor(row: SeriesDocRow): void {
    this.seriesEndEditor = {
      lessonId: row.lessonId,
      endDate: '',
      saving: false,
      error: '',
    };
  }

  closeSeriesEndEditor(): void {
    if (this.seriesEndEditor.saving) return;

    this.seriesEndEditor = {
      lessonId: null,
      endDate: '',
      saving: false,
      error: '',
    };
  }

  private getSeriesActualStartDateIso(row: SeriesDocRow): string | null {
    if (!row.anchorWeekStart) return null;

    const dayOffset = row.dayOfWeek
      ? this.hebrewDayIndex[row.dayOfWeek]
      : undefined;

    if (dayOffset === undefined) {
      return row.anchorWeekStart.slice(0, 10);
    }

    const [year, month, day] = row.anchorWeekStart
      .slice(0, 10)
      .split('-')
      .map(Number);

    if (!year || !month || !day) return null;

    const date = new Date(year, month - 1, day);
    date.setDate(date.getDate() + dayOffset);

    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');

    return `${yyyy}-${mm}-${dd}`;
  }

  getSeriesStartDateForInput(row: SeriesDocRow): string | null {
    return this.getSeriesActualStartDateIso(row);
  }

  async confirmSeriesEnd(row: SeriesDocRow): Promise<void> {
    if (
      this.seriesEndEditor.lessonId !== row.lessonId ||
      this.seriesEndEditor.saving
    ) {
      return;
    }

    this.seriesEndEditor.error = '';

    const endDate = this.seriesEndEditor.endDate;
    const startDate = this.getSeriesActualStartDateIso(row);

    if (!endDate) {
      this.seriesEndEditor.error = 'יש לבחור תאריך סיום.';
      return;
    }

    if (!startDate) {
      this.seriesEndEditor.error =
        'לא ניתן לזהות את תאריך תחילת הסדרה.';
      return;
    }

    // השוואה תקינה מפני ששני התאריכים בפורמט YYYY-MM-DD
    if (endDate <= startDate) {
      this.seriesEndEditor.error =
        `תאריך הסיום חייב להיות מאוחר מתאריך תחילת הסדרה ` +
        `(${this.formatIsoDateForDisplay(startDate)}).`;
      return;
    }

    this.seriesEndEditor.saving = true;

    try {
      const db = await this.dbc();

      const { error } = await db.rpc('end_lesson_series', {
        p_lesson_id: row.lessonId,
        p_effective_occur_date: endDate,
        p_note: null,
      });

      if (error) throw error;

      const childId = this.drawerChild?.child_uuid;

      this.seriesEndEditor = {
        lessonId: null,
        endDate: '',
        saving: false,
        error: '',
      };

      if (childId) {
        await this.loadChildSeriesDocs(childId);
      }

      await this.ui.alert(
        `הסדרה הסתיימה בהצלחה מתאריך ${this.formatIsoDateForDisplay(endDate)}.`,
        'סיום סדרה'
      );
    } catch (error: any) {
      console.error('confirmSeriesEnd error:', error);

      this.seriesEndEditor.saving = false;
      this.seriesEndEditor.error =
        error?.message || 'אירעה שגיאה בסיום הסדרה.';
    }
  }

  private formatIsoDateForDisplay(value: string): string {
    const [year, month, day] = value.split('-');

    if (!year || !month || !day) return value;

    return `${day}/${month}/${year}`;
  }

  async saveChildEdits() {
    if (!this.drawerChild || !this.childForm || !this.selectedId) return;

    const raw = this.childForm.getRawValue();

    raw.gov_id = String(raw.gov_id ?? '').trim();

    this.childForm.patchValue(
      { gov_id: raw.gov_id },
      { emitEvent: false }
    );

    raw.first_name = this.cleanHebrewName(raw.first_name);
    raw.last_name = this.cleanHebrewName(raw.last_name);

    this.childForm.patchValue(
      {
        first_name: raw.first_name,
        last_name: raw.last_name,
      },
      { emitEvent: false }
    );

    this.childForm.updateValueAndValidity();

    if (this.childForm.invalid) {
      this.childForm.markAllAsTouched();
      return;
    }

    const becameInactive =
      this.isActiveStatus(this.originalChild?.status) &&
      raw.status === 'Deleted';

    const fieldsToCompare: (keyof ChildDetails)[] = [
      'gov_id',
      'first_name',
      'last_name',
      'funding_source_id',
      'status',
      'medical_notes',
      'behavior_notes',
      'created_at',
    ];

    const delta: Partial<ChildDetails> = {};

    for (const key of fieldsToCompare) {
      const oldVal = (this.originalChild as any)?.[key] ?? null;
      const newVal = (raw as any)?.[key] ?? null;

      if (oldVal !== newVal) {
        (delta as any)[key] = newVal;
      }
    }

    // שמירה כפעיל מבטלת כל תכנון להפיכה ללא פעיל,
    // גם אם הילד כבר מוצג כפעיל ונשאר לו תכנון ישן.
    if (
      this.isActiveStatus(raw.status) &&
      (
        !this.isActiveStatus(this.originalChild?.status) ||
        this.drawerChild?.scheduled_deletion_at != null ||
        this.drawerChild?.deletion_requested_at != null ||
        this.drawerChild?.deletion_note != null
      )
    ) {
      (delta as any).status = 'Active';
      (delta as any).deletion_requested_at = null;
      (delta as any).scheduled_deletion_at = null;
      (delta as any).deletion_note = null;
    }

    if (Object.keys(delta).length === 0) {
      this.editMode = false;
      return;
    }

    // ולידציה לפני שמתחילים מצב טעינה
    if (becameInactive && !raw.inactive_date) {
      await this.ui.alert(
        'חובה לבחור תאריך הפיכת ילד ללא פעיל',
        'שגיאה'
      );
      return;
    }

    // מניעת לחיצה כפולה
    if (this.savingEdit) return;

    this.savingEdit = true;

    try {
      // הפיכת ילד ללא פעיל
      if (becameInactive) {
        const inactiveDate = raw.inactive_date;

        const db = await this.dbc();

        const deletionNote = String(
          raw.deletion_note ?? ''
        ).trim();

        const { error } = await db.rpc(
          'schedule_child_inactivation',
          {
            p_child_uuid: this.selectedId,
            p_inactive_date: inactiveDate,
            p_deletion_note: deletionNote || null,
          }
        );

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

      // שמירת שינויים רגילה
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
          : c
      );

      this.updateStats();
      this.editMode = false;

    } catch (e: any) {
      console.error(e);

      await this.ui.alert(
        'שמירת השינויים נכשלה: ' + (e?.message ?? e),
        'שמירה נכשלה'
      );

    } finally {
      this.savingEdit = false;
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
