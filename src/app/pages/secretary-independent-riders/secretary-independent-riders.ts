import { Component, OnInit, ViewChild, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatSidenav, MatSidenavModule } from '@angular/material/sidenav';
import { RouterModule } from '@angular/router';
import { dbTenant } from '../../services/legacy-compat';
import { UiDialogService } from '../../services/ui-dialog.service';

type RiderStatus = 'active' | 'inactive';

type IndependentRiderRow = {
  uid: string;
  first_name: string | null;
  last_name: string | null;
  phone?: string | null;
  email?: string | null;
  id_number?: string | null;
  birth_date?: string | null;
  status?: RiderStatus | null;
  notes?: string | null;

  horses_count?: number;
  active_services_count?: number;
};

type RiderColumnKey =
  | 'full_name'
  | 'phone'
  | 'email'
  | 'id_number'
  | 'horses_count'
  | 'active_services_count'
  | 'status';

type RiderColumnDef = {
  key: RiderColumnKey;
  label: string;
  visible: boolean;
};

@Component({
  selector: 'app-secretary-independent-riders',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatSidenavModule,
    RouterModule,
  ],
  templateUrl: './secretary-independent-riders.html',
  styleUrls: ['./secretary-independent-riders.css'],
})
export class SecretaryIndependentRidersComponent implements OnInit {
  @ViewChild('drawer') drawer!: MatSidenav;

  riders: IndependentRiderRow[] = [];

  isLoading = true;
  drawerLoading = false;
  error: string | null = null;

  searchText = '';
  searchMode: 'name' | 'id' | 'email' = 'name';
  statusFilter: 'all' | 'active' | 'inactive' = 'all';

  showSearchPanel = false;
  showColumnsPanel = false;
  panelFocus: 'search' | 'filter' = 'search';

  selectedUid: string | null = null;
  drawerRider: IndependentRiderRow | null = null;

  editMode = false;
  riderForm!: FormGroup;
  private originalRider: IndependentRiderRow | null = null;

  readonly STORAGE_KEY = 'secretary_independent_riders_table_prefs';

  columns: RiderColumnDef[] = [
    { key: 'full_name', label: 'שם מלא', visible: true },
    { key: 'phone', label: 'טלפון', visible: true },
    { key: 'email', label: 'אימייל', visible: true },
    { key: 'id_number', label: 'תעודת זהות', visible: false },
    { key: 'horses_count', label: 'סוסים', visible: true },
    { key: 'active_services_count', label: 'שירותים פעילים', visible: true },
    { key: 'status', label: 'סטטוס', visible: true },
  ];
  activeDrawerTab: 'details' | 'horses' | 'services' | 'billing' = 'details';

  drawerHorses: any[] = [];
  drawerServices: any[] = [];
  drawerChargeItems: any[] = [];
  stats = {
    total: 0,
    filtered: 0,
    active: 0,
    inactive: 0,
    withHorses: 0,
    withServices: 0,
  };

  constructor(
    private ui: UiDialogService,
    private fb: FormBuilder,
  ) { }

  async ngOnInit(): Promise<void> {
    this.loadTablePrefs();
    await this.loadRiders();
  }

  @HostListener('document:click')
  closePanelsOnOutsideClick(): void {
    this.showSearchPanel = false;
    this.showColumnsPanel = false;
  }

  get filteredRiders(): IndependentRiderRow[] {
    let rows = [...this.riders];
    const raw = this.searchText.trim();

    if (raw) {
      if (this.searchMode === 'name') {
        const q = raw.toLowerCase();
        rows = rows.filter(r => this.getRiderName(r).toLowerCase().includes(q));
      }

      if (this.searchMode === 'id') {
        const q = raw.replace(/\s/g, '');
        rows = rows.filter(r => (r.id_number || '').replace(/\s/g, '').startsWith(q));
      }

      if (this.searchMode === 'email') {
        const q = raw.toLowerCase();
        rows = rows.filter(r => (r.email || '').toLowerCase().includes(q));
      }
    }

    if (this.statusFilter !== 'all') {
      rows = rows.filter(r => (r.status || 'active') === this.statusFilter);
    }

    return rows;
  }

  get visibleColumns(): RiderColumnDef[] {
    return this.columns.filter(c => c.visible);
  }

