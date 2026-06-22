import { Component, OnInit, ViewChild, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatSidenav, MatSidenavModule } from '@angular/material/sidenav';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators, AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { TranzilaService } from '../../services/tranzila.service';

import { UiDialogService } from '../../services/ui-dialog.service';
import {
  ensureTenantContextReady,
  dbPublic,
  dbTenant,
  getCurrentFarmMetaSync,
} from '../../services/legacy-compat';

import {
  AddParentDialogComponent,
  AddParentPayload,
} from './add-parent-dialog/add-parent-dialog.component';
import { PaymentsService } from '../../services/payments.service';
import { CreateUserService } from '../../services/create-user.service';
import { MailService } from '../../services/mail.service';


declare const TzlaHostedFields: any;

type HostedFieldsInstance = {
  charge: (params: any, cb: (err: any, resp: any) => void) => void;
  onEvent?: (eventName: string, cb: (...args: any[]) => void) => void;
};

type ParentRow = {
  uid: string;
  first_name: string;
  last_name: string;
  id_number?: string | null;
  billing_day_of_month?: number | null;
  phone?: string | null;
  email?: string | null;
  is_active?: boolean | null;
  hasActiveChildren?: boolean;
  hasInactiveChildren?: boolean;
  paymentProfilesCount?: number;
  hasPaymentMethod?: boolean;
  hasExpiringPaymentMethod?: boolean;
  defaultPaymentLast4?: string | null;
  defaultPaymentExpiry?: string | null;
  scheduled_inactive_at?: string | null;
};
type PaymentProfileRow = {
  id: string;
  parent_uid: string;
  brand?: string | null;
  last4?: string | null;
  expiry_month?: number | null;
  expiry_year?: number | null;
  active: boolean;
  is_default: boolean;
  created_at?: string;
};
interface ParentDetailsRow extends ParentRow {
  address?: string | null;
  extra_notes?: string | null;
  message_preferences?: string[] | null;
}

type ParentColumnKey =
  | 'first_name'
  | 'last_name'
  | 'phone'
  | 'email'
  | 'id_number'
  | 'billing_day_of_month'
  | 'status'
  | 'children_status'
  | 'payment_status';

type ParentColumnDef = {
  key: ParentColumnKey;
  label: string;
  visible: boolean;
};


@Component({
  selector: 'app-secretary-parents',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatSidenavModule,
    MatDialogModule,
    RouterModule,
  ],
  templateUrl: './secretary-parents.html',
  styleUrls: ['./secretary-parents.css'],
})
export class SecretaryParentsComponent implements OnInit {
  @ViewChild('drawer') drawer!: MatSidenav;

  parents: ParentRow[] = [];

  searchText = '';
  searchMode: 'name' | 'id' | 'email' = 'name';
  childrenFilter: 'all' | 'active' | 'inactive' | 'withoutChildren' = 'all';
  statusFilter: 'all' | 'active' | 'inactive' = 'all';
  paymentFilter: 'all' | 'withPayment' | 'withoutPayment' = 'all';

  showSearchPanel = false;
  showColumnsPanel = false;
  panelFocus: 'search' | 'filter' = 'search';

  isLoading = true;
  error: string | null = null;

  selectedUid: string | null = null;
  drawerLoading = false;
  drawerParent: ParentDetailsRow | null = null;
  drawerChildren: Array<{
    child_uuid: string;
    first_name: string;
    last_name: string;
    gender?: string | null;
    status?: string | null;
    birth_date?: string | null;
    gov_id?: string | null;
  }> = [];

  parentForm!: FormGroup;
  editMode = false;

  private saveRequestId: string | null = null;
  private tokenCallbackHandled = false;
private addCardLockedParentUid: string | null = null;
drawerLoadRequestId: string | null = null;

addCardOpen = false;
savingToken = false;
tokenSaved = false;
tokenError: string | null = null;

private hfAdd: HostedFieldsInstance | null = null;
private thtkAdd: string | null = null;
private hfInitTried = false;

  private originalParent: ParentDetailsRow | null = null;

  readonly STORAGE_KEY = 'secretary_parents_table_prefs';
  drawerPaymentProfiles: PaymentProfileRow[] = [];
  columns: ParentColumnDef[] = [
    { key: 'first_name', label: 'שם פרטי', visible: true },
    { key: 'last_name', label: 'שם משפחה', visible: true },
    { key: 'phone', label: 'טלפון', visible: true },
    { key: 'email', label: 'אימייל', visible: true },
    { key: 'id_number', label: 'תעודת זהות', visible: false },
    { key: 'billing_day_of_month', label: 'יום חיוב', visible: false },
    { key: 'status', label: 'סטטוס הורה', visible: true },
    { key: 'children_status', label: 'סטטוס ילדים', visible: true },
    { key: 'payment_status', label: 'אמצעי תשלום', visible: true },
  ];

  stats = {
    total: 0,
    filtered: 0,
    activeParents: 0,
    inactiveParents: 0,
    withActiveChildren: 0,
    withInactiveChildren: 0,
  };

  readonly MAX_FIRST_NAME = 25;
  readonly MAX_LAST_NAME = 35;
  readonly MAX_EMAIL = 60;
  readonly MAX_ADDRESS = 30;
  readonly MAX_EXTRA_NOTES = 60;
  readonly MAX_PHONE = 11;
  

  readonly COMM_PREF_OPTIONS = [
    { value: 'inapp', label: 'אפליקציה (In-app)' },
    { value: 'voice', label: 'הודעה קולית' },
    { value: 'whatsapp', label: 'וואטסאפ' },
    { value: 'email', label: 'אימייל' },
    { value: 'sms', label: 'SMS' },
  ];

  constructor(
    private ui: UiDialogService,
    private dialog: MatDialog,
    private createUserService: CreateUserService,
    private fb: FormBuilder,
    private mailService: MailService,
    private pagos: PaymentsService,
    private tranzila: TranzilaService,
    private route: ActivatedRoute,
    private router: Router,
  ) {}

