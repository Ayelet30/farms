import { Component, OnInit, ViewChild, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { MatSidenav, MatSidenavModule } from '@angular/material/sidenav';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MailService } from '../../services/mail.service';

import {
  ensureTenantContextReady,
  dbPublic,
  dbTenant,
} from '../../services/legacy-compat';

import {
  AddInstructorDialogComponent,
  AddInstructorPayload,
} from './add-instructor-dialog/add-instructor-dialog.component';

import { CreateUserService } from '../../services/create-user.service';

type InstructorRow = {
  id_number: string;
  uid?: string | null;
  first_name: string;
  last_name: string;
  phone?: string | null;   // בפועל יגיע מ-public.users כשיש uid
  email?: string | null;   // "
  status?: string | null;
  gender?: string | null;
  accepts_makeup_others?: boolean | null;
  allow_availability_edit?: boolean | null;
};

interface InstructorWeeklyAvailabilityRow {
  instructor_id_number: string;
  day_of_week: number;          // 0-6 (ראשון-שבת)
  start_time: string | null;    // 'HH:MM:SS'
  end_time: string | null;      // 'HH:MM:SS'
  lesson_type_mode: string | null; // 'both' | 'double_only' | 'double or both' | 'break'
}

interface InstructorDetailsRow extends InstructorRow {
  address?: string | null;
  license_id?: string | null;
  about?: string | null;
  education?: string | null;
  ages?: any | null;                      // jsonb – טווחי גיל
  taught_child_genders?: string[] | null; // ["זכר","נקבה"]
  default_lesson_duration_min?: number | null;
  min_age_years?: number | null;
  max_age_years?: number | null;
  certificate?: string | null;
  photo_url?: string | null;
  notify?: any | null; // jsonb הגדרות התראות

  // ✅ השדות החדשים:
  birth_date?: string | null;        // מגיע מ-Supabase כ-'YYYY-MM-DD'
}

@Component({
  selector: 'app-secretary-instructors',
  standalone: true,
  imports: [CommonModule, FormsModule, MatSidenavModule, MatDialogModule],
  templateUrl: './secretary-instructors.component.html',
  styleUrls: ['./secretary-instructors.component.css'],
})
export class SecretaryInstructorsComponent implements OnInit {
  instructors: InstructorRow[] = [];

  // לו"ז שבועי במגירה (מצב תצוגה)
  drawerAvailability: InstructorWeeklyAvailabilityRow[] = [];

  // לו"ז שבועי במצב עריכה
  editAvailability: InstructorWeeklyAvailabilityRow[] = [];

  dayOfWeekToLabel(d?: number | null): string {
    switch (d) {
      case 0: return 'ראשון';
      case 1: return 'שני';
      case 2: return 'שלישי';
      case 3: return 'רביעי';
      case 4: return 'חמישי';
      case 5: return 'שישי';
      case 6: return 'צאת שבת';
      default: return '—';
    }
  }

  lessonTypeLabel(mode?: string | null): string {
    switch (mode) {
      case 'both': return 'בודד או זוגי';
      case 'double_only': return 'זוגי בלבד';
      case 'double or both': return 'זוגי או גם וגם';
      case 'break': return 'הפסקה';
      default: return '—';
    }
  }

  // ======= מצב עריכה במגירה =======
  editMode = false;
  editModel: InstructorDetailsRow | null = null;
  savingEdit = false;

  // 🔍 חיפוש + סינונים
  searchText = '';
  searchMode: 'name' | 'id' = 'name';

  statusFilter: 'all' | 'active' | 'inactive' = 'all';
  makeupFilter: 'all' | 'accepts' | 'not_accepts' = 'all';
  genderFilter: 'all' | 'male' | 'female' | 'other' = 'all';

  showSearchPanel = false;
  panelFocus: 'search' | 'filter' = 'search';

  isLoading = true;
  error: string | null = null;

  @ViewChild('drawer') drawer!: MatSidenav;
  selectedIdNumber: string | null = null;
  drawerLoading = false;
  drawerInstructor: InstructorDetailsRow | null = null;

  constructor(
    private dialog: MatDialog,
    private createUserService: CreateUserService,
    private mailService: MailService
  ) {}

  // ======= לוגיקה לחיפוש/סינון =======

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

