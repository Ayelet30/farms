// secretary-parents.component.ts
import { Component, OnInit, ViewChild, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatSidenav, MatSidenavModule } from '@angular/material/sidenav';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { FormsModule } from '@angular/forms';
import { UiDialogService } from '../../services/ui-dialog.service';
import { ActivatedRoute } from '@angular/router';
import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';
import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { RouterModule } from '@angular/router';
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

import { CreateUserService } from '../../services/create-user.service';
import { MailService } from '../../services/mail.service';

type ParentRow = {
  uid: string;
  first_name: string;
  last_name: string;
  id_number?: string | null;
  billing_day_of_month?: number | null;
  phone?: string;
  email?: string;
  is_active?: boolean | null; // סטטוס הורה
  hasActiveChildren?: boolean; // יש ילדים פעילים
  hasInactiveChildren?: boolean; // יש ילדים לא פעילים
};

interface ParentDetailsRow extends ParentRow {
  address?: string | null;
  extra_notes?: string | null;
  message_preferences?: string[] | null;
}

type ParentFile = {
  id: string;
  file_name: string;
  file_url: string;
  created_at?: string | null;
};

type ParentInvoice = {
  id: string;
  date: string;
  description: string;
  amount: number;
};

type PaymentSummary = {
  totalPaid: number;
  outstanding: number;
  upcoming?: number | null;
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
  parents: ParentRow[] = [];

  // 🔍 ערך החיפוש הכללי
  searchText = '';
  // מצב חיפוש: לפי שם / לפי ת"ז
  searchMode: 'name' | 'id' = 'name';
  // סינון
  statusFilter: 'all' | 'active' | 'inactive' = 'all';
  childrenFilter: 'all' | 'active' | 'inactive' = 'all';
  // תפריט פתוח / סגור
  showSearchPanel = false;
  panelFocus: 'search' | 'filter' = 'search';

  isLoading = true;
  error: string | null = null;

  @ViewChild('drawer') drawer!: MatSidenav;
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

  toast: { error: (msg: string) => void } | any;

  // 🌟 חדש – בשביל עריכה inline במגירה
  parentForm!: FormGroup;
  editMode = false;
  private originalParent: ParentDetailsRow | null = null;

  // ====== מגבלות תווים (כמו שביקשת) ======
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

  // מנקה רווחים/מקפים/סוגריים
  private normalizePhone(raw: any): string {
    return String(raw ?? '').replace(/[^\d+]/g, ''); // משאיר ספרות ו-+
  }

  // ולידטור לטלפון ישראלי
private israelPhoneValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const raw = control.value;
    if (raw == null || raw === '') return null;

    const rawStr = String(raw);

    // ✅ חוסם אותיות שלא יעברו “ניקוי” בטעות
    if (/[A-Za-z\u0590-\u05FF]/.test(rawStr)) {
      return { phoneDigitsOnly: true };
    }

    const val = this.normalizePhone(rawStr);

    // רק ספרות (או + בתחילה)
    if (!/^\+?\d+$/.test(val)) return { phoneDigitsOnly: true };

    // +9725XXXXXXXX
    if (val.startsWith('+972')) {
      const rest = val.slice(4);
      if (!/^5\d{8}$/.test(rest)) return { ilPhone: true };
      return null;
    }

    // 9725XXXXXXXX
    if (val.startsWith('972')) {
      const rest = val.slice(3);
      if (!/^5\d{8}$/.test(rest)) return { ilPhone: true };
      return null;
    }

    // 05XXXXXXXX
    if (/^05\d{8}$/.test(val)) return null;

    return { ilPhone: true };
  };
}


  constructor(
    private ui: UiDialogService,
    private dialog: MatDialog,
    private createUserService: CreateUserService,
    private fb: FormBuilder,
    private mailService: MailService,
    private route: ActivatedRoute,
  ) {}

  // ================== חיפוש + סינון ==================

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

  get filteredParents(): ParentRow[] {
    let rows = [...this.parents];

    const raw = (this.searchText || '').trim();

    if (raw) {
      if (this.searchMode === 'name') {
        const q = raw.toLowerCase();
        rows = rows.filter(p => {
          const hay = `${p.first_name || ''} ${p.last_name || ''}`.toLowerCase();
          return hay.includes(q);
        });
      } else {
        const qId = raw.replace(/\s/g, '');
        rows = rows.filter(p => {
          const id = (p.id_number || '').toString().replace(/\s/g, '');
          return qId !== '' && id.startsWith(qId);
        });
      }
    }

    if (this.statusFilter !== 'all') {
      rows = rows.filter(p => {
        const active = p.is_active !== false;
        return this.statusFilter === 'active' ? active : !active;
      });
    }

    if (this.childrenFilter === 'active') {
      rows = rows.filter(p => !!p.hasActiveChildren);
    } else if (this.childrenFilter === 'inactive') {
      rows = rows.filter(p => !!p.hasInactiveChildren);
    }

    return rows;
  }

  clearFilters() {
    this.searchText = '';
    this.searchMode = 'name';
    this.statusFilter = 'all';
    this.childrenFilter = 'all';
  }

  toggleSearchPanel(event?: MouseEvent) {
    if (event) {
      event.stopPropagation();
    }
    this.showSearchPanel = !this.showSearchPanel;
  }

  // ================== lifecycle ==================
  async ngOnInit() {
    try {
      await ensureTenantContextReady();
      await this.loadParents();
    } catch (e: any) {
      this.error = e?.message || 'Failed to load parents';
      console.error(e);
    } finally {
      this.isLoading = false;
    }
  }

  private async loadParents() {
    this.isLoading = true;
    this.error = null;

    try {
      const dbc = dbTenant();

      const { data: parentsData, error: parentsErr } = await dbc
        .from('parents')
        .select('uid, first_name, last_name, id_number, phone, email, is_active, billing_day_of_month')
        .order('first_name', { ascending: true });

      if (parentsErr) throw parentsErr;

      const parents = (parentsData ?? []) as ParentRow[];

      const { data: kidsData, error: kidsErr } = await dbc
        .from('children')
        .select('parent_uid, status');

      if (kidsErr) {
        console.error('children fetch error', kidsErr);
      }

      const map = new Map<string, { hasActive: boolean; hasInactive: boolean }>();

      (kidsData ?? []).forEach((kid: any) => {
        if (!kid.parent_uid) return;
        const entry = map.get(kid.parent_uid) || { hasActive: false, hasInactive: false };

        const status = (kid.status || '').toString().toLowerCase();
        if (status === 'active' || status === 'פעיל') entry.hasActive = true;
        if (status === 'inactive' || status === 'לא פעיל') entry.hasInactive = true;

        map.set(kid.parent_uid, entry);
      });

      this.parents = parents.map(p => {
        const stats = map.get(p.uid) || { hasActive: false, hasInactive: false };
        return {
          ...p,
          hasActiveChildren: stats.hasActive,
          hasInactiveChildren: stats.hasInactive,
        };
      });
    } catch (e: any) {
      this.error = e?.message || 'Failed to fetch parents.';
      console.error(e);
      this.parents = [];
    } finally {
      this.isLoading = false;
    }
  }

  // ================== מגירה – פתיחה/סגירה ==================

  async openDetails(uid: string) {
    const cleanUid = (uid || '').trim();

    if (!cleanUid) {
      await this.ui.alert('שגיאה: uid ריק. לא ניתן לפתוח פרטי הורה.', 'שגיאה');
      return;
    }

    this.selectedUid = cleanUid;
    this.drawerChildren = [];
    this.editMode = false;
    this.originalParent = null;

    console.log('[PARENTS] openDetails uid=', this.selectedUid);

    this.drawer.open();
    await this.loadDrawerData(this.selectedUid);
  }

  closeDetails() {
    this.drawer.close();
    this.selectedUid = null;
    this.drawerParent = null;
    this.drawerChildren = [];
    this.editMode = false;
    this.originalParent = null;
  }

  private async loadDrawerData(uid: string) {
    this.drawerLoading = true;

    try {
      const db = dbTenant();
      const cleanUid = (uid || '').trim();

      console.log('[PARENTS] loadDrawerData uid=', cleanUid);

      const { data: p, error: pErr } = await db
        .from('parents')
        .select(
          'uid, first_name, last_name, id_number, phone, email, address, extra_notes, message_preferences, billing_day_of_month'
        )
        .eq('uid', cleanUid)
        .maybeSingle();

      if (pErr) throw pErr;

      if (!p) {
        this.drawerParent = null;
        this.originalParent = null;
        this.drawerChildren = [];
        await this.ui.alert('לא נמצאה רשומת הורה עבור המשתמש הזה (uid לא קיים בטבלת parents).', 'לא נמצא');
        return;
      }

      this.drawerParent = p as ParentDetailsRow;

      this.originalParent = structuredClone(this.drawerParent);

      this.buildParentForm(this.drawerParent);

      const { data: kids, error: kidsErr } = await db
        .from('children')
        .select('child_uuid, first_name, last_name, parent_uid, gender, status, birth_date, gov_id')
        .eq('parent_uid', cleanUid)
        .order('first_name', { ascending: true });

      if (kidsErr) throw kidsErr;

      this.drawerChildren = kids ?? [];
    } catch (e) {
      console.error(e);
      this.drawerChildren = [];
      this.drawerParent = null;
      this.originalParent = null;
    } finally {
      this.drawerLoading = false;
    }
  }

  // ================== עריכה inline במגירה ==================

  private buildParentForm(parent: ParentDetailsRow) {
    this.parentForm = this.fb.group({
      // ✅ חדש: שם פרטי/משפחה ניתנים לעריכה (ולא full_name נעול)
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


      // ✅ אימייל: גם maxLength וגם email
      email: [
        parent.email ?? '',
        [Validators.required, Validators.email, Validators.maxLength(this.MAX_EMAIL)],
      ],

      billing_day: [
        parent.billing_day_of_month ?? 10,
        [Validators.required, Validators.min(1), Validators.max(28)],
      ],

      // ✅ כתובת + הערות עם הגבלת תווים
      address: [parent.address ?? '', [Validators.maxLength(this.MAX_ADDRESS)]],
      extra_notes: [parent.extra_notes ?? '', [Validators.maxLength(this.MAX_EXTRA_NOTES)]],

      message_preferences: [
        parent.message_preferences && parent.message_preferences.length
          ? parent.message_preferences
          : ['inapp'],
        [Validators.required],
      ],
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

    // ✅ אם יש שגיאה — גם מסמנים וגם קופץ פופאפ
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

    // נרמול עדין לפני שמירה
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
    const oldBillingDay = this.originalParent.billing_day_of_month ?? 10;
    if (newBillingDay !== oldBillingDay) changes.billing_day_of_month = newBillingDay;

    if (Object.keys(changes).length === 0) {
      this.editMode = false;
      return;
    }

    try {
      const db = dbTenant();
      const cleanUid = (this.selectedUid || '').trim();

      console.log('[PARENTS] saveParentEdits uid=', cleanUid, 'changes=', changes);

      const { data, error } = await db
        .from('parents')
        .update(changes)
        .eq('uid', cleanUid)
        .select(
          'uid, first_name, last_name, id_number, phone, email, address, extra_notes, message_preferences, billing_day_of_month'
        )
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        throw new Error('עדכון נכשל: לא נמצא הורה עם ה-uid הזה (ייתכן selectedUid לא נכון).');
      }

      this.drawerParent = data as ParentDetailsRow;
      this.originalParent = structuredClone(this.drawerParent);

      // עדכון השורה בטבלה (כולל שמות)
      this.parents = this.parents.map(p =>
        p.uid === cleanUid
          ? {
              ...p,
              first_name: this.drawerParent!.first_name,
              last_name: this.drawerParent!.last_name,
              phone: this.drawerParent!.phone,
              email: this.drawerParent!.email,
              id_number: this.drawerParent!.id_number,
              billing_day_of_month: this.drawerParent!.billing_day_of_month,
            }
          : p,
      );

      this.editMode = false;
    } catch (e: any) {
      console.error(e);
      await this.ui.alert(e?.message || 'שמירת השינויים נכשלה', 'שמירה נכשלה');
    }
  }

  // ================== דיאלוג יצירת הורה חדש ==================

  openAddParentDialog() {
    const ref = this.dialog.open(AddParentDialogComponent, {
      width: '700px',
      maxWidth: '90vw',
      height: '90vh',
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
        k => !(body as any)[k],
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
            tenantSchema: tenantSchema,
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

  /** ================== Helpers: Inserts to Supabase ================== */

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

    const { error } = await dbcPublic.from('users').upsert(row, { onConflict: 'uid' });

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
      .upsert(row, { onConflict: 'uid' })
      .select('*')
      .single();

    if (error) {
      throw new Error(`parents upsert failed: ${error.message}`);
    }

    return data;
  }
}