  async ngOnInit() {
    try {
      this.loadTablePrefs();
      await ensureTenantContextReady();
      await this.loadParents();
      const parentUid = this.route.snapshot.queryParamMap.get('parentUid');

      if (parentUid) {
        setTimeout(() => this.openDetails(parentUid), 0);
      }
      this.updateStats();
      const openDrawer = this.route.snapshot.queryParamMap.get('openDrawer') === 'true';

      if (parentUid) {
        const found = this.parents.find(p => p.uid === parentUid);

        if (found) {
          this.searchMode = 'name';
          this.searchText = `${found.first_name || ''} ${found.last_name || ''}`.trim();
        }

        if (openDrawer) {
          setTimeout(() => this.openDetails(parentUid), 0);
        }
      }
    } catch (e: any) {
      this.error = e?.message || 'Failed to load parents';
      console.error(e);
    } finally {
      this.isLoading = false;
    }
  }

  @HostListener('document:click')
  closePanelsOnOutsideClick() {
    this.showSearchPanel = false;
    this.showColumnsPanel = false;
  }

  get filteredParents(): ParentRow[] {
    let rows = [...this.parents];
    const raw = (this.searchText || '').trim();

    if (raw) {
      if (this.searchMode === 'name') {
        const q = raw.toLowerCase();

        rows = rows.filter((p) => {
          const hay = `${p.first_name || ''} ${p.last_name || ''}`.toLowerCase();
          return hay.includes(q);
        });
      }

      if (this.searchMode === 'id') {
        const qId = raw.replace(/\s/g, '');

        rows = rows.filter((p) => {
          const id = (p.id_number || '').toString().replace(/\s/g, '');
          return qId !== '' && id.startsWith(qId);
        });
      }

      if (this.searchMode === 'email') {
        const qEmail = raw.toLowerCase();

        rows = rows.filter((p) => {
          const email = (p.email || '').toLowerCase();
          return email.includes(qEmail);
        });
      }
    }

    if (this.statusFilter !== 'all') {
      rows = rows.filter((p) => {
        const active = p.is_active !== false;
        return this.statusFilter === 'active' ? active : !active;
      });
    }

    if (this.childrenFilter === 'active') {
      rows = rows.filter((p) => !!p.hasActiveChildren);
    } else if (this.childrenFilter === 'inactive') {
      rows = rows.filter((p) => !!p.hasInactiveChildren);
    } else if (this.childrenFilter === 'withoutChildren') {
      rows = rows.filter((p) => !p.hasActiveChildren && !p.hasInactiveChildren);
    }
    if (this.paymentFilter === 'withPayment') {
      rows = rows.filter((p) => !!p.hasPaymentMethod);
    } else if (this.paymentFilter === 'withoutPayment') {
      rows = rows.filter((p) => !p.hasPaymentMethod);
    }

    return rows;
  }

  get visibleColumns(): ParentColumnDef[] {
    return this.columns.filter((c) => c.visible);
  }
  // async setDefaultPaymentProfile(profileId: string) {
  //   if (!this.selectedUid) return;

  //   try {
  //     await this.pagos.setDefault(profileId, this.selectedUid);

  //     await this.loadDrawerData(this.selectedUid);
  //     await this.loadParents();
  //   } catch (e: any) {
  //     await this.ui.alert(e?.message ?? 'לא ניתן היה לשנות כרטיס ברירת מחדל', 'שגיאה');
  //   }
  // }
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

  toggleSearchPanel(event?: MouseEvent) {
    if (event) event.stopPropagation();
    this.showColumnsPanel = false;
    this.showSearchPanel = !this.showSearchPanel;
  }

  toggleColumnsPanel(event?: MouseEvent) {
    if (event) event.stopPropagation();
    this.showSearchPanel = false;
    this.showColumnsPanel = !this.showColumnsPanel;
  }

  onFiltersChanged(): void {
    this.updateStats();
  }

  clearFilters() {
    this.searchText = '';
    this.searchMode = 'name';
    this.statusFilter = 'all';
    this.childrenFilter = 'all';
    this.paymentFilter = 'all';
    this.updateStats();
  }

  toggleColumn(key: ParentColumnKey): void {
    this.columns = this.columns.map((c) =>
      c.key === key ? { ...c, visible: !c.visible } : c
    );
    this.saveTablePrefs();
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
    const data = { columns: this.columns };
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
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
    const all = this.parents ?? [];
    const filtered = this.filteredParents ?? [];

    this.stats = {
      total: all.length,
      filtered: filtered.length,
      activeParents: all.filter((p) => p.is_active !== false).length,
      inactiveParents: all.filter((p) => p.is_active === false).length,
      withActiveChildren: all.filter((p) => !!p.hasActiveChildren).length,
      withInactiveChildren: all.filter((p) => !!p.hasInactiveChildren).length,
    };
  }