  async loadRiders(): Promise<void> {
    this.isLoading = true;
    this.error = null;

    try {
      const db = dbTenant();

      const { data, error } = await db
        .from('independent_riders')
        .select('uid, first_name, last_name, phone, email, id_number, birth_date, status, notes')
        .order('first_name', { ascending: true })
        .order('last_name', { ascending: true });

      if (error) throw error;

      const riders = (data ?? []) as IndependentRiderRow[];

      const { data: horses } = await db
        .from('horses')
        .select('id, owner_rider_uid')
        .not('owner_rider_uid', 'is', null);

      const { data: services } = await db
        .from('rider_services')
        .select('id, rider_uid, status')
        .eq('status', 'active');

      const horseCountMap = new Map<string, number>();
      (horses ?? []).forEach((h: any) => {
        const uid = h.owner_rider_uid;
        if (!uid) return;
        horseCountMap.set(uid, (horseCountMap.get(uid) || 0) + 1);
      });

      const serviceCountMap = new Map<string, number>();
      (services ?? []).forEach((s: any) => {
        const uid = s.rider_uid;
        if (!uid) return;
        serviceCountMap.set(uid, (serviceCountMap.get(uid) || 0) + 1);
      });

      this.riders = riders.map(r => ({
        ...r,
        horses_count: horseCountMap.get(r.uid) || 0,
        active_services_count: serviceCountMap.get(r.uid) || 0,
      }));

      this.updateStats();
    } catch (e: any) {
      console.error(e);
      this.error = e?.message || 'שגיאה בטעינת רוכבים עצמאיים';
      this.riders = [];
    } finally {
      this.isLoading = false;
    }
  }

  private updateStats(): void {
    const all = this.riders;
    const filtered = this.filteredRiders;

    this.stats = {
      total: all.length,
      filtered: filtered.length,
      active: all.filter(r => (r.status || 'active') === 'active').length,
      inactive: all.filter(r => r.status === 'inactive').length,
      withHorses: all.filter(r => (r.horses_count || 0) > 0).length,
      withServices: all.filter(r => (r.active_services_count || 0) > 0).length,
    };
  }

  onFiltersChanged(): void {
    this.updateStats();
  }

  clearFilters(): void {
    this.searchText = '';
    this.searchMode = 'name';
    this.statusFilter = 'all';
    this.updateStats();
  }

  async openDetails(uid: string): Promise<void> {
    this.selectedUid = uid;
    this.drawerRider = null;
    this.editMode = false;
    this.originalRider = null;
    this.activeDrawerTab = 'details';
    this.drawerHorses = [];
    this.drawerServices = [];
    this.drawerChargeItems = [];

    this.drawer.open();
    await this.loadDrawerData(uid);
  }

  closeDetails(): void {
    this.drawer.close();
    this.selectedUid = null;
    this.drawerRider = null;
    this.editMode = false;
    this.originalRider = null;
  }

