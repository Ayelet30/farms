import { Component, OnInit, ViewChild, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatSidenav, MatSidenavModule } from '@angular/material/sidenav';
import { RouterModule } from '@angular/router';
import { UiDialogService } from '../../services/ui-dialog.service';
import { ActivatedRoute, Router } from '@angular/router';
import { dbTenant, getCurrentFarmMetaSync } from '../../services/legacy-compat';
import { TranzilaService } from '../../services/tranzila.service';
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
declare const TzlaHostedFields: any;

type HostedFieldsInstance = {
  charge: (params: any, cb: (err: any, resp: any) => void) => void;
};

type RiderPaymentProfileRow = {
  id: string;
  rider_uid: string;
  brand?: string | null;
  last4?: string | null;
  expiry_month?: number | null;
  expiry_year?: number | null;
  active: boolean;
  is_default: boolean;
  created_at?: string;
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
  hfLoading = false;
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
  activeDrawerTab: 'details' | 'horses' | 'services' | 'billing' | 'payments' = 'details';
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
  drawerPaymentProfiles: RiderPaymentProfileRow[] = [];

  addCardOpen = false;
  savingToken = false;
  tokenSaved = false;
  tokenError: string | null = null;

  private hfAdd: HostedFieldsInstance | null = null;
  private thtkAdd: string | null = null;
  private hfInitTried = false;
  private addCardLockedRiderUid: string | null = null;
  constructor(
    private ui: UiDialogService,
    private fb: FormBuilder,
    private route: ActivatedRoute,
    private router: Router,
    private tranzila: TranzilaService,
  ) { }
  async ngOnInit(): Promise<void> {
    this.loadTablePrefs();
    await this.loadRiders();

    const riderUid = this.route.snapshot.queryParamMap.get('riderUid');

    if (riderUid) {
      await this.openDetails(riderUid);

      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {},
        replaceUrl: true,
      });
    }
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
        this.loadDrawerPaymentProfiles(uid),
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
  setDrawerTab(tab: 'details' | 'horses' | 'services' | 'billing' | 'payments'): void {
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
    const db = dbTenant();

    const { data: services, error: servicesError } = await db
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
      recurrence_interval
    `)
      .eq('rider_uid', uid)
      .eq('status', 'active')
      .order('created_at', { ascending: false });

    if (servicesError) {
      console.error('loadDrawerServices error', servicesError);
      this.drawerServices = [];
      return;
    }

    const serviceIds = (services ?? []).map((s: any) => s.id);

    if (serviceIds.length === 0) {
      this.drawerServices = [];
      return;
    }

    const { data: tasks, error: tasksError } = await db
      .from('rider_service_tasks')
      .select('id, rider_service_id, due_date, status')
      .in('rider_service_id', serviceIds)
      .eq('status', 'open')
      .order('due_date', { ascending: true });

    if (tasksError) {
      console.error('loadDrawerServices tasks error', tasksError);
    }

    const nextTaskByServiceId = new Map<string, any>();

    (tasks ?? []).forEach((task: any) => {
      if (!nextTaskByServiceId.has(task.rider_service_id)) {
        nextTaskByServiceId.set(task.rider_service_id, task);
      }
    });

    this.drawerServices = (services ?? []).map((service: any) => ({
      ...service,
      next_open_task: nextTaskByServiceId.get(service.id) ?? null,
    }));
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
      .select(`
      id,
      charge_id,
      rider_uid,
      rider_service_id,
      rider_service_task_id,
      horse_uid,
      service_type_id,
      item_date,
      service_name,
      quantity,
      unit_price_agorot,
      amount_agorot,
      description,
      office_note,
      metadata,
      item_type,
      item_code,
      created_at
    `)
      .eq('rider_uid', uid)
      .order('item_date', { ascending: false });

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
  openHorse(horseId: string): void {
    this.router.navigate(
      ['/secretary/horses'],
      {
        queryParams: {
          horseId
        }
      }
    );
  }
  openHorseFromRider(horseId: string): void {
    const riderUid = this.drawerRider?.uid || this.selectedUid;


    if (!horseId || !riderUid) return;

    this.router.navigate(['/secretary/horses'], {
      queryParams: {
        horseId,
        returnRiderUid: riderUid,
      },
    });
  }
  private async loadDrawerPaymentProfiles(uid: string): Promise<void> {
    const { data, error } = await dbTenant()
      .from('independent_rider_payment_profiles')
      .select('id, rider_uid, brand, last4, expiry_month, expiry_year, active, is_default, created_at')
      .eq('rider_uid', uid)
      .eq('active', true)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      console.error('loadDrawerPaymentProfiles error', error);
      this.drawerPaymentProfiles = [];
      return;
    }

    this.drawerPaymentProfiles = data ?? [];
  }

  formatExpiry(month?: number | null, year?: number | null): string {
    if (!month || !year) return '—';
    return `${String(month).padStart(2, '0')}/${String(year).slice(-2)}`;
  }



  async setDefaultRiderPaymentProfile(profileId: string): Promise<void> {
    if (!this.selectedUid) return;

    const profile = this.drawerPaymentProfiles.find(p => p.id === profileId);

    if (profile && this.isExpiredPayment(profile)) {
      await this.ui.alert('לא ניתן להגדיר כרטיס שפג תוקפו כברירת מחדל.', 'שגיאה');
      return;
    }
    try {
      const db = dbTenant();

      const clear = await db
        .from('independent_rider_payment_profiles')
        .update({ is_default: false })
        .eq('rider_uid', this.selectedUid);

      if (clear.error) throw clear.error;

      const upd = await db
        .from('independent_rider_payment_profiles')
        .update({ is_default: true })
        .eq('id', profileId)
        .eq('rider_uid', this.selectedUid);

      if (upd.error) throw upd.error;

      await this.loadDrawerPaymentProfiles(this.selectedUid);
    } catch (e: any) {
      await this.ui.alert(e?.message ?? 'לא ניתן היה לשנות כרטיס ברירת מחדל', 'שגיאה');
    }
  }

  async removeRiderPaymentProfile(profileId: string): Promise<void> {
    if (!this.selectedUid) return;
    const ok = await this.ui.confirm({
      title: 'הסרת אמצעי תשלום',
      message: 'להסיר את אמצעי התשלום מהרוכב?',
      cancelText: 'ביטול',
      showCancel: true,
    });

    if (!ok) return;

    try {
      const { error } = await dbTenant()
        .from('independent_rider_payment_profiles')
        .update({ active: false, is_default: false })
        .eq('id', profileId)
        .eq('rider_uid', this.selectedUid);

      if (error) throw error;

      await this.loadDrawerPaymentProfiles(this.selectedUid);
    } catch (e: any) {
      await this.ui.alert(e?.message ?? 'לא ניתן להסיר אמצעי תשלום', 'שגיאה');
    }
  }
  openAddCardModal(event?: MouseEvent): void {
    event?.stopPropagation();

    if (!this.selectedUid) {
      this.tokenError = 'לא נבחר רוכב';
      return;
    }

    this.addCardLockedRiderUid = this.selectedUid;
    this.addCardOpen = true;
    this.savingToken = false;
    this.tokenSaved = false;
    this.tokenError = null;

    this.hfAdd = null;
    this.thtkAdd = null;
    this.hfInitTried = false;
    this.hfLoading = true;

    setTimeout(() => this.ensureAddHostedFieldsReady(), 0);
  }

  closeAddCardModal(): void {

    if (this.savingToken) return;
    this.clearHostedFieldsDom();
    this.hfLoading = false;
    this.addCardOpen = false;
    this.hfAdd = null;
    this.thtkAdd = null;
    this.hfInitTried = false;
    this.addCardLockedRiderUid = null;
  }
  private clearHostedFieldsDom(): void {
    [
      'sec_ir_pm_credit_card_number',
      'sec_ir_pm_expiry',
      'sec_ir_pm_cvv',
      'sec_ir_pm_errors_for_credit_card_number',
      'sec_ir_pm_errors_for_expiry',
      'sec_ir_pm_errors_for_cvv'
    ].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.innerHTML = '';
        el.textContent = '';
      }
    });
  }
  private async ensureAddHostedFieldsReady(): Promise<void> {
    if (this.hfAdd || this.hfInitTried) return;
    this.hfInitTried = true;
    this.hfLoading = true;

    try {
      const farm = getCurrentFarmMetaSync();
      const tenantSchema = farm?.schema_name ?? null;

      if (!tenantSchema) {
        this.tokenError = 'לא זוהתה סכמת חווה';
        this.hfLoading = false;
        return;
      }

      const { thtk } = await this.tranzila.getHandshakeToken(tenantSchema);
      this.thtkAdd = thtk;

      this.hfAdd = TzlaHostedFields.create({
        sandbox: false,
        fields: {
          credit_card_number: {
            selector: '#sec_ir_pm_credit_card_number',
            placeholder: '4580 4580 4580 4580',
            tabindex: 1,
          },
          expiry: {
            selector: '#sec_ir_pm_expiry',
            placeholder: '12/26',
            version: '1',
            tabindex: 2,
          },
          cvv: {
            selector: '#sec_ir_pm_cvv',
            placeholder: '123',
            tabindex: 3,
          },
        },
        styles: {
          input: {
            height: '42px',
            'line-height': '42px',
            padding: '0 10px',
            'font-size': '15px',
            'box-sizing': 'border-box',
          },
          select: {
            height: '42px',
            'line-height': '42px',
            padding: '0 10px',
            'font-size': '15px',
            'box-sizing': 'border-box',
          },
        },
      });

      setTimeout(() => {
        this.hfLoading = false;
      }, 500);

    } catch (e: any) {
      this.hfLoading = false;
      this.tokenError = e?.message ?? 'שגיאה באתחול שדות האשראי';
    }
  }

  async tokenizeAndSaveCardForSelectedRider(): Promise<void> {
    if (this.savingToken) return;

    this.tokenError = null;
    this.tokenSaved = false;

    const riderUid = this.addCardLockedRiderUid;

    if (!riderUid || !this.hfAdd || !this.thtkAdd) {
      this.tokenError = 'שדות התשלום לא מוכנים';
      return;
    }

    this.savingToken = true;

    try {
      const farm = getCurrentFarmMetaSync();
      const tenantSchema = farm?.schema_name ?? null;

      if (!tenantSchema) {
        this.tokenError = 'לא זוהתה סכמת חווה';
        this.savingToken = false;
        return;
      }

      const { data } = await dbTenant()
        .from('billing_terminals')
        .select('terminal_name')
        .eq('provider', 'tranzila')
        .eq('mode', 'prod')
        .eq('active', true)
        .order('is_default', { ascending: false })
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const terminalName = data?.terminal_name ?? 'moachapp';
      const riderEmail = this.drawerRider?.email ?? undefined;

      this.hfAdd.charge(
        {
          terminal_name: terminalName,
          thtk: this.thtkAdd,
          currency_code: 'ILS',
          amount: '1.00',
          tran_mode: 'N',
          tokenize: true,
          response_language: 'hebrew',
          requested_by_user: 'secretary-independent-rider-tokenize',
          email: riderEmail,
          contact: riderEmail,
        },
        async (err: any, response: any) => {
          try {
            if (err?.messages?.length) {
              err.messages.forEach((msg: any) => {
                const el = document.getElementById('sec_ir_pm_errors_for_' + msg.param); if (el) el.textContent = msg.message;
              });

              this.tokenError = 'שגיאה בפרטי הכרטיס';
              return;
            }

            const tx = response?.transaction_response;

            if (!tx?.success) {
              this.tokenError = tx?.error || 'שמירת אמצעי תשלום נכשלה';
              return;
            }

            const token = tx?.token;

            if (!token) {
              this.tokenError = 'לא התקבל טוקן מהסליקה';
              return;
            }

            const last4 =
              tx?.credit_card_last_4_digits ??
              tx?.last_4 ??
              (tx?.card_mask ? String(tx.card_mask).slice(-4) : null);

            const brand = tx?.card_type_name ?? tx?.card_type ?? null;

            await this.tranzila.savePaymentMethod({
              userType: 'independent_rider',
              riderUid,
              parentUid: null,
              tenantSchema,
              token: String(token),
              last4: last4 ? String(last4) : null,
              brand: brand ? String(brand) : null,
              expiryMonth: tx?.expiry_month ?? null,
              expiryYear: tx?.expiry_year ?? null,
            });

            await this.loadDrawerPaymentProfiles(riderUid);

            this.addCardOpen = false;
            this.hfAdd = null;
            this.thtkAdd = null;
            this.hfInitTried = false;
            this.hfLoading = false;
            this.addCardLockedRiderUid = null;
            this.tokenSaved = false;
            this.tokenError = null;

            await this.ui.alert('אמצעי התשלום נשמר בהצלחה.', 'הצלחה');
          } catch (e: any) {
            if (e?.status === 409) {
              if (e?.error?.error === 'CARD_EXISTS_FOR_ANOTHER_USER') {
                this.tokenError = 'האשראי קיים אצל משתמש אחר ולא ניתן לשמור אותו';
                return;
              }

              if (e?.error?.error === 'CARD_ALREADY_EXISTS') {
                this.tokenError = 'לא ניתן לשמור אותו כרטיס אשראי פעמיים';
                return;
              }
            }

            this.tokenError =
              e?.error?.message ||
              e?.error?.error ||
              e?.message ||
              'שגיאה בשמירת אמצעי תשלום במערכת';
          } finally {
            this.savingToken = false;
          }
        },
      );
    } catch (e: any) {
      this.tokenError = e?.message ?? 'שגיאה בשמירת אמצעי תשלום';
      this.savingToken = false;
    }
  }
  async tokenizeAndSaveCard(): Promise<void> {
    await this.tokenizeAndSaveCardForSelectedRider();
  }
  isExpiredPayment(profile: { expiry_month?: number | null; expiry_year?: number | null }): boolean {
    if (!profile.expiry_month || !profile.expiry_year) return false;

    const now = new Date();

    const endOfExpiryMonth = new Date(
      Number(profile.expiry_year),
      Number(profile.expiry_month),
      0,
      23,
      59,
      59
    );

    return endOfExpiryMonth < now;
  }

  isExpiringSoon(profile: { expiry_month?: number | null; expiry_year?: number | null }): boolean {
    if (!profile.expiry_month || !profile.expiry_year) return false;

    if (this.isExpiredPayment(profile)) return false;

    const now = new Date();

    const endOfExpiryMonth = new Date(
      Number(profile.expiry_year),
      Number(profile.expiry_month),
      0,
      23,
      59,
      59
    );

    const diffDays =
      (endOfExpiryMonth.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);

    return diffDays <= 60;
  }

}