  private async loadParents() {
    this.isLoading = true;
    this.error = null;

    try {
      const dbc = dbTenant();

      const { data: parentsData, error: parentsErr } = await dbc
        .from('parents')
        .select('uid, first_name, last_name, id_number, phone, email, is_active, billing_day_of_month, scheduled_inactive_at').order('first_name', { ascending: true });

      if (parentsErr) throw parentsErr;

      const parents = (parentsData ?? []) as ParentRow[];

      const { data: kidsData, error: kidsErr } = await dbc
        .from('children')
        .select('parent_uid, status');

      if (kidsErr) {
        console.error('children fetch error', kidsErr);
      }
      const { data: profilesData, error: profilesErr } = await dbc
        .from('payment_profiles')
        .select('id, parent_uid, brand, last4, expiry_month, expiry_year, active, is_default, created_at')
        .eq('active', true);

      if (profilesErr) throw profilesErr;

      const profilesMap = new Map<string, PaymentProfileRow[]>();

      (profilesData ?? []).forEach((p: any) => {
        const arr = profilesMap.get(p.parent_uid) || [];
        arr.push(p);
        profilesMap.set(p.parent_uid, arr);
      });
      const map = new Map<string, { hasActive: boolean; hasInactive: boolean }>();

      (kidsData ?? []).forEach((kid: any) => {
        if (!kid.parent_uid) return;

        const entry = map.get(kid.parent_uid) || {
          hasActive: false,
          hasInactive: false,
        };

        const status = (kid.status || '').toString().toLowerCase();

        if (status === 'active' || status === 'פעיל') entry.hasActive = true;
        if (status === 'inactive' || status === 'לא פעיל') entry.hasInactive = true;

        map.set(kid.parent_uid, entry);
      });

      this.parents = parents.map((p) => {
        const stats = map.get(p.uid) || { hasActive: false, hasInactive: false };
        const profiles = profilesMap.get(p.uid) || [];
        const defaultProfile = profiles.find(x => x.is_default) || profiles[0];
        return {
          ...p,
          hasActiveChildren: stats.hasActive,
          hasInactiveChildren: stats.hasInactive,
          paymentProfilesCount: profiles.length,
          hasPaymentMethod: profiles.length > 0,
          hasExpiringPaymentMethod: profiles.some(x => this.isExpiringSoon(x)),
          defaultPaymentLast4: defaultProfile?.last4 ?? null,
          defaultPaymentExpiry: defaultProfile
            ? this.formatExpiry(defaultProfile.expiry_month, defaultProfile.expiry_year)
            : null,
        };
      });

      this.updateStats();
    } catch (e: any) {
      this.error = e?.message || 'Failed to fetch parents.';
      console.error(e);
      this.parents = [];
    } finally {
      this.isLoading = false;
    }
  }


  private buildParentForm(parent: ParentDetailsRow) {
    this.parentForm = this.fb.group({
      first_name: [
        parent.first_name ?? '',
        [Validators.required, Validators.maxLength(this.MAX_FIRST_NAME)],
      ],
      last_name: [
        parent.last_name ?? '',
        [Validators.required, Validators.maxLength(this.MAX_LAST_NAME)],
      ],
      id_number: [{ value: parent.id_number ?? '', disabled: true }],
      phone: [
        parent.phone ?? '',
        [
          Validators.required,
          Validators.maxLength(this.MAX_PHONE),
          this.israelPhoneValidator(),
        ],
      ],
      email: [
        parent.email ?? '',
        [Validators.required, Validators.email, Validators.maxLength(this.MAX_EMAIL)],
      ],
      billing_day: [
        parent.billing_day_of_month ?? 10,
        [Validators.required, Validators.min(1), Validators.max(28)],
      ],
      is_active: [parent.is_active !== false],
      address: [parent.address ?? '', [Validators.maxLength(this.MAX_ADDRESS)]],
      extra_notes: [parent.extra_notes ?? '', [Validators.maxLength(this.MAX_EXTRA_NOTES)]],
      message_preferences: [
        parent.message_preferences && parent.message_preferences.length
          ? parent.message_preferences
          : ['inapp'],
        [Validators.required],
      ],
      inactive_date: [this.todayDate()],
    });
  }

  enterEditMode() {
    if (!this.drawerParent) return;
    this.editMode = true;
    this.buildParentForm(this.drawerParent);
  }

  cancelEdit() {
    this.editMode = false;
    if (this.originalParent) {
      this.drawerParent = structuredClone(this.originalParent);
      this.buildParentForm(this.originalParent);
    }
  }

  private normalizePhone(raw: any): string {
    return String(raw ?? '').replace(/[^\d+]/g, '');
  }

  private israelPhoneValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const raw = control.value;
      if (raw == null || raw === '') return null;

      const rawStr = String(raw);

      if (/[A-Za-z\u0590-\u05FF]/.test(rawStr)) {
        return { phoneDigitsOnly: true };
      }

      const val = this.normalizePhone(rawStr);

      if (!/^\+?\d+$/.test(val)) return { phoneDigitsOnly: true };

      if (val.startsWith('+972')) {
        const rest = val.slice(4);
        if (!/^5\d{8}$/.test(rest)) return { ilPhone: true };
        return null;
      }

      if (val.startsWith('972')) {
        const rest = val.slice(3);
        if (!/^5\d{8}$/.test(rest)) return { ilPhone: true };
        return null;
      }

      if (/^05\d{8}$/.test(val)) return null;