  get filteredInstructors(): InstructorRow[] {
    let rows = [...this.instructors];

    // 1) חיפוש
    const q = (this.searchText || '').trim().toLowerCase();
    if (q) {
      rows = rows.filter((i) => {
        if (this.searchMode === 'name') {
          const hay = `${i.first_name || ''} ${i.last_name || ''}`.toLowerCase();
          return hay.includes(q);
        }

        const id = (i.id_number || '').toString().trim();
        return id === q;
      });
    }

    // 2) סטטוס מדריך
    if (this.statusFilter !== 'all') {
      rows = rows.filter((i) => {
        const status = (i.status || '').toString().toLowerCase();
        const active =
          status === 'active' || status === 'פעיל' || status === 'פעילה';
        return this.statusFilter === 'active' ? active : !active;
      });
    }

    // 3) מקבל השלמות
    if (this.makeupFilter !== 'all') {
      rows = rows.filter((i) => {
        const accepts = i.accepts_makeup_others === true;
        return this.makeupFilter === 'accepts' ? accepts : !accepts;
      });
    }

    // 4) מין מדריך
    if (this.genderFilter !== 'all') {
      rows = rows.filter((i) => {
        const g = (i.gender || '').toString().toLowerCase();
        if (this.genderFilter === 'male') {
          return g.includes('זכר') || g.includes('male');
        }
        if (this.genderFilter === 'female') {
          return g.includes('נקבה') || g.includes('female');
        }
        return g && !g.includes('זכר') && !g.includes('נקבה');
      });
    }

    return rows;
  }

  clearFilters() {
    this.searchText = '';
    this.searchMode = 'name';
    this.statusFilter = 'all';
    this.makeupFilter = 'all';
    this.genderFilter = 'all';
  }

  // ======= lifecycle =======

  async ngOnInit() {
    console.log('[INSTRUCTORS] ngOnInit start');
    try {
      await ensureTenantContextReady();
      console.log('[INSTRUCTORS] tenant context ready');
      await this.loadInstructors();
      console.log('[INSTRUCTORS] loadInstructors finished, count =', this.instructors.length);
    } catch (e: any) {
      console.error('[INSTRUCTORS] ngOnInit error:', e);
      this.error = e?.message || 'Failed to load instructors';
    } finally {
      this.isLoading = false;
      console.log('[INSTRUCTORS] ngOnInit end');
    }
  }

  private async loadInstructors() {
    this.isLoading = true;
    this.error = null;

    console.log('[INSTRUCTORS] loadInstructors() called');
    try {
      const dbcTenant = dbTenant();
      console.log('[INSTRUCTORS] querying tenant.instructors...');

      // 1) מביאים מדריכים מהטננט – בלי להסתמך על email/phone
      const { data, error } = await dbcTenant
        .from('instructors')
        .select(
          `
          id_number,
          uid,
          first_name,
          last_name,
          phone,
          status,
          gender,
          accepts_makeup_others,
          allow_availability_edit
          `
        )
        .order('first_name', { ascending: true });

      console.log('[INSTRUCTORS] query instructors result:', { error, rows: data?.length });

      if (error) throw error;

      const instructors = (data ?? []) as InstructorRow[];

      // 2) אוסף כל ה־uid הקיימים
      const uids = [
        ...new Set(
          instructors
            .map((i) => (i.uid || '').trim())
            .filter((uid) => !!uid)
        ),
      ];

      console.log('[INSTRUCTORS] collected uids:', uids);

      let usersMap = new Map<string, { email: string | null; phone: string | null }>();

      if (uids.length) {
        const dbcPublic = dbPublic();
        console.log('[INSTRUCTORS] querying public.users for uids');

        const { data: usersData, error: usersErr } = await dbcPublic
          .from('users')
          .select('uid, email, phone')
          .in('uid', uids);

        console.log('[INSTRUCTORS] public.users result:', { error: usersErr, rows: usersData?.length });

        if (usersErr) throw usersErr;

        (usersData ?? []).forEach((u: any) => {
          usersMap.set(u.uid, {
            email: u.email ?? null,
            phone: u.phone ?? null,
          });
        });
      }

      // 3) מחברים – public.users הוא מקור אמת, ואם אין – נשארים עם מה שב-instructors
      this.instructors = instructors.map((i) => {
        const key = (i.uid || '').trim();
        const user = key ? usersMap.get(key) : undefined;

        return {
          ...i,
          email: user?.email ?? i.email ?? null,
          phone: user?.phone ?? i.phone ?? null,
        };
      });

      console.log('[INSTRUCTORS] final instructors length:', this.instructors.length);

    } catch (e: any) {
      console.error('[INSTRUCTORS] loadInstructors error:', e);
      this.error = e?.message || 'Failed to fetch instructors.';
      this.instructors = [];
    } finally {
      this.isLoading = false;
      console.log('[INSTRUCTORS] loadInstructors() finished');
    }
  }

