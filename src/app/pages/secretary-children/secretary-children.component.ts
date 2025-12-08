import {
  Component,
  OnInit,
  ViewChild,
  HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatSidenav, MatSidenavModule } from '@angular/material/sidenav';

import { ensureTenantContextReady, dbTenant } from '../../services/legacy-compat';
import type { ChildRow } from '../../Types/detailes.model';

import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import {
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
} from '@angular/forms';
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

  constructor(
    private dialog: MatDialog,
    private fb: FormBuilder,
  ) {}

  async ngOnInit(): Promise<void> {
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

  /** טוען את כל הילדים בסכימת הטננט הפעיל */
  async loadChildren(): Promise<void> {
    this.isLoading = true;
    this.error = null;

    try {
      const dbc = dbTenant();

      const { data, error } = await dbc
        .from('children')
        .select(
          `
          child_uuid,
          first_name,
          last_name,
          parent_uid,
          gov_id,
          birth_date,
          gender,
          health_fund,
          status
        `,
        )
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
      const db = dbTenant();

      // כל הסוסים
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

      // מיפוי סוסים לכל ילד קיים
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
  }

  openAddChildDialog() {
    this.showAddChildWizard = true;
  }

  /** טוען פרטי ילד והורה למגירה */
  private async loadDrawerData(id: string) {
    this.drawerLoading = true;

    try {
      const db = dbTenant();

      const { data: c, error: cErr } = await db
        .from('children')
        .select(
          `
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
        `,
        )
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
    } catch (e) {
      console.error('loadDrawerData error:', e);
      this.drawerChild = null;
    } finally {
      this.drawerLoading = false;
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
      const db = dbTenant();

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
      alert('שמירת השינויים נכשלה: ' + (e?.message ?? e));
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

    const db = dbTenant();

    try {
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
      alert('שמירת התאמת הסוס נכשלה');
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