      return { ilPhone: true };
    };
  }

  private getFormInvalidMessages(): string[] {
    const msgs: string[] = [];

    const fn = this.parentForm.get('first_name');
    if (fn?.errors?.['required']) msgs.push('שם פרטי: שדה חובה');
    if (fn?.errors?.['maxlength']) msgs.push(`שם פרטי: עד ${this.MAX_FIRST_NAME} תווים`);

    const ln = this.parentForm.get('last_name');
    if (ln?.errors?.['required']) msgs.push('שם משפחה: שדה חובה');
    if (ln?.errors?.['maxlength']) msgs.push(`שם משפחה: עד ${this.MAX_LAST_NAME} תווים`);

    const email = this.parentForm.get('email');
    if (email?.errors?.['required']) msgs.push('אימייל: שדה חובה');
    if (email?.errors?.['email']) msgs.push('אימייל: פורמט לא תקין');
    if (email?.errors?.['maxlength']) msgs.push(`אימייל: עד ${this.MAX_EMAIL} תווים`);

    const addr = this.parentForm.get('address');
    if (addr?.errors?.['maxlength']) msgs.push(`כתובת: עד ${this.MAX_ADDRESS} תווים`);

    const notes = this.parentForm.get('extra_notes');
    if (notes?.errors?.['maxlength']) msgs.push(`הערות רפואיות/התנהגותיות: עד ${this.MAX_EXTRA_NOTES} תווים`);

    const phone = this.parentForm.get('phone');
    if (phone?.errors?.['required']) msgs.push('טלפון: שדה חובה');
    if (phone?.errors?.['phoneDigitsOnly']) msgs.push('טלפון: מותר להזין ספרות בלבד');
    if (phone?.errors?.['ilPhone']) msgs.push('טלפון: מספר ישראלי לא תקין (לדוגמה 05XXXXXXXX)');

    return msgs;
  }

  async saveParentEdits() {
    if (!this.drawerParent || !this.originalParent || !this.selectedUid) return;

    if (this.parentForm.invalid) {
      this.parentForm.markAllAsTouched();
      const msgs = this.getFormInvalidMessages();
      await this.ui.alert(
        msgs.length ? msgs.join('\n') : 'יש שדות לא תקינים. בדקי את הטופס.',
        'לא ניתן לשמור'
      );
      return;
    }

    const formValue = this.parentForm.getRawValue();

    const first_name = String(formValue.first_name ?? '').trim();
    const last_name = String(formValue.last_name ?? '').trim();
    const email = String(formValue.email ?? '').trim().toLowerCase();
    const address = String(formValue.address ?? '').trim();
    const extra_notes = String(formValue.extra_notes ?? '');

    const changes: any = {};

    if (first_name !== (this.originalParent.first_name ?? '')) changes.first_name = first_name;
    if (last_name !== (this.originalParent.last_name ?? '')) changes.last_name = last_name;
    if (formValue.phone !== this.originalParent.phone) changes.phone = formValue.phone;
    if (email !== (this.originalParent.email ?? '')) changes.email = email;
    if (address !== (this.originalParent.address ?? '')) changes.address = address || null;
    if (extra_notes !== (this.originalParent.extra_notes ?? '')) changes.extra_notes = extra_notes || null;

    if (
      JSON.stringify(formValue.message_preferences) !==
      JSON.stringify(this.originalParent.message_preferences)
    ) {
      changes.message_preferences = formValue.message_preferences;
    }

    const newBillingDay = Number(formValue.billing_day);
    const newIsActive = formValue.is_active === true;
    const oldIsActive = this.originalParent.is_active !== false;
    const becameInactive = oldIsActive === true && newIsActive === false;

    if (newIsActive !== oldIsActive && !becameInactive) {
      changes.is_active = newIsActive;
    }
    const oldBillingDay = this.originalParent.billing_day_of_month ?? 10;
    if (newBillingDay !== oldBillingDay) changes.billing_day_of_month = newBillingDay;

    if (Object.keys(changes).length === 0 && !becameInactive) {
      this.editMode = false;
      return;
    }
    try {
      const db = dbTenant();
      const cleanUid = (this.selectedUid || '').trim();

      let data: any = null;

      if (Object.keys(changes).length > 0) {
        const res = await db
          .from('parents')
          .update(changes)
          .eq('uid', cleanUid)
          .select(
            'uid, first_name, last_name, id_number, phone, email, address, extra_notes, message_preferences, billing_day_of_month, is_active, scheduled_inactive_at'
          )
          .maybeSingle();

        if (res.error) throw res.error;

        if (!res.data) {
          throw new Error('עדכון נכשל: לא נמצא הורה עם ה-uid הזה.');
        }

        data = res.data;
      }

      if (becameInactive) {
        const inactiveDate = formValue.inactive_date;

        if (!inactiveDate) {
          await this.ui.alert('חובה לבחור תאריך הפיכת הורה ללא פעיל', 'שגיאה');
          return;
        }

        const { error: rpcError } = await db.rpc('schedule_parent_inactivation', {
          p_parent_uid: cleanUid,
          p_inactive_date: inactiveDate,
        });

        if (rpcError) throw rpcError;

        await this.loadParents();
        await this.loadDrawerData(cleanUid);

        this.editMode = false;
        const isToday = inactiveDate === this.todayDate();

        await this.ui.alert(
          isToday
            ? 'ההורה הפך ללא פעיל. גם ילדיו הועברו לסטטוס לא פעיל והשיעורים העתידיים שלהם בוטלו.'
            : 'השינויים נשמרו ונקבע תאריך שבו ההורה יהפוך ללא פעיל. באותו תאריך גם ילדיו יהפכו ללא פעילים והשיעורים העתידיים שלהם יבוטלו.',
          'בוצע'
        ); return;
      }

      this.drawerParent = data as ParentDetailsRow;
      this.originalParent = structuredClone(this.drawerParent);

      this.parents = this.parents.map((p) =>
        p.uid === cleanUid
          ? {
            ...p,
            is_active: this.drawerParent!.is_active,
            first_name: this.drawerParent!.first_name,
            last_name: this.drawerParent!.last_name,
            phone: this.drawerParent!.phone,
            email: this.drawerParent!.email,
            id_number: this.drawerParent!.id_number,
            billing_day_of_month: this.drawerParent!.billing_day_of_month,
          }
          : p
      );

      this.updateStats();
      this.editMode = false;
    } catch (e: any) {
      console.error(e);
      await this.ui.alert(e?.message || 'שמירת השינויים נכשלה', 'שמירה נכשלה');
    }
  }

  openAddParentDialog() {
    const ref = this.dialog.open(AddParentDialogComponent, {
      width: '700px',
      maxWidth: '90vw',
      maxHeight: '90vh',
      panelClass: 'parent-dialog',
      disableClose: true,
    });

    ref.afterClosed().subscribe(async (payload?: AddParentPayload | any) => {
      if (!payload) return;

      await ensureTenantContextReady();

      const tenant_id = localStorage.getItem('selectedTenant') || '';
      const schema_name = localStorage.getItem('selectedSchema') || '';

      if (!tenant_id) {
        await this.ui.alert('לא נמצא tenant פעיל. התחברי מחדש או בחרי חווה פעילה.', 'שגיאה');
        return;
      }

      let uid = '';
      let tempPassword = '';

      try {
        const exists = await this.checkIfParentExists(payload.email, tenant_id);

        if (exists.existsInTenant) {
          await this.ui.alert('משתמש עם המייל הזה כבר קיים כהורה בחווה הנוכחית.', 'שגיאה');
          return;
        }

        if (exists.existsInSystem && exists.uid) {
          uid = exists.uid;
          tempPassword = '';
        } else {
          const res = await this.createUserService.createUserIfNotExists(payload.email);
          uid = res.uid;
          tempPassword = res.tempPassword;
        }
      } catch (e: any) {
        const msg =
          this.createUserService.errorMessage || e?.message || 'שגיאה ביצירת / בדיקת המשתמש.';
        await this.ui.alert(msg, 'שגיאה');
        return;
      }

      payload.uid = uid;
      payload.password = tempPassword || '';

      const message_preferences: string[] =
        Array.isArray(payload?.message_preferences) && payload.message_preferences.length
          ? payload.message_preferences
          : ['inapp'];

      const body = {
        uid: (payload.uid ?? '').trim(),
        first_name: (payload.first_name ?? '').trim(),
        last_name: (payload.last_name ?? '').trim(),
        email: (payload.email ?? '').trim().toLowerCase(),
        phone: (payload.phone ?? '').trim(),
        id_number: (payload.id_number ?? '').trim(),
        address: (payload.address ?? '').trim(),
        extra_notes: (payload.extra_notes ?? '').trim(),
        message_preferences,
        tenant_id,
        schema_name,
      };

      const missing = ['first_name', 'last_name', 'email', 'phone', 'id_number', 'address'].filter(
        (k) => !(body as any)[k]
      );

      if (missing.length) {
        await this.ui.alert('שדות חובה חסרים: ' + missing.join(', '), 'חסרים פרטים');
        return;
      }

      try {
        await this.createUserInSupabase(body.uid, body.email, 'parent', body.phone);

        await this.createTenantUserInSupabase({
          tenant_id: body.tenant_id,
          uid: body.uid,
        });

        await this.createParentInSupabase({
          uid: body.uid,
          first_name: body.first_name,
          last_name: body.last_name,
          email: body.email,
          phone: body.phone,
          id_number: body.id_number,
          address: body.address,
          extra_notes: body.extra_notes,
          message_preferences: body.message_preferences,
        });

        await this.loadParents();

        const fullName = `${body.first_name} ${body.last_name}`.trim();
        const tenantSchema = this.getTenantSchemaOrThrow();

        const isNewUser = !!payload.password;
        const subject = 'ברוכים הבאים לחווה';
        const html = isNewUser
          ? `
            <div dir="rtl">
              <p>שלום ${fullName},</p>
              <p>נרשמת בהצלחה לחווה.</p>
              <p><b>פרטי התחברות:</b></p>
              <p>אימייל: ${body.email}</p>
              <p>סיסמה זמנית: <b>${payload.password}</b></p>
              <p>מומלץ להחליף סיסמה לאחר התחברות.</p>
            </div>`
          : `
            <div dir="rtl">
              <p>שלום ${fullName},</p>
              <p>שויכת בהצלחה כהורה לחווה.</p>
              <p>אפשר להתחבר עם החשבון הקיים שלך.</p>
            </div>`;

        try {
          await this.mailService.sendEmailGmail({
            tenantSchema,
            to: [body.email],
            subject,
            html,
            text: `שלום ${fullName},\nנרשמת/שויכת לחווה.\n${payload.password ? `סיסמה זמנית: ${payload.password}\n` : ''}התחברות עם האימייל הזה: ${body.email}`,
          });
        } catch (err) {
          console.error('sendEmailGmail failed', err);
        }

        await this.ui.alert('הורה נוצר/שויך בהצלחה + נשלח מייל', 'הצלחה');
      } catch (e: any) {
        console.error(e);
        await this.ui.alert(e?.message ?? 'שגיאה - המערכת לא הצליחה להוסיף הורה', 'שגיאה');
      }
    });
  }

  private getTenantSchemaOrThrow(): string {
    const farm = getCurrentFarmMetaSync();
    const schema = farm?.schema_name ?? null;
    if (!schema) {
      throw new Error('לא נמצא selectedSchema ב-localStorage. כנראה שלא נעשה bootstrap לטננט.');
    }
    return schema;
  }

  private async getParentRoleId(): Promise<number> {
    const dbcTenant = dbTenant();

    const { data, error } = await dbcTenant
      .from('role')
      .select('id')
      .eq('table', 'parents')
      .maybeSingle();

    if (error || !data?.id) {
      console.error('getParentRoleId error', error);
      throw new Error('לא הצלחתי למצוא role_id לתפקיד הורה בטננט הנוכחי');
    }

    return data.id as number;
  }

  async checkIfParentExists(email: string, tenant_id: string) {
    const { data: user, error: userErr } = await dbPublic()
      .from('users')
      .select('uid')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (userErr) throw userErr;

    if (!user) {
      return { existsInSystem: false, existsInTenant: false, uid: null };
    }

    const { data: tenantUser, error: tenantErr } = await dbPublic()
      .from('tenant_users')
      .select('uid, role_in_tenant')
      .eq('tenant_id', tenant_id)
      .eq('uid', user.uid)
      .maybeSingle();

    if (tenantErr) throw tenantErr;

    const existsInTenant = !!(tenantUser && tenantUser.role_in_tenant === 'parent');

    return {
      existsInSystem: true,
      existsInTenant,
      uid: user.uid,
    };
  }

  private async createUserInSupabase(
    uid: string,
    email: string,
    role: string,
    phone?: string | null,
  ): Promise<void> {
    const dbcPublic = dbPublic();

    const row = {
      uid: (uid || '').trim(),
      email: (email || '').trim(),
      role: (role || '').trim(),
      phone: (phone || '').trim() || null,
    };

    const { error } = await dbcPublic.from('users').upsert(row, {
      onConflict: 'uid',
      ignoreDuplicates: true,
    });

    if (error) throw new Error(`users upsert failed: ${error.message}`);
  }

  private async createTenantUserInSupabase(body: { tenant_id: string; uid: string }): Promise<void> {
    const dbcPublic = dbPublic();
    const parentRoleId = await this.getParentRoleId();

    const { error } = await dbcPublic.from('tenant_users').upsert(
      {
        tenant_id: body.tenant_id,
        uid: body.uid,
        role_in_tenant: 'parent',
        role_id: parentRoleId,
        is_active: true,
      },
      {
        onConflict: 'tenant_id,uid,role_in_tenant',
        ignoreDuplicates: true,
      },
    );

    if (error) throw new Error(`tenant_users upsert failed: ${error.message}`);
  }

  private async createParentInSupabase(body: {
    uid: string;
    first_name: string;
    last_name: string;
    email: string;
    phone?: string | null;
    id_number?: string | null;
    address?: any;
    extra_notes?: string | null;
    message_preferences?: string[] | null;
    is_active?: boolean | null;
  }) {
    const dbcTenant = dbTenant();

    const row = {
      uid: (body.uid || '').trim(),
      first_name: body.first_name,
      last_name: body.last_name,
      email: body.email,
      phone: body.phone ?? null,
      id_number: body.id_number ?? null,
      address: body.address ?? null,
      extra_notes: body.extra_notes ?? null,
      message_preferences: body.message_preferences?.length
        ? body.message_preferences
        : ['inapp'],
      is_active: body.is_active ?? true,
    };

    const { data, error } = await dbcTenant
      .from('parents')
      .upsert(row, { onConflict: 'uid', ignoreDuplicates: true })
      .select('*')
      .single();

    if (error) {
      throw new Error(`parents upsert failed: ${error.message}`);
    }

    return data;
  }

  exportToExcel(): void {
    try {
      const rows = this.filteredParents.map((parent) => {
        const row: Record<string, any> = {};

        this.visibleColumns.forEach((col) => {
          row[col.label] = this.getExportCellValue(parent, col.key);
        });

        return row;
      });

      if (!rows.length) {
        this.ui.alert('אין נתונים לייצוא.', 'ייצוא לאקסל');
        return;
      }

      const worksheet: XLSX.WorkSheet = XLSX.utils.json_to_sheet(rows);

      // רוחב עמודות לפי תוכן
      worksheet['!cols'] = this.visibleColumns.map((col) => ({
        wch: Math.max(col.label.length + 4, 18),
      }));

      const workbook: XLSX.WorkBook = {
        Sheets: { הורים: worksheet },
        SheetNames: ['הורים'],
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

      saveAs(blob, `parents-export-${yyyy}-${mm}-${dd}.xlsx`);
    } catch (error) {
      console.error('exportToExcel failed', error);
      this.ui.alert('אירעה שגיאה בעת ייצוא לאקסל.', 'שגיאה');
    }
  }

  private getExportCellValue(parent: ParentRow, key: ParentColumnKey): string | number {
    switch (key) {
      case 'first_name':
        return parent.first_name || '—';

      case 'last_name':
        return parent.last_name || '—';

      case 'phone':
        return parent.phone || '—';

      case 'email':
        return parent.email || '—';

      case 'id_number':
        return parent.id_number || '—';

      case 'billing_day_of_month':
        return parent.billing_day_of_month ?? '—';

      case 'status':
        return parent.is_active === false ? 'לא פעיל' : 'פעיל';

      case 'children_status': {
        const parts: string[] = [];
        if (parent.hasActiveChildren) parts.push('ילדים פעילים');
        if (parent.hasInactiveChildren) parts.push('ילדים לא פעילים');
        return parts.length ? parts.join(', ') : '—';
      }

      default:
        return '—';
    }
  }
  async removePaymentProfile(profileId: string) {
    if (!this.selectedUid || !this.drawerParent) return;
    const profile = this.drawerPaymentProfiles.find(p => p.id === profileId);

    // 👉 כאן מכניסים את ה־message הדינמי
    const ok = await this.ui.confirm({
      title: 'מחיקת אמצעי תשלום',
      message: profile?.is_default
        ? 'הכרטיס הזה הוא ברירת מחדל. יוגדר כרטיס אחר כברירת מחדל. להמשיך?'
        : 'להסיר את אמצעי התשלום הזה?'
    });

    if (!ok) return;

    const { error } = await dbTenant()
      .from('payment_profiles')
      .update({
        active: false,
        is_default: false,
      })
      .eq('id', profileId)
      .eq('parent_uid', this.selectedUid);

    if (error) {
      await this.ui.alert(error.message, 'שגיאה');
      return;
    }

    await this.loadDrawerData(this.selectedUid);
    await this.loadParents();

    await this.ui.alert('אמצעי התשלום הוסר בהצלחה', 'בוצע');
  }
  formatExpiry(month?: number | null, year?: number | null): string {
    if (!month || !year) return '—';
    return `${String(month).padStart(2, '0')}/${String(year).slice(-2)}`;
  }

  isExpiringSoon(profile: PaymentProfileRow): boolean {
    if (!profile.expiry_month || !profile.expiry_year) return false;

    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const expiryMonthEnd = new Date(profile.expiry_year, profile.expiry_month, 0);

    const oneMonthFromNow = new Date(
      currentMonthStart.getFullYear(),
      currentMonthStart.getMonth() + 2,
      0
    );

    return expiryMonthEnd >= currentMonthStart && expiryMonthEnd <= oneMonthFromNow;
  }
  async setDefaultPaymentProfile(profileId: string) {
    if (!this.selectedUid) return;

    try {
      await this.pagos.setDefault(profileId, this.selectedUid);

      await this.loadDrawerData(this.selectedUid);
      await this.loadParents();
    } catch (e: any) {
      await this.ui.alert(
        e?.message ?? 'לא ניתן היה לשנות כרטיס ברירת מחדל',
        'שגיאה'
      );
    }
  }

  goToChildCard(childId: string): void {
    if (!childId) return;

    this.router.navigate(['/secretary/children'], {
      queryParams: { childId },
    });
  }
  getChildStatusLabel(status?: string | null): string {
    switch ((status || '').trim()) {
      case 'Active':
        return 'פעיל';

      case 'Deleted':
        return 'נמחק';

      case 'Pending Addition Approval':
        return 'ממתין לאישור הוספה';

      case 'Pending Deletion Approval':
        return 'ממתין לאישור מחיקה';

      case 'Deletion Scheduled':
        return 'מחיקה מתוזמנת';

      case 'Pending Parent Terms':
        return 'ממתין לאישור הורה';

      default:
        return status || 'לא ידוע';
    }
  }
  todayDate(): string {
    return new Date().toISOString().slice(0, 10);
  }

// ===== Credit card / drawer state =====

  private newRequestId(): string {
    return typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  private resetAddCardState(destroyHostedFields = true): void {
    if (destroyHostedFields) this.destroyHostedFields();

  this.addCardOpen = false;
  this.savingToken = false;
  this.tokenSaved = false;
  this.tokenError = null;
  this.tokenCallbackHandled = false;

  this.addCardLockedParentUid = null;
  this.saveRequestId = null;

    this.hfAdd = null;
    this.thtkAdd = null;
    this.hfInitTried = false;
  }

  private isActiveAddCardSession(parentUid: string | null, requestId: string | null): boolean {
    return !!parentUid
      && !!requestId
      && this.addCardOpen
      && this.addCardLockedParentUid === parentUid
      && this.saveRequestId === requestId;
  }

  async openDetails(uid: string) {
    const cleanUid = (uid || '').trim();

    if (!cleanUid) {
      await this.ui.alert('שגיאה: uid ריק. לא ניתן לפתוח פרטי הורה.', 'שגיאה');
      return;
    }

    this.resetAddCardState(true);

    this.selectedUid = cleanUid;
    this.drawerParent = null;
    this.drawerChildren = [];
    this.drawerPaymentProfiles = [];
    this.editMode = false;
    this.originalParent = null;

    await this.drawer.open();
    await this.loadDrawerData(cleanUid);
  }

  closeDetails() {
    this.resetAddCardState(true);

    this.drawer.close();
    this.selectedUid = null;
    this.drawerParent = null;
    this.drawerChildren = [];
    this.drawerPaymentProfiles = [];
    this.editMode = false;
    this.originalParent = null;
    this.drawerLoading = false;
    this.drawerLoadRequestId = null;
  }

  private async loadDrawerData(uid: string) {
    const cleanUid = (uid || '').trim();
    if (!cleanUid) return;

    const requestId = this.newRequestId();
    this.drawerLoadRequestId = requestId;

    this.drawerLoading = true;
    this.drawerPaymentProfiles = [];

    try {
      const db = dbTenant();

      const { data: p, error: pErr } = await db
        .from('parents')
        .select('uid, first_name, last_name, id_number, phone, email, address, extra_notes, message_preferences, billing_day_of_month, is_active, scheduled_inactive_at')
        .eq('uid', cleanUid)
        .maybeSingle();

      if (this.drawerLoadRequestId !== requestId || this.selectedUid !== cleanUid) return;
      if (pErr) throw pErr;

      if (!p) {
        this.drawerParent = null;
        this.originalParent = null;
        this.drawerChildren = [];
        this.drawerPaymentProfiles = [];
        await this.ui.alert('לא נמצאה רשומת הורה עבור המשתמש הזה.', 'לא נמצא');
        return;
      }

      const [{ data: kids, error: kidsErr }, { data: profiles, error: profilesErr }] =
        await Promise.all([
          db
            .from('children')
            .select('child_uuid, first_name, last_name, parent_uid, gender, status, birth_date, gov_id')
            .eq('parent_uid', cleanUid)
            .order('first_name', { ascending: true }),

          db
            .from('payment_profiles')
            .select('id, parent_uid, brand, last4, expiry_month, expiry_year, active, is_default, created_at')
            .eq('parent_uid', cleanUid)
            .eq('active', true)
            .order('is_default', { ascending: false })
            .order('created_at', { ascending: false }),
        ]);

      if (this.drawerLoadRequestId !== requestId || this.selectedUid !== cleanUid) return;
      if (kidsErr) throw kidsErr;
      if (profilesErr) throw profilesErr;

      this.drawerParent = p as ParentDetailsRow;
      this.originalParent = structuredClone(this.drawerParent);
      this.buildParentForm(this.drawerParent);

    this.drawerChildren = kids ?? [];
    this.drawerPaymentProfiles = profiles ?? [];
  } catch (e) {
    console.error(e);

    if (this.drawerLoadRequestId === requestId) {
      this.drawerChildren = [];
      this.drawerParent = null;
      this.originalParent = null;
      this.drawerPaymentProfiles = [];
    }
  } finally {
    if (this.drawerLoadRequestId === requestId) {
      this.drawerLoading = false;
    }
  }

  openAddCardModal(event?: MouseEvent): void {
    event?.stopPropagation();

    if (this.savingToken) return;

    const parentUid = (this.selectedUid || '').trim();

  if (!parentUid || !this.drawerParent || this.drawerParent.uid !== parentUid) {
    this.ui.alert('לא נבחר הורה תקין להוספת כרטיס.', 'שגיאה');
    return;
  }

  const requestId = this.newRequestId();

  this.destroyHostedFields();

  this.addCardOpen = true;
  this.savingToken = false;
  this.tokenSaved = false;
  this.tokenError = null;
  this.tokenCallbackHandled = false;

  this.addCardLockedParentUid = parentUid;
  this.saveRequestId = requestId;

  this.hfAdd = null;
  this.thtkAdd = null;
  this.hfInitTried = false;

  setTimeout(() => {
    this.ensureAddHostedFieldsReady(parentUid, requestId);
  }, 0);
}

  closeAddCardModal(): void {
    if (this.savingToken) return;
    this.resetAddCardState(true);
  }

  private async ensureAddHostedFieldsReady(parentUid: string, requestId: string): Promise<void> {
    if (!this.isActiveAddCardSession(parentUid, requestId)) return;
    if (this.hfAdd || this.hfInitTried) return;

    this.hfInitTried = true;
    this.tokenError = null;

    try {
      const farm = getCurrentFarmMetaSync();
      const tenantSchema = farm?.schema_name ?? null;

      if (!tenantSchema) {
        this.tokenError = 'לא זוהתה סכמת חווה';
        return;
      }

      const { thtk } = await this.tranzila.getHandshakeToken(tenantSchema);

      if (!this.isActiveAddCardSession(parentUid, requestId)) return;

      this.thtkAdd = thtk;

      if (typeof TzlaHostedFields === 'undefined' || !TzlaHostedFields) {
        this.tokenError = 'רכיב התשלום לא נטען';
        return;
      }

      this.hfAdd = TzlaHostedFields.create({
        sandbox: false,
        fields: {
          credit_card_number: {
            selector: '#sp_credit_card_number',
            placeholder: '4580 4580 4580 4580',
            tabindex: 1,
          },
          cvv: {
            selector: '#sp_cvv',
            placeholder: '123',
            tabindex: 2,
          },
          expiry: {
            selector: '#sp_expiry',
            placeholder: '12/26',
            version: '1',
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
      },
    });
  } catch (e: any) {
    console.error('ensureAddHostedFieldsReady error', e);

    if (this.isActiveAddCardSession(parentUid, requestId)) {
      this.tokenError = e?.message ?? 'שגיאה באתחול שדות האשראי';
    }
  }

async tokenizeAndSaveCardForSelectedParent(): Promise<void> {
  if (this.savingToken) return;

  this.tokenError = null;
  this.tokenSaved = false;

  const parentUid = this.addCardLockedParentUid;
  const requestId = this.saveRequestId;

  if (!parentUid || !requestId) {
    this.tokenError = 'לא זוהה הורה לשמירת אמצעי התשלום';
    return;
  }

  if (this.selectedUid !== parentUid || this.drawerParent?.uid !== parentUid) {
    this.tokenError = 'ההורה השתנה בזמן שמירת הכרטיס. סגרי ופתחי מחדש.';
    return;
  }

  if (!this.hfAdd || !this.thtkAdd) {
    this.tokenError = 'שדות התשלום לא מוכנים';
    return;
  }

  this.savingToken = true;

  const farm = getCurrentFarmMetaSync();
  const tenantSchema = farm?.schema_name ?? null;

  if (!tenantSchema) {
    this.tokenError = 'לא זוהתה סכמת חווה';
    this.savingToken = false;
    return;
  }

  const parentEmail = this.drawerParent?.email ?? null;
  const parentContact =
    `${this.drawerParent?.first_name ?? ''} ${this.drawerParent?.last_name ?? ''}`.trim();

  this.hfAdd.charge(
    {
      terminal_name: 'moachapp',
      thtk: this.thtkAdd,
      tran_mode: 'N',
      tokenize: true,
      amount: '1',
      currency_code: 'ILS',
      payment_plan: 1,
      response_language: 'hebrew',
      requested_by_user: `secretary-parent-card-tokenize-${requestId}`,
      email: parentEmail || undefined,
      contact: parentContact || undefined,
    },
    async (err: any, response: any) => {
      if (!this.isActiveAddCardSession(parentUid, requestId)) return;
      if (this.tokenCallbackHandled) return;

      this.tokenCallbackHandled = true;

      try {
        if (err?.messages?.length) {
          err.messages.forEach((msg: any) => {
            const el = document.getElementById('sp_errors_for_' + msg.param);
            if (el) el.textContent = msg.message;
          });

          this.tokenError = 'שגיאה בפרטי הכרטיס';
          return;
        }

        const tx = response?.transaction_response;

        if (!tx?.success) {
          this.tokenError = tx?.error || 'שמירת אמצעי תשלום נכשלה';
          return;
        }

        const tokenRef =
          tx?.token ||
          tx?.card_token ||
          tx?.Token ||
          response?.token;

        const last4 =
          tx?.last4 ||
          tx?.ccno_last4 ||
          tx?.card_last4 ||
          response?.last4;

        const brand =
          tx?.brand ||
          tx?.card_brand ||
          response?.brand ||
          null;

        const expiryMonth =
          tx?.expiry_month?.toString() ||
          tx?.expmonth?.toString() ||
          response?.expiry_month?.toString() ||
          null;

        const expiryYear =
          tx?.expiry_year?.toString() ||
          tx?.expyear?.toString() ||
          response?.expiry_year?.toString() ||
          null;

        if (!tokenRef) {
          this.tokenError = 'התקבל אישור מטרנזילה אבל לא התקבל token לכרטיס';
          return;
        }

        await this.tranzila.savePaymentMethod({
            tenantSchema,
            parentUid,
            token: tokenRef,
            last4,
            brand,
            expiryMonth,
            expiryYear,
            userType: 'parent',
          });

        this.tokenSaved = true;

        await this.ui.alert('אמצעי התשלום נשמר בהצלחה.', 'הצלחה');

        if (!this.isActiveAddCardSession(parentUid, requestId)) return;

        this.resetAddCardState(true);

        if (this.selectedUid === parentUid) {
          await this.loadDrawerData(parentUid);
        }

        await this.loadParents();
      } catch (e: any) {
        const body = e?.error;

        if (e?.status === 409 && body?.error === 'CARD_ALREADY_EXISTS') {
          this.tokenError =
            body.message ||
            `הכרטיס שהוסף כבר קיים אצל ההורה ${body.existingParentUid || ''}`;
          return;
        }

        this.tokenError =
          body?.message ||
          body?.error ||
          e?.message ||
          'שגיאה בשמירת אמצעי תשלום במערכת';
      } finally {
        if (this.isActiveAddCardSession(parentUid, requestId)) {
          this.savingToken = false;
        }
      }
    }
  );
}

  private destroyHostedFields(): void {
    try {
      const anyHf = this.hfAdd as any;

      if (anyHf?.destroy) anyHf.destroy();
      if (anyHf?.remove) anyHf.remove();
      if (anyHf?.unmount) anyHf.unmount();
    } catch (e) {
      console.warn('[ADD_CARD][HF_DESTROY_FAILED]', e);
    }

    this.hfAdd = null;
    this.thtkAdd = null;
    this.hfInitTried = false;

    ['sp_credit_card_number', 'sp_cvv', 'sp_expiry'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '';
    });
  }
}