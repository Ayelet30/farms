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
  health_fund?: string | null;
  status?: string | null;
  medical_notes?: string | null;
  behavior_notes?: string | null;
  parent?: ParentBrief | null;
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
  | 'health_fund'
  | 'status'
  | 'parent_status';

type ChildColumnDef = {
  key: ChildColumnKey;
  label: string;
  visible: boolean;
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

  readonly healthFunds = ['כללית', 'מכבי', 'מאוחדת', 'לאומית'] as const;

  readonly statusOptions = [
    { value: 'active', label: 'פעיל' },
    { value: null, label: '--' },
  ] as const;

  readonly STORAGE_KEY = 'secretary_children_table_prefs';

  columns: ChildColumnDef[] = [
    { key: 'first_name', label: 'שם פרטי', visible: true },
    { key: 'last_name', label: 'שם משפחה', visible: true },
    { key: 'gov_id', label: 'תעודת זהות', visible: true },
    { key: 'birth_date', label: 'תאריך לידה', visible: false },
    { key: 'gender', label: 'מין', visible: false },
    { key: 'health_fund', label: 'קופת חולים', visible: false },
    { key: 'status', label: 'סטטוס', visible: true },
    { key: 'parent_status', label: 'שיוך להורה', visible: true },
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

  selectedId: string | null = null;
  drawerLoading = false;
  drawerChild: ChildDetails | null = null;

  childForm: FormGroup | null = null;
  editMode = false;
  private originalChild: ChildDetails | null = null;

  searchText = '';
  searchMode: 'name' | 'id' = 'name';
  statusFilter: 'all' | 'active' | 'inactive' = 'all';
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
  ) {}

  async ngOnInit(): Promise<void> {
    try {
      this.loadTablePrefs();
      await ensureTenantContextReady();
      await this.loadChildren();
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
          health_fund,
          status
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
        const status = (c.status || '').toString().toLowerCase();
        const active = status === 'active' || status === 'פעיל';
        return this.statusFilter === 'active' ? active : !active;
      });
    }

    if (this.parentFilter === 'withParent') {
      rows = rows.filter((c: any) => !!c.parent_uid);
    } else if (this.parentFilter === 'withoutParent') {
      rows = rows.filter((c: any) => !c.parent_uid);
    }

    return rows;
  }

  private isChildActive(row: any): boolean {
    const status = (row?.status || '').toString().toLowerCase();
    return status === 'active' || row?.status === 'פעיל';
  }

  onFiltersChanged(): void {
    this.updateStats();
  }

  clearFilters() {
    this.searchText = '';
    this.searchMode = 'name';
    this.statusFilter = 'all';
    this.parentFilter = 'all';
    this.updateStats();
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
          health_fund,
          status,
          medical_notes,
          behavior_notes
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
    } catch (e) {
      console.error('loadDrawerData error:', e);
      this.drawerChild = null;
    } finally {
      this.drawerLoading = false;
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
          payment_docs_url
        `)
        .eq('child_id', childId)
        .eq('lesson_type', 'סידרה')
        .order('anchor_week_start', { ascending: false })
        .order('day_of_week', { ascending: true })
        .order('start_time', { ascending: true });

      if (error) throw error;

      this.seriesDocs = (data ?? []).map((row: any) => ({
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
      health_fund: [child.health_fund ?? null],
      status: [child.status ?? null],
      medical_notes: [
        child.medical_notes ?? '',
        [Validators.maxLength(this.MAX_MEDICAL_NOTES)],
      ],
      behavior_notes: [
        child.behavior_notes ?? '',
        [Validators.maxLength(this.MAX_BEHAVIOR_NOTES)],
      ],
    });

    this.originalChild = { ...child };
    this.editMode = false;
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

  async saveChildEdits() {
    if (!this.drawerChild || !this.childForm || !this.selectedId) return;

    const raw = this.childForm.getRawValue();

    const fieldsToCompare: (keyof ChildDetails)[] = [
      'first_name',
      'last_name',
      'health_fund',
      'status',
      'medical_notes',
      'behavior_notes',
    ];

    const delta: Partial<ChildDetails> = {};

    for (const key of fieldsToCompare) {
      const oldVal = (this.originalChild as any)?.[key] ?? null;
      const newVal = (raw as any)?.[key] ?? null;
      if (oldVal !== newVal) {
        (delta as any)[key] = newVal;
      }
    }

    if (Object.keys(delta).length === 0) {
      this.editMode = false;
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
}