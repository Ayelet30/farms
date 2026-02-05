import {
  Component,
  OnInit,
  ViewChild,
  HostListener,
  Inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatSidenav, MatSidenavModule } from '@angular/material/sidenav';
import { ensureTenantContextReady, dbTenant, getSupabaseClient } from '../../services/legacy-compat';
import type { ChildRow } from '../../Types/detailes.model';
import { UiDialogService } from '../../services/ui-dialog.service';
import { Router, RouterModule } from '@angular/router';

import { MatDialog, MatDialogModule, MAT_DIALOG_DATA } from '@angular/material/dialog';
import {
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
} from '@angular/forms';

import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { AddChildWizardComponent } from '../add-child-wizard/add-child-wizard.component';

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

// רשומת תקנון חתום
type TermsSignatureRow = {
  signed_pdf_bucket: string | null;
  signed_pdf_path: string | null;
  created_at: string | null;
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
  children: ChildRow[] = [];
  isLoading = true;
  error: string | null = null;

  @ViewChild('drawer') drawer!: MatSidenav;

  selectedId: string | null = null;
  drawerLoading = false;
  drawerChild: ChildDetails | null = null;

  // --- טופס עריכת ילד במגירה ---
  childForm: FormGroup | null = null;
  editMode = false;
  private originalChild: ChildDetails | null = null;

  // --- חיפוש / סינון ---
  searchText = '';
  searchMode: 'name' | 'id' = 'name';
  statusFilter: 'all' | 'active' | 'inactive' = 'all';
  parentFilter: 'all' | 'withParent' | 'withoutParent' = 'all';
  showSearchPanel = false;
  panelFocus: 'search' | 'filter' = 'search';
  showAddChildWizard = false;

  // --- סוסים לילדים ---
  horses: HorseLite[] = [];
  childHorses: Record<string, string[]> = {};
  savingChildHorses: Record<string, boolean> = {};

  // --- תקנון חתום לילד ---
  termsLoading = false;
  termsBucket: string | null = null;
  termsPath: string | null = null;
  termsCreatedAt: string | null = null;

  // --- הפניות (Storage) ---
referralsLoading = false;
referralsError: string | null = null;

referralFiles: {
  name: string;
  fullPath: string;
  updatedAt?: string | null;
  publicUrl?: string; // כי bucket public
}[] = [];

  constructor(
    private ui: UiDialogService,
    private fb: FormBuilder,
    private dialog: MatDialog,
    private sanitizer: DomSanitizer,
      private router: Router,
  ) {}

  async ngOnInit(): Promise<void> {
    console.log(this.router.config);

    try {
      await ensureTenantContextReady();
      await this.loadChildren();
    } catch (e: any) {
      this.error =
        'Failed to initialize tenant context or load children: ' +
        (e?.message ?? e);
      this.isLoading = false;
      console.error(e);
    }
  }
  goToChildLessonsHistory() {
  if (!this.drawerChild?.child_uuid) {
    this.ui.alert('לא ניתן לעבור להיסטוריית שיעורים – ילד לא מזוהה', 'שיעורים');
    return;
  }

this.router.navigate(
  ['/secretary/monthly-summary'],
  {
    queryParams: {
      childId: this.drawerChild.child_uuid,
      fromChild: true,
    },
  }
);

}

goToParentPaymentsFromChild() {
  const parentUid = this.drawerChild?.parent_uid;
  if (!parentUid) {
    this.ui.alert('לילד הזה אין הורה משויך, לכן אין אפשרות לסנן תשלומים.', 'תשלומים');
    return;
  }

  
  this.router.navigate(['/secretary/payments'], {
    queryParams: { parentUid },
  });
}

  /** Guard: תמיד לוודא טננט לפני DB */
  private async dbc() {
    await ensureTenantContextReady();
    const dbc = dbTenant();
    if (!dbc) throw new Error('dbTenant() returned undefined - tenant not ready');
    return dbc;
  }

  /** טוען את כל הילדים בסכימת הטננט הפעיל */
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
    } catch (e: any) {
      this.error = e?.message ?? 'Failed to fetch children.';
      this.children = [];
      console.error(e);
    } finally {
      this.isLoading = false;
      await this.loadHorsesAndChildMapping();
    }
  }

  /** טוען סוסים ומיפוי child_horses */
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
        .map(c => (c as any).child_uuid)
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

  /** רשימת ילדים אחרי חיפוש + סינון */
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

  // פתיחה/סגירה של חלונית החיפוש/סינון
  toggleSearchPanelFromBar() {
    this.panelFocus = 'search';
    this.showSearchPanel = !this.showSearchPanel;
  }

  toggleFromSearchIcon(event: MouseEvent) {
    event.stopPropagation();
    this.panelFocus = 'search';
    this.showSearchPanel = !this.showSearchPanel;
  }

  toggleFromFilterIcon(event: MouseEvent) {
    event.stopPropagation();
    this.panelFocus = 'filter';
    this.showSearchPanel = !this.showSearchPanel;
  }

  @HostListener('document:click')
  closeSearchPanelOnOutsideClick() {
    this.showSearchPanel = false;
  }

  clearFilters() {
    this.searchText = '';
    this.searchMode = 'name';
    this.statusFilter = 'all';
    this.parentFilter = 'all';
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
    this.referralFiles = [];
    this.referralsLoading = false;
    this.referralsError = null;

  }

  openAddChildDialog() {
    this.showAddChildWizard = true;
  }

  /** טוען פרטי ילד והורה למגירה + תקנון חתום */
  private async loadDrawerData(id: string) {
    this.drawerLoading = true;

    // reset terms
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
          .maybeSingle(); // ✅ לא יפיל 406 אם אין

        if (!pErr && p) parent = p as ParentBrief;
      }

      this.drawerChild = { ...(c as ChildDetails), parent, child_uuid: id };
      this.buildChildForm(this.drawerChild);

      // ✅ טען תקנון חתום (אם יש)
      await this.loadChildTermsSignature(id);
      await this.loadChildReferrals(id);

    } catch (e) {
      console.error('loadDrawerData error:', e);
      this.drawerChild = null;
    } finally {
      this.drawerLoading = false;
    }
  }

  /** מביא את התקנון החתום האחרון לילד (bucket/path) */
  private async loadChildTermsSignature(childId: string) {
    this.termsLoading = true;
    try {
      const db = await this.dbc();

      // חשוב: maybeSingle כדי למנוע 406 אם אין שורה
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
      // לא מפילים את המסך בגלל תקנון
      this.termsBucket = null;
      this.termsPath = null;
      this.termsCreatedAt = null;
    } finally {
      this.termsLoading = false;
    }
  }
 private async loadChildReferrals(childId: string) {
  this.referralsLoading = true;
  this.referralsError = null;
  this.referralFiles = [];

  try {
    const client = getSupabaseClient();
    const bucket = 'referrals';

    const folderPath = `referrals/${childId}`;
    const { data, error } = await client.storage
      .from(bucket)
      .list(folderPath, {
        limit: 100,
        sortBy: { column: 'updated_at', order: 'desc' },
      });

    if (error) {
      throw error;
    }

    this.referralFiles = (data ?? [])
      .filter((x: any) => !!x?.name)
      .map((x: any) => {
        const fullPath = `${folderPath}/${x.name}`;
        const { data: pub } = client.storage.from(bucket).getPublicUrl(fullPath);

        return {
          name: x.name,
          fullPath,
          updatedAt: x.updated_at ?? null,
          publicUrl: pub.publicUrl,
        };
      });

  } catch (e: any) {
    console.error('loadChildReferrals error:', e);
    this.referralsError = e?.message ?? 'שגיאה בטעינת הפניות';
    this.referralFiles = [];
  } finally {
    this.referralsLoading = false;
 
}

}

  /** פותח PDF של התקנון בדיאלוג */
  async openTermsPdf() {
    if (!this.termsBucket || !this.termsPath) {
      await this.ui.alert('אין תקנון חתום להצגה לילד זה.', 'תקנון');
      return;
    }

    try {
     const client = getSupabaseClient();
     console.log('dbTenant storage?', (client as any)?.storage);


      // Signed URL לשעה (אפשר לשנות)
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
      await this.ui.alert('לא הצלחתי לפתוח את ה-PDF: ' + (e?.message ?? e), 'תקנון');
    }
  }

  async openReferralPdf(file: { fullPath: string; publicUrl?: string }) {
  try {
    const client = getSupabaseClient();
    const bucket = 'referrals';

    let url = file.publicUrl;

    if (!url) {
      const { data, error } = await client.storage
        .from(bucket)
        .createSignedUrl(file.fullPath, 60 * 60);

      if (error) throw error;
      url = data?.signedUrl;
    }

    if (!url) throw new Error('No url returned');

    this.dialog.open(TermsPdfDialogComponent, {
      width: 'min(980px, 96vw)',
      height: 'min(90vh, 900px)',
      data: {
        title: 'הפניה (PDF)',
        url: this.sanitizer.bypassSecurityTrustResourceUrl(url),
      },
    });
  } catch (e: any) {
    console.error('openReferralPdf error:', e);
    await this.ui.alert('לא הצלחתי לפתוח את ההפניה: ' + (e?.message ?? e), 'הפניות');
  }
}


  /** בונה טופס עריכה מתוך פרטי הילד שבמגירה */
  private buildChildForm(child: ChildDetails) {
    this.childForm = this.fb.group({
      health_fund: [child.health_fund ?? null],
      status: [child.status ?? null],
      medical_notes: [child.medical_notes ?? null],
      behavior_notes: [child.behavior_notes ?? null],
    });

    this.originalChild = { ...child };
    this.editMode = false;
  }

  /** כניסה למצב עריכה במגירת הילד */
  enterEditModeChild() {
    if (!this.drawerChild || !this.childForm) return;
    this.editMode = true;
  }

  /** ביטול עריכה – חזרה לערכים המקוריים */
  cancelChildEdit() {
    if (!this.originalChild) {
      this.editMode = false;
      return;
    }
    this.buildChildForm(this.originalChild);
    this.editMode = false;
  }

  /** שמירת השינויים – PATCH רק על שדות ששונו */
  async saveChildEdits() {
    if (!this.drawerChild || !this.childForm || !this.selectedId) return;

    const raw = this.childForm.getRawValue();

    const fieldsToCompare: (keyof ChildDetails)[] = [
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

      this.children = this.children.map(c =>
        (c as any).child_uuid === this.selectedId
          ? { ...c, ...delta }
          : c,
      );

      this.editMode = false;
    } catch (e: any) {
      console.error(e);
      await this.ui.alert(
        'שמירת השינויים נכשלה: ' + (e?.message ?? e),
        'שמירה נכשלה',
      );
    }
  }

  /** האם לילד יש סוס מסוים */
  childHasHorse(childId: string | undefined, horseId: string): boolean {
    if (!childId) return false;
    const list = this.childHorses[childId] || [];
    return list.includes(horseId);
  }

  /** רשימת שמות סוסים לתצוגה */
  horseNamesForChild(childId: string | undefined): string {
    if (!childId) return '';
    const ids = this.childHorses[childId] || [];
    if (!ids.length) return '';
    const nameById = new Map(this.horses.map(h => [h.id, h.name]));
    return ids
      .map(id => nameById.get(id))
      .filter(Boolean)
      .join(', ');
  }

  /** הוספה/הסרה של סוס לילד */
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

/** דיאלוג להצגת PDF בתוך iframe */
@Component({
  selector: 'app-terms-pdf-dialog',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="pdf-head">
      <div class="pdf-title">{{ data!.title || 'PDF' }}</div>
      <button class="pdf-close" (click)="close()">✕</button>
    </div>

    <iframe
      class="pdf-frame"
      [src]="data.url"
      title="PDF"
      loading="lazy"
    ></iframe>
  `,
  styles: [`
    :host { display:block; height:100%; }
    .pdf-head{
      display:flex; align-items:center; justify-content:space-between;
      padding:10px 12px; border-bottom:1px solid #e6e6e6;
      font-family: "Heebo", system-ui, Arial, sans-serif;
    }
    .pdf-title{ font-weight:800; }
    .pdf-close{
      border:none; background:transparent; font-size:18px; cursor:pointer;
      line-height:1; padding:6px 10px;
    }
    .pdf-frame{
      width:100%; height: calc(100% - 52px);
      border:0;
    }
  `],
})
export class TermsPdfDialogComponent {
  constructor(
    @Inject(MAT_DIALOG_DATA) public data: { title: string; url: SafeResourceUrl },
    private dialog: MatDialog,
  ) {}

  close() {
    this.dialog.closeAll();
  }
}