  // ======= מגירת פרטים =======

  async openDetails(id_number: string) {
    console.log('[INSTRUCTORS] openDetails for id_number:', id_number);
    this.selectedIdNumber = id_number?.trim();
    this.drawerInstructor = null;
    this.editMode = false;
    this.editModel = null;
    this.drawerAvailability = [];
    this.editAvailability = [];

    this.drawer.open();
    await this.loadDrawerData(this.selectedIdNumber!);
  }

  closeDetails() {
    console.log('[INSTRUCTORS] closeDetails');
    this.drawer.close();
    this.selectedIdNumber = null;
    this.drawerInstructor = null;
    this.editModel = null;
    this.editMode = false;
  }

  private async loadDrawerData(id_number: string) {
    this.drawerLoading = true;
    console.log('[INSTRUCTORS] loadDrawerData start for id_number:', id_number);

    try {
      const dbcTenant = dbTenant();

      const { data, error } = await dbcTenant
        .from('instructors')
        .select(`
          id_number,
          uid,
          first_name,
          last_name,
          phone,
          status,
          gender,
          address,
          license_id,
          about,
          education,
          ages,
          taught_child_genders,
          default_lesson_duration_min,
          min_age_years,
          max_age_years,
          certificate,
          photo_url,
          notify,
          accepts_makeup_others,
          allow_availability_edit,
          birth_date
        `)
        .eq('id_number', id_number)
        .maybeSingle();

      console.log('[INSTRUCTORS] loadDrawerData instructors query:', { error, hasData: !!data });

      if (error) throw error;
      if (!data) {
        this.drawerInstructor = null;
        this.editModel = null;
        this.drawerAvailability = [];
        this.editAvailability = [];
        return;
      }

      let ins = data as InstructorDetailsRow;

      // ---- אם יש uid – להשלים טלפון/מייל מ-public.users ----
      const uid = (ins.uid || '').trim();
      if (uid) {
        const dbcPublic = dbPublic();
        console.log('[INSTRUCTORS] loadDrawerData querying public.users for uid:', uid);

        const { data: user, error: userErr } = await dbcPublic
          .from('users')
          .select('email, phone')
          .eq('uid', uid)
          .maybeSingle();

        console.log('[INSTRUCTORS] loadDrawerData public.users result:', { error: userErr, hasUser: !!user });

        if (!userErr && user) {
          ins = {
            ...ins,
            email: user.email ?? ins.email ?? null,
            phone: user.phone ?? ins.phone ?? null,
          };
        }
      }

      // להציב את המדריך במגירה + מודל לעריכה
      this.drawerInstructor = ins;
      this.editMode = false;
      this.editModel = {
        ...ins,
        taught_child_genders: ins.taught_child_genders
          ? [...ins.taught_child_genders]
          : [],
      };

      // ---- לטעון לו"ז שבועי מהטבלה instructor_weekly_availability ----
      console.log('[INSTRUCTORS] loadDrawerData querying instructor_weekly_availability');

      const { data: avail, error: availErr } = await dbcTenant
        .from('instructor_weekly_availability')
        .select(
          'instructor_id_number, day_of_week, start_time, end_time, lesson_type_mode'
        )
        .eq('instructor_id_number', id_number)
        .order('day_of_week');

      console.log('[INSTRUCTORS] loadDrawerData availability result:', { error: availErr, rows: avail?.length });

      if (availErr) {
        console.error('availability error', availErr);
        this.drawerAvailability = [];
        this.editAvailability = [];
      } else {
        this.drawerAvailability = (avail ?? []) as InstructorWeeklyAvailabilityRow[];
        this.editAvailability = this.drawerAvailability.map(a => ({ ...a }));
      }
    } catch (e) {
      console.error('[INSTRUCTORS] loadDrawerData error:', e);
      this.drawerInstructor = null;
      this.editModel = null;
      this.drawerAvailability = [];
      this.editAvailability = [];
    } finally {
      this.drawerLoading = false;
      console.log('[INSTRUCTORS] loadDrawerData finished for id_number:', id_number);
    }
  }