  private async loadDrawerData(uid: string): Promise<void> {
    this.drawerLoading = true;

    try {
      const { data, error } = await dbTenant()
        .from('independent_riders')
        .select('uid, first_name, last_name, phone, email, id_number, birth_date, status, notes')
        .order('first_name', { ascending: true })
        .order('last_name', { ascending: true })
        .eq('uid', uid)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        await this.ui.alert('לא נמצא רוכב עצמאי.', 'שגיאה');
        return;
      }

      this.drawerRider = data as IndependentRiderRow;
      this.originalRider = structuredClone(this.drawerRider);
      this.buildForm(this.drawerRider);
      await Promise.all([
        this.loadDrawerHorses(uid),
        this.loadDrawerServices(uid),
        this.loadDrawerChargeItems(uid),
      ]);
    } catch (e) {
      console.error(e);
      this.drawerRider = null;
    } finally {
      this.drawerLoading = false;
    }
  }

  private buildForm(rider: IndependentRiderRow): void {
    this.riderForm = this.fb.group({
      first_name: [rider.first_name ?? '', [Validators.required, Validators.maxLength(40)]],
      last_name: [rider.last_name ?? '', [Validators.required, Validators.maxLength(40)]],
      phone: [rider.phone ?? '', [Validators.maxLength(20)]],
      email: [rider.email ?? '', [Validators.email, Validators.maxLength(80)]],
      id_number: [rider.id_number ?? '', [Validators.maxLength(20)]],
      birth_date: [rider.birth_date ?? null],
      status: [rider.status ?? 'active'],
      notes: [rider.notes ?? '', [Validators.maxLength(300)]],
    });
  }

  enterEditMode(): void {
    if (!this.drawerRider) return;
    this.editMode = true;
    this.buildForm(this.drawerRider);
  }

  cancelEdit(): void {
    this.editMode = false;
    if (this.originalRider) {
      this.drawerRider = structuredClone(this.originalRider);
      this.buildForm(this.originalRider);
    }
  }

  async saveRiderEdits(): Promise<void> {
    if (!this.selectedUid || !this.drawerRider || this.riderForm.invalid) {
      this.riderForm?.markAllAsTouched();
      return;
    }

    const v = this.riderForm.getRawValue();


    const payload = {
      first_name: String(v.first_name ?? '').trim(),
      last_name: String(v.last_name ?? '').trim(),
      phone: String(v.phone ?? '').trim() || null,
      email: String(v.email ?? '').trim().toLowerCase() || null,
      id_number: String(v.id_number ?? '').trim() || null,
      birth_date: v.birth_date || null,
      status: v.status,
      notes: String(v.notes ?? '').trim() || null,
      updated_at: new Date().toISOString(),
    };

    try {
      const { data, error } = await dbTenant()
        .from('independent_riders')
        .update(payload)
        .eq('uid', this.selectedUid)
        .select('uid, first_name, last_name, phone, email, id_number, birth_date, status, notes').maybeSingle();

      if (error) throw error;

      this.drawerRider = data as IndependentRiderRow;
      this.originalRider = structuredClone(this.drawerRider);

      this.riders = this.riders.map(r =>
        r.uid === this.selectedUid
          ? { ...r, ...this.drawerRider }
          : r
      );

      this.editMode = false;
      this.updateStats();
    } catch (e: any) {
      console.error(e);
      await this.ui.alert(e?.message || 'שמירת רוכב נכשלה', 'שגיאה');
    }
  }

  async openAddRiderDialog(): Promise<void> {
    await this.ui.alert('בשלב הבא נוסיף חלון הוספת רוכב עצמאי.', 'בקרוב');
  }

  toggleSearchPanelFromBar(): void {
    this.panelFocus = 'search';
    this.showColumnsPanel = false;
    this.showSearchPanel = !this.showSearchPanel;
  }

  toggleFromSearchIcon(event: MouseEvent): void {
    event.stopPropagation();
    this.panelFocus = 'search';
    this.showColumnsPanel = false;
    this.showSearchPanel = !this.showSearchPanel;
  }

  toggleFromFilterIcon(event: MouseEvent): void {
    event.stopPropagation();
    this.panelFocus = 'filter';
    this.showColumnsPanel = false;
    this.showSearchPanel = !this.showSearchPanel;
  }

  toggleColumnsPanel(event?: MouseEvent): void {
    event?.stopPropagation();
    this.showSearchPanel = false;
    this.showColumnsPanel = !this.showColumnsPanel;
  }

  toggleColumn(key: RiderColumnKey): void {
    this.columns = this.columns.map(c =>
      c.key === key ? { ...c, visible: !c.visible } : c
    );
    this.saveTablePrefs();
  }

  saveTablePrefs(): void {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify({ columns: this.columns }));
  }

  private loadTablePrefs(): void {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.columns)) {
        this.columns = parsed.columns;
      }
    } catch {
      // ignore
    }
  }
  setDrawerTab(tab: 'details' | 'horses' | 'services' | 'billing'): void {
    this.activeDrawerTab = tab;
  }

  private async loadDrawerHorses(uid: string): Promise<void> {
    const { data, error } = await dbTenant()
      .from('horses')
      .select('id, name, age, color, gender, horse_size, is_active, notes')
      .eq('owner_rider_uid', uid)
      .order('name', { ascending: true });

    if (error) {
      console.error('loadDrawerHorses error', error);
      this.drawerHorses = [];
      return;
    }

    this.drawerHorses = data ?? [];
  }

  private async loadDrawerServices(uid: string): Promise<void> {
    const { data, error } = await dbTenant()
      .from('rider_services')
      .select(`
      id,
      service_name,
      start_date,
      end_date,
      status,
      price_agorot,
      notes,
      service_mode,
      recurrence_unit,
      recurrence_interval,
      next_billing_date,
      last_billed_date
    `)
      .eq('rider_uid', uid)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('loadDrawerServices error', error);
      this.drawerServices = [];
      return;
    }

    this.drawerServices = data ?? [];
  }
  get isChangingRiderToInactive(): boolean {
    if (!this.editMode || !this.originalRider || !this.riderForm) return false;

    return (this.originalRider.status || 'active') === 'active'
      && this.riderForm.get('status')?.value === 'inactive';
  }

  get activeDrawerServicesCount(): number {
    return this.drawerServices.filter(s => s.status === 'active').length;
  }
  private async loadDrawerChargeItems(uid: string): Promise<void> {
    const { data, error } = await dbTenant()
      .from('rider_charge_items')
      .select('id, description, service_date, period_start, period_end, quantity, unit_price_agorot, amount_agorot, billing_source, created_at')
      .eq('rider_uid', uid)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('loadDrawerChargeItems error', error);
      this.drawerChargeItems = [];
      return;
    }

    this.drawerChargeItems = data ?? [];
  }

  formatAgorot(value: number | null | undefined): string {
    return `${Number(value || 0) / 100} ₪`;
  }
  getRiderName(rider: IndependentRiderRow | null | undefined): string {
    if (!rider) return '—';

    const name = `${rider.first_name || ''} ${rider.last_name || ''}`.trim();
    return name || '—';
  }
}