import { Component, OnInit, ViewChild, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatSidenav, MatSidenavModule } from '@angular/material/sidenav';

import { ensureTenantContextReady, dbTenant } from '../../services/legacy-compat';
import type { AddChildPayload, ChildRow } from '../../Types/detailes.model';

import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { FormsModule } from '@angular/forms';
import { AddChildWizardComponent } from "../add-child-wizard/add-child-wizard.component";

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
  imports: [CommonModule, FormsModule, MatSidenavModule, MatDialogModule, AddChildWizardComponent],
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

  // 🔍 חיפוש / סינון – כמו בטבלת הורים
  searchText = '';
  searchMode: 'name' | 'id' = 'name';
  statusFilter: 'all' | 'active' | 'inactive' = 'all';
  parentFilter: 'all' | 'withParent' | 'withoutParent' = 'all';
  showSearchPanel = false;
  panelFocus: 'search' | 'filter' = 'search';
  showAddChildWizard = false;

    // ===== סוסים מתאימים לילדים =====
  horses: HorseLite[] = [];                        // כל הסוסים בחווה
  childHorses: Record<string, string[]> = {};      // child_uuid -> [horse_id, ...]
  savingChildHorses: Record<string, boolean> = {}; // child_uuid -> isSaving


  constructor(private dialog: MatDialog) {}

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
    await this.loadHorsesAndChildMapping();
      this.isLoading = false;
    }
  }

  /** רשימת ילדים אחרי חיפוש + סינון */
  get filteredChildren(): ChildRow[] {
    let rows = [...this.children];

    const q = (this.searchText || '').trim().toLowerCase();
    if (q) {
      rows = rows.filter((c: any) => {
        if (this.searchMode === 'name') {
          const hay = `${c.first_name || ''} ${c.last_name || ''}`.toLowerCase();
          return hay.includes(q);
        }

        const id = (c.gov_id || '').toString().trim();
        return id === q;
      });
    }

    // סינון לפי סטטוס ילד
    if (this.statusFilter !== 'all') {
      rows = rows.filter((c: any) => {
        const status = (c.status || '').toString().toLowerCase();
        const active = status === 'active' || status === 'פעיל';
        return this.statusFilter === 'active' ? active : !active;
      });
    }

    // סינון לפי שיוך להורה
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
  }

  /** פתיחת דיאלוג הוספת ילד/ה חדש/ה */
 // SecretaryChildrenComponent
openAddChildDialog() {
  this.showAddChildWizard = true;
}


  /** טוען פרטי ילד והורה למגירה */
  private async loadDrawerData(id: string) {
    this.drawerLoading = true;

    try {
      const db = dbTenant();

      // 1) פרטי הילד
      const { data: c, error: cErr } = await db
        .from('children')
        .select(
          `
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

      // 2) פרטי ההורה
      let parent: ParentBrief | null = null;

      if (c?.parent_uid) {
        const { data: p, error: pErr } = await db
          .from('parents')
          .select('first_name,last_name, phone, email')
          .eq('uid', c.parent_uid)
          .maybeSingle();

        if (!pErr && p) parent = p as ParentBrief;
      }

      // 3) שמירה לתצוגה
      this.drawerChild = { ...(c as ChildDetails), parent };
      this.drawerChild.child_uuid = id;
    } catch (e) {
      console.error('loadDrawerData error:', e);
      this.drawerChild = null;
    } finally {
      this.drawerLoading = false;
    }
  }

   handleChildAddedFromWizard() {
    // ריענון רשימת הילדים אחרי סיום אשף
    this.loadChildren();
    this.showAddChildWizard = false;
  }
closeWizard() {
    this.showAddChildWizard = false;
  }

    // טענת רשימת סוסים + מיפוי ילד–סוסים
  private async loadHorsesAndChildMapping(): Promise<void> {
    const db = dbTenant();

    // 1) סוסים
    const { data: horsesData, error: horsesError } = await db
      .from('horses')
      .select('id, name, is_active')
      .order('name', { ascending: true });

    if (horsesError) {
      console.error('שגיאה בטעינת סוסים:', horsesError);
      this.horses = [];
    } else {
      const list = (horsesData ?? []) as HorseLite[];
      this.horses = list; // אם תרצי רק פעילים: list.filter(h => h.is_active)
    }

    // 2) מיפוי מילד לסוסים (child_horses)
    const childIds = this.children
      .map(c => c.child_uuid)
      .filter(Boolean) as string[];

    if (!childIds.length) {
      this.childHorses = {};
      return;
    }

    const { data: chData, error: chError } = await db
      .from('child_horses')
      .select('child_id, horse_id')
      .in('child_id', childIds);

    if (chError) {
      console.error('שגיאה בטעינת child_horses:', chError);
      this.childHorses = {};
      return;
    }

    const mapping: Record<string, string[]> = {};
    for (const row of (chData ?? []) as { child_id: string; horse_id: string }[]) {
      if (!mapping[row.child_id]) mapping[row.child_id] = [];
      mapping[row.child_id].push(row.horse_id);
    }
    this.childHorses = mapping;
  }

    // מחזיר איזה סוסים משויכים לילד מסוים
  childHorsesFor(childId: string | undefined | null): string[] {
    if (!childId) return [];
    return this.childHorses[childId] ?? [];
  }

  // האם לסוס מסוים יש התאמה לילד?
  childHasHorse(childId: string | undefined | null, horseId: string): boolean {
    return this.childHorsesFor(childId).includes(horseId);
  }

  // הוספה/הסרה של התאמה ילד–סוס
  async toggleChildHorse(
    childUid: string | undefined | null,
    horseId: string,
    checked: boolean
  ): Promise<void> {
    console.log("@@@@@@@@@@@", childUid, horseId, checked);
    if (!childUid) return;

    const db = dbTenant();
    this.savingChildHorses[childUid] = true;

    if (checked) {
      // הוספת קשר
      const { error } = await db
        .from('child_horses')
        .insert({ child_id: childUid, horse_id: horseId });

      if (error) {
        console.error('שגיאה בהוספת סוס לילד:', error);
        // אפשר להוסיף הודעת שגיאה אם תרצי
      } else {
        const set = new Set(this.childHorses[childUid] ?? []);
        set.add(horseId);
        this.childHorses[childUid] = Array.from(set);
      }
    } else {
      // הסרת קשר
      const { error } = await db
        .from('child_horses')
        .delete()
        .eq('child_id', childUid)
        .eq('horse_id', horseId);

      if (error) {
        console.error('שגיאה בהסרת סוס מילד:', error);
      } else {
        const set = new Set(this.childHorses[childUid] ?? []);
        set.delete(horseId);
        this.childHorses[childUid] = Array.from(set);
      }
    }

    this.savingChildHorses[childUid] = false;
  }



}