  // ======= מצב עריכה במגירה =======

  startEditFromDrawer() {
    console.log('[INSTRUCTORS] startEditFromDrawer');
    if (!this.drawerInstructor) return;
    this.editMode = true;
    this.editModel = {
      ...this.drawerInstructor,
      taught_child_genders: this.drawerInstructor.taught_child_genders
        ? [...this.drawerInstructor.taught_child_genders]
        : [],
    };
  }

  private hasUnsavedChanges(): boolean {
    if (!this.drawerInstructor || !this.editModel) return false;
    const a = JSON.stringify({
      ...this.drawerInstructor,
      taught_child_genders: this.drawerInstructor.taught_child_genders || [],
    });
    const b = JSON.stringify({
      ...this.editModel,
      taught_child_genders: this.editModel.taught_child_genders || [],
    });
    return a !== b;
  }

  cancelEditFromDrawer() {
    console.log('[INSTRUCTORS] cancelEditFromDrawer');
    if (this.hasUnsavedChanges()) {
      const ok = confirm('את/ה בטוח/ה שאת/ה רוצה לבטל את השינויים?');
      if (!ok) return;
    }

    if (this.drawerInstructor) {
      this.editModel = {
        ...this.drawerInstructor,
        taught_child_genders: this.drawerInstructor.taught_child_genders
          ? [...this.drawerInstructor.taught_child_genders]
          : [],
      };
    } else {
      this.editModel = null;
    }

    this.editMode = false;
  }

  hasTaughtGender(g: string): boolean {
    return !!this.editModel?.taught_child_genders?.includes(g);
  }

  onTaughtGenderChange(g: string, checked: boolean) {
    if (!this.editModel) return;
    let arr = this.editModel.taught_child_genders || [];
    if (checked) {
      if (!arr.includes(g)) arr = [...arr, g];
    } else {
      arr = arr.filter((x) => x !== g);
    }
    this.editModel = { ...this.editModel, taught_child_genders: arr };
  }

  async saveEditFromDrawer() {
    if (!this.drawerInstructor || !this.editModel) return;

    const m = this.editModel;
    console.log('[INSTRUCTORS] saveEditFromDrawer called with model:', m);

    // ולידציה – שדות חובה
    const missing: string[] = [];
    if (!m.first_name?.trim()) missing.push('שם פרטי');
    if (!m.last_name?.trim()) missing.push('שם משפחה');
    if (!m.phone?.trim()) missing.push('טלפון');
    if (!m.email?.trim()) missing.push('אימייל');

    if (missing.length) {
      console.warn('[INSTRUCTORS] saveEditFromDrawer missing required fields:', missing);
      alert('שדות חובה חסרים: ' + missing.join(', '));
      return;
    }

    // טלפון ישראלי
    const rawPhone = (m.phone ?? '').trim();
    const phoneRe = /^0(5\d|[2-9])\d{7}$/;

    if (!rawPhone || !phoneRe.test(rawPhone)) {
      console.warn('[INSTRUCTORS] saveEditFromDrawer invalid phone:', rawPhone);
      alert('טלפון לא תקין. בדקי קידומת ומספר (10 ספרות).');
      return;
    }
    const phone = rawPhone;

    // אימייל
    const rawEmail = (m.email ?? '').trim().toLowerCase();
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!rawEmail || !emailRe.test(rawEmail)) {
      console.warn('[INSTRUCTORS] saveEditFromDrawer invalid email:', rawEmail);
      alert('אימייל לא תקין.');
      return;
    }
    const email = rawEmail;

    this.savingEdit = true;

    try {
      const dbcTenant = dbTenant();
      const updates: any = {
        first_name: m.first_name.trim(),
        last_name: m.last_name.trim(),
        phone,
        address: m.address?.trim() || null,
        license_id: m.license_id?.trim() || null,
        education: m.education?.trim() || null,
        about: m.about?.trim() || null,
        default_lesson_duration_min: m.default_lesson_duration_min ?? null,
        min_age_years: m.min_age_years ?? null,
        max_age_years: m.max_age_years ?? null,
        accepts_makeup_others: m.accepts_makeup_others ?? null,
        allow_availability_edit: m.allow_availability_edit ?? null,
        taught_child_genders: m.taught_child_genders ?? null,
      };

      console.log('[INSTRUCTORS] saveEditFromDrawer performing update:', updates);

      const { data, error } = await dbcTenant
        .from('instructors')
        .update(updates)
        .eq('id_number', this.drawerInstructor.id_number)
        .select('*')
        .maybeSingle();

      console.log('[INSTRUCTORS] saveEditFromDrawer update result:', { error, data });

      if (error) throw error;

      // עדכון users (מייל/טלפון) אם יש uid
      const uid = (this.drawerInstructor.uid || '').trim();
      if (uid) {
        await this.createUserInSupabase(uid, email,"instructor", phone);
      }

      const updated = (data as InstructorDetailsRow) || {
        ...this.drawerInstructor,
        ...updates,
      };

      // עדכון במגירה
      this.drawerInstructor = {
        ...this.drawerInstructor,
        ...updated,
        email,
        phone,
      };

      // להכין מודל לעריכה הבאה
      this.editModel = {
        ...this.drawerInstructor,
        taught_child_genders: this.drawerInstructor.taught_child_genders
          ? [...this.drawerInstructor.taught_child_genders]
          : [],
      };

      this.editMode = false;

      // ריענון טבלה
      console.log('[INSTRUCTORS] saveEditFromDrawer reloading instructors...');
      await this.loadInstructors();
    } catch (e: any) {
      console.error('[INSTRUCTORS] saveEditFromDrawer error:', e);
      alert(e?.message || 'שמירת פרטי המדריך נכשלה');
    } finally {
      this.savingEdit = false;
      console.log('[INSTRUCTORS] saveEditFromDrawer finished');
    }
  }

  // ======= דיאלוג הוספת מדריך =======

  openAddInstructorDialog() {
    console.log('[ADD INSTRUCTOR] openAddInstructorDialog called');
    const ref = this.dialog.open(AddInstructorDialogComponent, {
      width: '700px',
      maxWidth: '90vw',
      height: '90vh',
      panelClass: 'instructor-dialog',
      disableClose: true,
    });

    ref.afterClosed().subscribe(async (payload?: AddInstructorPayload | any) => {
      console.log('[ADD INSTRUCTOR] dialog closed, payload:', payload);
      if (!payload) {
        console.log('[ADD INSTRUCTOR] dialog closed with no payload (cancel)');
        return;
      }

      await ensureTenantContextReady();
      console.log('[ADD INSTRUCTOR] tenant context ready inside add dialog');

      const tenant_id = localStorage.getItem('selectedTenant') || '';
      const schema_name = localStorage.getItem('selectedSchema') || '';

      console.log('[ADD INSTRUCTOR] tenant info from localStorage:', {
        tenant_id,
        schema_name,
      });

      if (!tenant_id) {
        alert('לא נמצא tenant פעיל. התחברי מחדש או בחרי חווה פעילה.');
        return;
      }

      let uid = '';
      let tempPassword = '';

      try {
        console.log('[ADD INSTRUCTOR] checking if instructor exists by email:', payload.email);
        const exists = await this.checkIfInstructorExists(
          payload.email,
          tenant_id
        );
        console.log('[ADD INSTRUCTOR] checkIfInstructorExists result:', exists);

        if (exists.existsInTenant) {
          alert('מדריך עם המייל הזה כבר קיים בחווה הנוכחית.');
          return;
        }

        if (exists.existsInSystem && exists.uid) {
          console.log('[ADD INSTRUCTOR] user exists in system with uid, no new firebase user', exists.uid);
          uid = exists.uid;
          tempPassword = '';
        } else {
          console.log('[ADD INSTRUCTOR] creating firebase user via createUserIfNotExists');
          const res = await this.createUserService.createUserIfNotExists(
            payload.email
          );
          console.log('[ADD INSTRUCTOR] createUserIfNotExists result:', res);
          uid = res.uid;
          tempPassword = res.tempPassword;
        }
      } catch (e: any) {
        console.error('[ADD INSTRUCTOR] error in user creation/check:', e);
        const msg =
          this.createUserService.errorMessage ||
          e?.message ||
          'שגיאה ביצירת / בדיקת המשתמש.';
        alert(msg);
        return;
      }

      payload.uid = uid;
      payload.password = tempPassword || '';

      const body = {
        uid: (payload.uid ?? '').trim(),
        first_name: (payload.first_name ?? '').trim(),
        last_name: (payload.last_name ?? '').trim(),
        email: (payload.email ?? '').trim().toLowerCase(),
        phone: (payload.phone ?? '').trim(),
        id_number: (payload.id_number ?? '').trim(),
        address: (payload.address ?? '').trim(),
        gender: (payload.gender ?? '').trim(),
        license_id: (payload.license_id ?? '').trim(),
        education: (payload.education ?? '').trim(),
        about: (payload.about ?? '').trim(),
        tenant_id,
        schema_name,
      };

      console.log('[ADD INSTRUCTOR] built body for insert:', body);

      const missing = ['first_name', 'last_name', 'email', 'phone', 'id_number'].filter(
        (k) => !(body as any)[k]
      );

      if (missing.length) {
        console.warn('[ADD INSTRUCTOR] missing required fields:', missing);
        alert('שדות חובה חסרים: ' + missing.join(', '));
        return;
      }

      try {
        // users
        await this.createUserInSupabase(body.uid, body.email, "instructor", body.phone);

        console.log('[ADD INSTRUCTOR] upsert public.tenant_users', body.tenant_id, body.uid);
        await this.createTenantUserInSupabase({
          tenant_id: body.tenant_id,
          uid: body.uid,
        });
        console.log('[ADD INSTRUCTOR] DONE tenant_users');

        console.log('[ADD INSTRUCTOR] insert tenant.instructors', {
          uid: body.uid,
          first_name: body.first_name,
          last_name: body.last_name,
          phone: body.phone,
          id_number: body.id_number,
        });
        const instructorRow = await this.createInstructorInSupabase({
          uid: body.uid,
          first_name: body.first_name,
          last_name: body.last_name,
          email: body.email,
          phone: body.phone,
          id_number: body.id_number,
          address: body.address,
          gender: body.gender,
          license_id: body.license_id,
          education: body.education,
          about: body.about,
        });
        console.log('[ADD INSTRUCTOR] DONE instructors insert:', instructorRow);

        console.log('[ADD INSTRUCTOR] reloading instructors list...');
        await this.loadInstructors();
        console.log('[ADD INSTRUCTOR] DONE loadInstructors, count =', this.instructors.length);

        // ✅ מייל למדריך/ה – כאן יש לך גישה ל-body ול-payload
        const fullName = `${body.first_name} ${body.last_name}`.trim();
        const subject = 'נפתחה עבורך גישה למערכת';
        const html = `
          <div dir="rtl">
            <p>שלום ${fullName},</p>
            <p>נוספת למערכת כמדריך/ה בחווה.</p>
            ${payload.password ? `<p><b>סיסמה זמנית:</b> ${payload.password}</p>` : ''}
            <p>התחברות עם האימייל הזה: <b>${body.email}</b></p>
          </div>
        `;

        this.mailService
          .sendEmail({
            tenantSchema: body.schema_name, // זה ה־selectedSchema שלך
            to: body.email,
            subject,
            html,
          })
          .catch((err) => console.error('send instructor email failed', err));

        alert('מדריך נוצר/שויך בהצלחה');
      } catch (e: any) {
        console.error('[ADD INSTRUCTOR] ERROR:', e);
        alert(e?.message ?? 'שגיאה - המערכת לא הצליחה להוסיף מדריך');
      }
    });
  }

  // ======= Helpers =======

  async checkIfInstructorExists(email: string, tenant_id: string) {
    console.log('[ADD INSTRUCTOR] checkIfInstructorExists start:', { email, tenant_id });

    const { data: user, error: userErr } = await dbPublic()
      .from('users')
      .select('uid')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    console.log('[ADD INSTRUCTOR] checkIfInstructorExists users result:', { user, userErr });

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

    console.log('[ADD INSTRUCTOR] checkIfInstructorExists tenant_users result:', { tenantUser, tenantErr });

    if (tenantErr) throw tenantErr;

    const existsInTenant =
      !!tenantUser && tenantUser.role_in_tenant === 'instructor';

    const result = {
      existsInSystem: true,
      existsInTenant,
      uid: user.uid,
    };

    console.log('[ADD INSTRUCTOR] checkIfInstructorExists final result:', result);
    return result;
  }

  private async getInstructorRoleId(): Promise<number> {
    const dbcTenant = dbTenant();

    console.log('[ADD INSTRUCTOR] getInstructorRoleId querying role table for "instructors"');
    const { data, error } = await dbcTenant
      .from('role')
      .select('id')
      .eq('table', 'instructors')
      .maybeSingle();

    console.log('[ADD INSTRUCTOR] getInstructorRoleId result:', { data, error });

    if (error || !data?.id) {
      console.error('getInstructorRoleId error', error, data);
      throw new Error('לא הצלחתי למצוא role_id לתפקיד מדריך בטננט הנוכחי');
    }

    return data.id as number;
  }

  private async createUserInSupabase(
    uid: string,
    email: string,
    role: string,
    phone?: string | null
  ): Promise<void> {
    const dbcPublic = dbPublic();

    const row = {
      uid: (uid || '').trim(),
      email: (email || '').trim(),
      role: (role || '').trim(),
      phone: (phone || '').trim() || null,
    };

    console.log('[ADD INSTRUCTOR] createUserInSupabase upsert row:', row);

    const { error } = await dbcPublic
      .from('users')
      .upsert(row, { onConflict: 'uid' });

    if (error) {
      console.error('[ADD INSTRUCTOR] users upsert failed:', error);
      throw new Error(`users upsert failed: ${error.message}`);
    }

    console.log('[ADD INSTRUCTOR] createUserInSupabase success');
  }

  private async createTenantUserInSupabase(body: {
    tenant_id: string;
    uid: string;
  }): Promise<void> {
    const dbcPublic = dbPublic();
    const instructorRoleId = await this.getInstructorRoleId();

    console.log('[ADD INSTRUCTOR] createTenantUserInSupabase body:', body, 'roleId:', instructorRoleId);

    const { error } = await dbcPublic
      .from('tenant_users')
      .upsert(
        {
          tenant_id: body.tenant_id,
          uid: body.uid,
          role_in_tenant: 'instructor',
          role_id: instructorRoleId,
          is_active: true,
        },
        {
          onConflict: 'tenant_id,uid,role_in_tenant',
        }
      );

    if (error) {
      console.error('[ADD INSTRUCTOR] tenant_users upsert failed:', error);
      throw new Error(`tenant_users upsert failed: ${error.message}`);
    }

    console.log('[ADD INSTRUCTOR] createTenantUserInSupabase success');
  }

  private async createInstructorInSupabase(body: {
    uid: string;
    first_name: string;
    last_name: string;
    email?: string;
    phone?: string | null;
    id_number?: string | null;
    address?: string | null;
    gender?: string | null;
    license_id?: string | null;
    education?: string | null;
    about?: string | null;
  }) {
    const dbcTenant = dbTenant();

    console.log('[ADD INSTRUCTOR] createInstructorInSupabase INSERT body:', body);

    const { data, error } = await dbcTenant
      .from('instructors')
      .insert({
        uid: body.uid,
        first_name: body.first_name,
        last_name: body.last_name,
        phone: body.phone ?? null,
        id_number: body.id_number ?? null,
        address: body.address ?? null,
        gender: body.gender ?? null,
        license_id: body.license_id ?? null,
        education: body.education ?? null,
        about: body.about ?? null,
        status: 'Active',
        accepts_makeup_others: true,
        allow_availability_edit: true,
      })
      .select('*')
      .single();

    console.log('[ADD INSTRUCTOR] createInstructorInSupabase result:', { error, data });

    if (error) {
      console.error('[ADD INSTRUCTOR] instructors insert failed:', error);
      throw new Error(`instructors insert failed: ${error.message}`);
    }

    return data;
  }
}
