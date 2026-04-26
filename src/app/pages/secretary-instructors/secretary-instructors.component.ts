import { Component, OnInit, ViewChild, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { UiDialogService } from '../../services/ui-dialog.service';
import { supabase } from '../../services/supabaseClient.service';
import { MatSidenav, MatSidenavModule } from '@angular/material/sidenav';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MailService } from '../../services/mail.service';
import { InstructorAvailabilityDialogComponent } from './instructor-availability-dialog/instructor-availability-dialog.component';
import { InstructorDeactivationImpactDialogComponent } from './instructor-deactivation-impact-dialog/instructor-deactivation-impact-dialog.component';
import {
  ensureTenantContextReady,
  dbPublic,
  dbTenant,
  getCurrentFarmMetaSync,
} from '../../services/legacy-compat';
import { signal } from '@angular/core';

import {
  AddInstructorDialogComponent,
  AddInstructorPayload,
} from './add-instructor-dialog/add-instructor-dialog.component';

import { CreateUserService } from '../../services/create-user.service';
import { TaughtChildGender } from '../../Types/detailes.model';
import { max } from 'rxjs';

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
    color_hex?: string | null;
};

interface InstructorWeeklyAvailabilityRow {
  instructor_id_number: string;
  day_of_week: number;
  start_time: string | null;
  end_time: string | null;
  lesson_type_mode: string | null;
  lesson_ridding_type: string | null;
}

interface InstructorDetailsRow extends InstructorRow {
  non_therapy_riding_types?: string[] | null;

  address?: string | null;
  license_id?: string | null;
  about?: string | null;
  education?: string | null;
  taught_child_genders?: string[] | null; // ["זכר","נקבה"]
  default_lesson_duration_min?: TaughtChildGender | null;
  min_age_years_male?: number | null;
  max_age_years_male?: number | null;
  min_age_years_female?: number | null;
  max_age_years_female?: number | null;
  certificate?: string | null;
  photo_url?: string | null;
  notify?: any | null; // jsonb הגדרות התראות
color_hex?: string | null;
  birth_date?: string | null;        // מגיע מ-Supabase כ-'YYYY-MM-DD'
}
interface InstructorUnavailabilityRow {
  id: string;
  instructor_id_number: string;
  from_ts: string;
  to_ts: string;
  reason?: string | null;
  all_day: boolean;
  category?: string | null;
  sick_note_file_path?: string | null;
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
  ridingTypes: { id: string; name: string }[] = [];

  // לו"ז שבועי במגירה (מצב תצוגה)
  drawerAvailability: InstructorWeeklyAvailabilityRow[] = [];

  // לו"ז שבועי במצב עריכה
  editAvailability: InstructorWeeklyAvailabilityRow[] = [];
drawerUnavailability: InstructorUnavailabilityRow[] = [];
  dayOfWeekToLabel(d?: number | null): string {
    switch (d) {
      case 1: return 'ראשון';
      case 2: return 'שני';
      case 3: return 'שלישי';
      case 4: return 'רביעי';
      case 5: return 'חמישי';
      case 6: return 'שישי';
      case 7: return 'שבת';
      default: return '—';
    }
  }

  ridingTypeName(id: string | null): string {
    if (!id) return '—';
    const rt = this.ridingTypes.find(r => r.id === id);
    return rt ? rt.name : '—';
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
bulkBusy = signal(false);
bulkBusyMessage = signal<string>('');
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
    private ui: UiDialogService,
    private dialog: MatDialog,
    private createUserService: CreateUserService,
    private mailService: MailService
  ) {}

  // =========================
  // ✅ ולידציות/סניטציה נקודתיות לשדות שביקשת
  // =========================

  /** שם פרטי/משפחה: עברית/אנגלית + רווח/גרש/מקף, מקס 40 (כמו ב-HTML) */
 sanitizeName(v: any): string {
  let s = (v ?? '').toString();
  s = s.replace(/[^A-Za-z\u0590-\u05FF\s'’\-]/g, '');
  s = s.replace(/\s{2,}/g, ' ').trim();
  return s.slice(0, 25);
}


  /** השכלה: טקסט חופשי "סביר", מקס 80 (כמו ב-HTML) */
  sanitizeEducation(v: any): string {
    let s = (v ?? '').toString();
    s = s.replace(/\s{2,}/g, ' ').trim();
    return s.slice(0, 80);
  }


  /** כתובת: טקסט חופשי, אבל בלי תווים "מוזרים", מקס 120 (כמו ב-HTML) */
sanitizeAddress(v: any): string {
  let s = (v ?? '').toString();
  s = s.replace(/[^A-Za-z\u0590-\u05FF0-9\s.,'’"\-\/]/g, '');
  s = s.replace(/\s{2,}/g, ' ').trim();
  return s.slice(0, 60);
}

  /** רישיון מדריך: מותר אותיות/מספרים/מקף/סלאש/רווח, מקס 30 (כמו ב-HTML) */
  sanitizeLicense(v: any): string {
    let s = (v ?? '').toString();
    s = s.replace(/[^A-Za-z\u0590-\u05FF0-9\s\-\/]/g, '');
    s = s.replace(/\s{2,}/g, ' ').trim();
    return s.slice(0, 30);
  }
  sanitizeAbout(v: any): string {
  let s = (v ?? '').toString();
  s = s.replace(/\s{2,}/g, ' ').trim();
  return s.slice(0, 200);
}

  openAvailabilityDialog() {
    const ins = this.drawerInstructor;
    if (!ins?.id_number) return;

    this.dialog.open(InstructorAvailabilityDialogComponent, {
      width: '760px',
      maxWidth: '95vw',
      height: '90vh',
      panelClass: 'availability-dialog',
      data: {
        instructorIdNumber: ins.id_number,
        instructorName: `${ins.first_name ?? ''} ${ins.last_name ?? ''}`.trim(),
      },
    });
  }

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
    try {
      await this.loadRidingTypes();

      await ensureTenantContextReady();
      await this.loadInstructors();
    } catch (e: any) {
      this.error = e?.message || 'Failed to load instructors';
    } finally {
      this.isLoading = false;
    }
  }

  // ✅ אפשרויות סטטוס (ערך שנשמר בדאטאבייס + תצוגה)
  statusOptions = [
    { value: 'Active', label: 'פעיל' },
    { value: 'Inactive', label: 'לא פעיל' },
  ];

  private normalizeStatus(input: string | null | undefined): 'Active' | 'Inactive' {
    const s = (input ?? '').trim().toLowerCase();

    if (s === 'active' || s === 'פעיל' || s === 'פעילה') return 'Active';
    if (s === 'inactive' || s === 'לא פעיל' || s === 'לא פעילה') return 'Inactive';

    // ברירת מחדל (כדי לא לשמור "טקסט חופשי" לא צפוי)
    return 'Active';
  }

  statusLabel(s?: string | null): string {
    if (!s) return '—';
    const v = this.normalizeStatus(s);
    return v === 'Active' ? 'פעיל' : 'לא פעיל';
  }

  getNotifyLabel(notify: any): string {
    if (!notify) return '—';

    const labels: string[] = [];
    if (notify.email) labels.push('דוא״ל');
    if (notify.sms) labels.push('SMS');
    if (notify.whatsapp) labels.push('WhatsApp');
    if (notify.voice) labels.push('קולית');

    return labels.length ? labels.join(', ') : '—';
  }

  private async loadInstructors() {
    this.isLoading = true;
    this.error = null;

    try {
      const dbcTenant = dbTenant();

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

      let usersMap = new Map<string, { email: string | null; phone: string | null }>();

      if (uids.length) {
        const dbcPublic = dbPublic();

        const { data: usersData, error: usersErr } = await dbcPublic
          .from('users')
          .select('uid, email, phone')
          .in('uid', uids);

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
          phone: i.phone ?? user?.phone ?? null,
        };
      });

    } catch (e: any) {
      this.error = e?.message || 'Failed to fetch instructors.';
      this.instructors = [];
    } finally {
      this.isLoading = false;
    }
  }

  // ======= מגירת פרטים =======
  async loadRidingTypes() {

    const dbc = dbTenant();

    const { data, error } = await dbc
      .from('riding_types')
      .select('id, name, code')
      .neq('code', 'break');

    if (error) {
      console.error('failed loading riding types', error);
      return;
    }

    this.ridingTypes = data ?? [];
  }

  async openDetails(id_number: string) {
    if (!this.ridingTypes.length) {
      await this.loadRidingTypes();
    }

    this.selectedIdNumber = id_number?.trim();
    this.drawerInstructor = null;
    this.editMode = false;
    this.editModel = null;
    this.drawerAvailability = [];
    this.editAvailability = [];
    this.drawerUnavailability = [];

    this.drawer.open();
    await this.loadDrawerData(this.selectedIdNumber!);
  }

  closeDetails() {
    this.drawer.close();
    this.selectedIdNumber = null;
    this.drawerInstructor = null;
    this.editModel = null;
    this.editMode = false;
  }

  getNonTherapyRidingTypesLabel(ins: InstructorDetailsRow | null): string {
    if (!ins?.non_therapy_riding_types?.length) {
      return '—';
    }

    return ins.non_therapy_riding_types
      .map(id => this.ridingTypeName(id))
      .join(', ');
  }

  private async loadDrawerData(id_number: string) {
    this.drawerLoading = true;

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
          taught_child_genders,
          default_lesson_duration_min,
          min_age_years_male,
          max_age_years_male,
          min_age_years_female,
          max_age_years_female,
          certificate,
          photo_url,
          notify,
          accepts_makeup_others,
          allow_availability_edit,
          non_therapy_riding_types,
          birth_date,
          color_hex
        `)
        .eq('id_number', id_number)
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        this.drawerInstructor = null;
        this.editModel = null;
        this.drawerAvailability = [];
        this.editAvailability = [];
        this.drawerUnavailability = [];
        return;
      }

      let ins = data as InstructorDetailsRow;

      // ---- אם יש uid – להשלים טלפון/מייל מ-public.users ----
      const uid = (ins.uid || '').trim();
      if (uid) {
        const dbcPublic = dbPublic();

        const { data: user, error: userErr } = await dbcPublic
          .from('users')
          .select('email, phone')
          .eq('uid', uid)
          .maybeSingle();

        if (!userErr && user) {
          ins = {
            ...ins,
            email: user.email ?? ins.email ?? null,
            phone: ins.phone || user.phone || null,
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
      const { data: avail, error: availErr } = await dbcTenant
        .from('instructor_weekly_availability')
        .select(`
          instructor_id_number,
          day_of_week,
          start_time,
          end_time,
          lesson_ridding_type,
          lesson_type_mode
        `)
        .eq('instructor_id_number', id_number)
        .order('day_of_week');

      if (availErr) {
        this.drawerAvailability = [];
        this.editAvailability = [];
        this.drawerUnavailability = [];
      } else {
        this.drawerAvailability = (avail ?? []) as InstructorWeeklyAvailabilityRow[];
        this.editAvailability = this.drawerAvailability.map(a => ({ ...a }));
      }
      const { data: unavailability, error: unErr } = await dbcTenant
  .from('instructor_unavailability')
  .select(`
    id,
    instructor_id_number,
    from_ts,
    to_ts,
    reason,
    all_day,
    category,
    sick_note_file_path
  `)
  .eq('instructor_id_number', id_number)
  .order('from_ts', { ascending: false });

if (unErr) {
  console.error('failed loading instructor unavailability', unErr);
  this.drawerUnavailability = [];
} else {
  this.drawerUnavailability = (unavailability ?? []) as InstructorUnavailabilityRow[];
}
    } catch (e: any) {
      console.error('[INSTRUCTORS] loadDrawerData failed:', e);
      this.error = e?.message || 'טעינת פרטי מדריך נכשלה';
      this.drawerInstructor = null;
      this.drawerUnavailability = [];
      this.editModel = null;
      this.drawerAvailability = [];
      this.editAvailability = [];
    } finally {
      this.drawerLoading = false;
    }
  }

  // ======= מצב עריכה במגירה =======

  async startEditFromDrawer() {
    if (!this.drawerInstructor) return;

    if (!this.ridingTypes.length) {
      await this.loadRidingTypes();
    }

    const ins = this.drawerInstructor;

    this.editMode = true;
    this.editModel = {
      ...ins,
      notify: ins.notify ?? {
        email: false,
        sms: false,
        whatsapp: false,
        voice: false,
      },
      taught_child_genders: ins.taught_child_genders
        ? [...ins.taught_child_genders]
        : [],
      non_therapy_riding_types: ins.non_therapy_riding_types
        ? [...ins.non_therapy_riding_types]
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

  async cancelEditFromDrawer() {
    if (this.hasUnsavedChanges()) {
      const ok = await this.ui.confirm({
        title: 'אישור ביטול',
        message: 'את בטוחה שתרצי לבטל את השינויים?',
        okText: 'כן, לבטל',
        cancelText: 'לא',
        showCancel: true,
      });
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

      // ✅ אם ביטלו מגדר — מאפסים את הטווח שלו
      if (g === 'זכר') {
        this.editModel = {
          ...this.editModel,
          taught_child_genders: arr,
          min_age_years_male: null,
          max_age_years_male: null,
        };
        return;
      }
      if (g === 'נקבה') {
        this.editModel = {
          ...this.editModel,
          taught_child_genders: arr,
          min_age_years_female: null,
          max_age_years_female: null,
        };
        return;
      }
    }

    this.editModel = { ...this.editModel, taught_child_genders: arr };
  }

  private toIntOrNull(v: any): number | null {
    if (v === '' || v === undefined || v === null) return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    const i = Math.trunc(n);
    return i < 0 ? null : i;
  }

  private validateGenderAges(m: InstructorDetailsRow): string | null {
    const teachesMale = (m.taught_child_genders ?? []).includes('זכר');
    const teachesFemale = (m.taught_child_genders ?? []).includes('נקבה');

    const mnM = this.toIntOrNull(m.min_age_years_male);
    const mxM = this.toIntOrNull(m.max_age_years_male);
    const mnF = this.toIntOrNull(m.min_age_years_female);
    const mxF = this.toIntOrNull(m.max_age_years_female);

    // אם לא מלמד מגדר מסוים — מתעלמים (וגם נשמור null)
    if (teachesMale) {
      if (mnM !== null && mxM !== null && mnM > mxM) return 'טווח גילאים לבנים לא תקין (מגיל גדול מעד גיל).';
    }
    if (teachesFemale) {
      if (mnF !== null && mxF !== null && mnF > mxF) return 'טווח גילאים לבנות לא תקין (מגיל גדול מעד גיל).';
    }

    return null;
  }

  /** אופציונלי: לשמור גם שדות legacy min_age_years/max_age_years כדי לא לשבור קוד ישן */
  private computeLegacyMinMax(m: InstructorDetailsRow): { min_age_years: number | null; max_age_years: number | null } {
    const teachesMale = (m.taught_child_genders ?? []).includes('זכר');
    const teachesFemale = (m.taught_child_genders ?? []).includes('נקבה');

    const mins: number[] = [];
    const maxs: number[] = [];

    const min_age_years_male = teachesMale ? this.toIntOrNull(m.min_age_years_male) : null;
    const max_age_years_male = teachesMale ? this.toIntOrNull(m.max_age_years_male) : null;
    const min_age_years_female = teachesFemale ? this.toIntOrNull(m.min_age_years_female) : null;
    const max_age_years_female = teachesFemale ? this.toIntOrNull(m.max_age_years_female) : null;

    if (teachesMale) {
      if (min_age_years_male !== null) mins.push(min_age_years_male);
      if (max_age_years_male !== null) maxs.push(max_age_years_male);
    }
    if (teachesFemale) {
      if (min_age_years_female !== null) mins.push(min_age_years_female);
      if (max_age_years_female !== null) maxs.push(max_age_years_female);
    }

    return {
      min_age_years: mins.length ? Math.min(...mins) : null,
      max_age_years: maxs.length ? Math.max(...maxs) : null,
    };
  }

  async saveEditFromDrawer() {
  if (!this.drawerInstructor || !this.editModel) return;
this.bulkBusy.set(true);
this.bulkBusyMessage.set('הנתונים נבדקים...');
  this.editModel = {
    ...this.editModel,
    first_name: this.sanitizeName(this.editModel.first_name),
    last_name: this.sanitizeName(this.editModel.last_name),
    education: this.sanitizeEducation(this.editModel.education),
    address: this.sanitizeAddress(this.editModel.address),
    license_id: this.sanitizeLicense(this.editModel.license_id),
  };

  const m = this.editModel;

  const missing: string[] = [];
  if (!m.first_name?.trim()) missing.push('שם פרטי');
  if (!m.last_name?.trim()) missing.push('שם משפחה');
  if (!m.phone?.trim()) missing.push('טלפון');
  if (!m.email?.trim()) missing.push('אימייל');

  const ageErr = this.validateGenderAges(m);
  if (ageErr) {
    await this.ui.alert(ageErr, 'שגיאת טווח גילאים');
    return;
  }

  if (missing.length) {
    await this.ui.alert('שדות חובה חסרים: ' + missing.join(', '), 'חסרים פרטים');
    return;
  }

  const rawPhone = (m.phone ?? '').trim();
  const phoneRe = /^0(5\d|[2-9])\d{7}$/;
  if (!rawPhone || !phoneRe.test(rawPhone)) {
    await this.ui.alert('טלפון לא תקין. בדקי קידומת ומספר (10 ספרות).', 'שגיאת טלפון');
    return;
  }
  const phone = rawPhone;

  const rawEmail = (m.email ?? '').trim().toLowerCase();
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!rawEmail || !emailRe.test(rawEmail)) {
    await this.ui.alert('אימייל לא תקין.', 'שגיאת אימייל');
    return;
  }
  const email = rawEmail;

  this.savingEdit = true;

  try {
    const dbcTenant = dbTenant();

    const updates: any = {
      non_therapy_riding_types: m.non_therapy_riding_types ?? [],
      first_name: m.first_name.trim(),
      last_name: m.last_name.trim(),
      phone,
      status: this.normalizeStatus(m.status),
      address: m.address?.trim() || null,
      license_id: m.license_id?.trim() || null,
      education: m.education?.trim() || null,
      about: m.about ? this.sanitizeAbout(m.about) : null,
      birth_date: m.birth_date ?? null,
      notify: m.notify ?? {
        email: false,
        sms: false,
        whatsapp: false,
        voice: false,
      },
      default_lesson_duration_min: m.default_lesson_duration_min ?? null,
      min_age_years_male: m.min_age_years_male ?? null,
      max_age_years_male: m.max_age_years_male ?? null,
      min_age_years_female: m.min_age_years_female ?? null,
      max_age_years_female: m.max_age_years_female ?? null,
      accepts_makeup_others: m.accepts_makeup_others ?? null,
      allow_availability_edit: m.allow_availability_edit ?? null,
      taught_child_genders: m.taught_child_genders ?? null,
      color_hex: m.color_hex || '#4dabf7',
    };

    const oldStatus = this.normalizeStatus(this.drawerInstructor.status);
    const newStatus = this.normalizeStatus(m.status);
    const isBecomingInactive = oldStatus === 'Active' && newStatus === 'Inactive';

    const tenantSchema = this.getTenantSchemaOrThrow();
    const tenantId = this.getTenantIdOrThrow();
    const fromDate = new Date().toISOString().slice(0, 10);
if (isBecomingInactive) {
  this.bulkBusyMessage.set('נבדקת השפעת השינוי על שיעורים עתידיים...');}
  if (isBecomingInactive) {
      const preview = await this.callPreviewInstructorDeactivationImpact({
        tenantSchema,
        instructorIdNumber: this.drawerInstructor.id_number,
        fromDate,
      });

      const items = Array.isArray(preview?.items) ? preview.items : [];
      let confirmed = true;

      if (items.length > 0) {
        this.bulkBusy.set(false);
this.bulkBusyMessage.set('');
        const ref = this.dialog.open(InstructorDeactivationImpactDialogComponent, {
          width: '900px',
          maxWidth: '96vw',
          disableClose: true,
          data: {
            instructorName:
              `${this.drawerInstructor.first_name ?? ''} ${this.drawerInstructor.last_name ?? ''}`.trim(),
            impactCount: preview?.impactCount ?? items.length,
            items,
          },
        });

        confirmed = !!(await ref.afterClosed().toPromise());
      } else {
        confirmed = await this.ui.confirm({
          title: 'אישור שינוי סטטוס',
          message: 'לא נמצאו שיעורים עתידיים למדריך/ה זה/זו. האם להפוך ללא פעיל/ה?',
          okText: 'כן',
          cancelText: 'לא',
          showCancel: true,
        });
      }

      if (!confirmed) {
        return;
      }
this.bulkBusy.set(true);
this.bulkBusyMessage.set('מעדכנים את המדריך ומבטלים שיעורים...');
      // קודם נעדכן את שאר השדות, בלי status
      const regularUpdates = { ...updates };
      delete regularUpdates.status;

      const { data: partialUpdated, error: partialErr } = await dbcTenant
        .from('instructors')
        .update(regularUpdates)
        .eq('id_number', this.drawerInstructor.id_number)
        .select('*')
        .maybeSingle();

      if (partialErr) throw partialErr;

      // users
      const uid = (this.drawerInstructor.uid || '').trim();
      if (uid) {
        await this.createUserInSupabase(uid, email, 'instructor', phone);
      }

      // עכשיו פונקציית ענן תעדכן ל-Inactive + תבטל שיעורים + תשלח מיילים
      const deactivationRes = await this.callDeactivateInstructorAndCancelFutureLessons({
        tenantSchema,
        tenantId,
        instructorIdNumber: this.drawerInstructor.id_number,
        fromDate,
        decisionNote: 'בוטל עקב הפיכת מדריך ללא פעיל',
      });

      const updated = (partialUpdated as InstructorDetailsRow) || {
        ...this.drawerInstructor,
        ...regularUpdates,
      };

      this.drawerInstructor = {
        ...this.drawerInstructor,
        ...updated,
        status: 'Inactive',
        email,
        phone,
      };

      this.editModel = {
        ...this.drawerInstructor,
        status: 'Inactive',
        taught_child_genders: this.drawerInstructor.taught_child_genders
          ? [...this.drawerInstructor.taught_child_genders]
          : [],
      };

      this.editMode = false;
      await this.loadInstructors();

      if (deactivationRes?.warning) {
        await this.ui.alert(
          `המדריך/ה עודכן/ה ללא פעיל/ה. ${deactivationRes.warning}`,
          'הפעולה הושלמה עם אזהרות'
        );
      }

      return;
    }

    // זרימה רגילה - אם לא הופכים ללא פעיל
    const { data, error } = await dbcTenant
      .from('instructors')
      .update(updates)
      .eq('id_number', this.drawerInstructor.id_number)
      .select('*')
      .maybeSingle();

    if (error) throw error;

    const uid = (this.drawerInstructor.uid || '').trim();
    if (uid) {
      await this.createUserInSupabase(uid, email, 'instructor', phone);
    }

    const updated = (data as InstructorDetailsRow) || {
      ...this.drawerInstructor,
      ...updates,
    };

    this.drawerInstructor = {
      ...this.drawerInstructor,
      ...updated,
      email,
      phone,
    };

    this.editModel = {
      ...this.drawerInstructor,
      status: this.normalizeStatus(this.drawerInstructor.status),
      taught_child_genders: this.drawerInstructor.taught_child_genders
        ? [...this.drawerInstructor.taught_child_genders]
        : [],
    };

    this.editMode = false;
    await this.loadInstructors();
  } catch (e: any) {
    await this.ui.alert(e?.message || 'שמירת פרטי המדריך נכשלה', 'שמירה נכשלה');
  } finally {
    this.savingEdit = false;
    this.bulkBusy.set(false);
    this.bulkBusyMessage.set('');
  }
}
  // ======= דיאלוג הוספת מדריך =======

  openAddInstructorDialog() {
    const ref = this.dialog.open(AddInstructorDialogComponent, {
      width: '700px',
      maxWidth: '90vw',
      height: '90vh',
      panelClass: 'instructor-dialog',
      disableClose: true,
    });

    ref.afterClosed().subscribe(async (payload?: AddInstructorPayload | any) => {
      if (!payload) {
        return;
      }

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
        const exists = await this.checkIfInstructorExists(
          payload.email,
          tenant_id
        );

        if (exists.existsInTenant) {
          await this.ui.alert('מדריך עם המייל הזה כבר קיים בחווה הנוכחית.', 'שגיאה');
          return;
        }

        if (exists.existsInSystem && exists.uid) {
          uid = exists.uid;
          tempPassword = '';
        } else {
          const res = await this.createUserService.createUserIfNotExists(
            payload.email
          );
          uid = res.uid;
          tempPassword = res.tempPassword;
        }
      } catch (e: any) {
        const msg =
          this.createUserService.errorMessage ||
          e?.message ||
          'שגיאה ביצירת / בדיקת המשתמש.';
        await this.ui.alert(msg, 'שגיאה');
        return;
      }

      payload.uid = uid;
      payload.password = tempPassword || '';

      // ✅ סניטציה נקודתית גם בהוספה (כדי למנוע הכנסת זבל ל-DB)
      const body = {
        uid: (payload.uid ?? '').trim(),
        first_name: this.sanitizeName(payload.first_name),
        last_name: this.sanitizeName(payload.last_name),
        email: (payload.email ?? '').trim().toLowerCase(),
        phone: (payload.phone ?? '').trim(),
        id_number: (payload.id_number ?? '').trim(),
        address: this.sanitizeAddress(payload.address),
        gender: (payload.gender ?? '').trim(),
        license_id: this.sanitizeLicense(payload.license_id),
        education: this.sanitizeEducation(payload.education),
        about: (payload.about ?? '').toString().trim(),
        tenant_id,
        schema_name,
      };

      const missing = ['first_name', 'last_name', 'email', 'phone', 'id_number'].filter(
        (k) => !(body as any)[k]
      );

      if (missing.length) {
        console.warn('[ADD INSTRUCTOR] missing required fields:', missing);
        await this.ui.alert('שדות חובה חסרים: ' + missing.join(', '), 'חסרים פרטים');
        return;
      }
      

      // ✅ ולידציה מייל/טלפון גם בהוספה (כמו בעריכה)
      const phoneRe = /^0(5\d|[2-9])\d{7}$/;
      if (!body.phone || !phoneRe.test(body.phone)) {
        await this.ui.alert('טלפון לא תקין. בדקי קידומת ומספר (10 ספרות).', 'שגיאת טלפון');
        return;
      }

      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!body.email || !emailRe.test(body.email)) {
        await this.ui.alert('אימייל לא תקין.', 'שגיאת אימייל');
        return;
      }

      try {
        // users
        await this.createUserInSupabase(body.uid, body.email, 'instructor', body.phone);

        await this.createTenantUserInSupabase({
          tenant_id: body.tenant_id,
          uid: body.uid,
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

        await this.loadInstructors();

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

        try {
          const tenantSchema = this.getTenantSchemaOrThrow();
          await this.mailService.sendEmailGmail({
            tenantSchema: tenantSchema,
            to: [body.email],
            subject,
            html,
            text: `שלום ${fullName},
נוספת למערכת כמדריך/ה בחווה .
${payload.password ? `סיסמה זמנית: ${payload.password}\n` : ''}התחברות עם האימייל הזה: ${body.email}`,
          });
        } catch (err) {
        }

        await this.ui.alert('מדריך נוצר/שויך בהצלחה', 'הצלחה');

      } catch (e: any) {
        await this.ui.alert(e?.message ?? 'שגיאה - המערכת לא הצליחה להוסיף מדריך', 'שגיאה');
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

  // ======= Helpers =======
  onRidingTypeChange(id: string, checked: boolean) {
    if (!this.editModel) return;

    let arr = this.editModel.non_therapy_riding_types || [];

    if (checked) {
      if (!arr.includes(id)) {
        arr = [...arr, id];
      }
    } else {
      arr = arr.filter(x => x !== id);
    }

    this.editModel = {
      ...this.editModel,
      non_therapy_riding_types: arr,
    };
  }

  async checkIfInstructorExists(email: string, tenant_id: string) {
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

    const existsInTenant =
      !!tenantUser && tenantUser.role_in_tenant === 'instructor';

    const result = {
      existsInSystem: true,
      existsInTenant,
      uid: user.uid,
    };

    return result;
  }

  private async getInstructorRoleId(): Promise<number> {
    const dbcTenant = dbTenant();

    const { data, error } = await dbcTenant
      .from('role')
      .select('id')
      .eq('table', 'instructors')
      .maybeSingle();

    if (error || !data?.id) {
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

    const { error } = await dbcPublic
      .from('users')
      .upsert(row, { onConflict: 'uid' ,  ignoreDuplicates: true,});

    if (error) {
      throw new Error(`users upsert failed: ${error.message}`);
    }
  }

  private async createTenantUserInSupabase(body: {
    tenant_id: string;
    uid: string;
  }): Promise<void> {
    const dbcPublic = dbPublic();
    const instructorRoleId = await this.getInstructorRoleId();

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
          onConflict: 'tenant_id,uid,role_in_tenant' , ignoreDuplicates: true,
        }
      );

    if (error) {
      throw new Error(`tenant_users upsert failed: ${error.message}`);
    }
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
      }
     , 
     {
        onConflict: 'uid' ,  ignoreDuplicates: true,
      },
    )
      .select('*')
      .single();

    if (error) {
      throw new Error(`instructors insert failed: ${error.message}`);
    }

    return data;
  }
//   private getTenantSchemaOrThrow(): string {
//   const schema = localStorage.getItem('selectedSchema') || '';
//   if (!schema) throw new Error('לא נמצא tenant schema פעיל');
//   return schema;
// }

private getTenantIdOrThrow(): string {
  const tenantId = localStorage.getItem('selectedTenant') || '';
  if (!tenantId) throw new Error('לא נמצא tenant פעיל');
  return tenantId;
}

private async getFirebaseAuthToken(): Promise<string> {
  const authMod = await import('firebase/auth');
  const auth = authMod.getAuth();
  const user = auth.currentUser;
  if (!user) throw new Error('המשתמש לא מחובר');
  return user.getIdToken();
}

private async callPreviewInstructorDeactivationImpact(payload: {
  tenantSchema: string;
  instructorIdNumber: string;
  fromDate: string;
}) {
  const token = await this.getFirebaseAuthToken();

  const resp = await fetch(
    'https://us-central1-bereshit-ac5d8.cloudfunctions.net/previewInstructorDeactivationImpact',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    }
  );

  const json = await resp.json().catch(() => ({}));
  if (!resp.ok || json?.ok === false) {
    throw new Error(json?.message || json?.error || 'Preview נכשל');
  }
  return json;
}

private async callDeactivateInstructorAndCancelFutureLessons(payload: {
  tenantSchema: string;
  tenantId: string;
  instructorIdNumber: string;
  fromDate: string;
  decisionNote?: string | null;
}) {
  const token = await this.getFirebaseAuthToken();

  const resp = await fetch(
    'https://us-central1-bereshit-ac5d8.cloudfunctions.net/deactivateInstructorAndCancelFutureLessons',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    }
  );

  const json = await resp.json().catch(() => ({}));
  if (!resp.ok || json?.ok === false) {
    throw new Error(json?.message || json?.error || 'עדכון מדריך וביטול שיעורים נכשל');
  }
  return json;
}
dayOffCategoryLabel(category?: string | null): string {
  switch (String(category ?? '').toUpperCase()) {
    case 'SICK': return 'יום מחלה';
    case 'HOLIDAY': return 'יום חופש';
    case 'PERSONAL': return 'יום אישי';
    case 'OTHER': return 'אחר';
    default: return 'היעדרות';
  }
}

formatDateTime(v?: string | null): string {
  if (!v) return '—';
  return new Date(v).toLocaleString('he-IL', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

getSickNoteUrl(path?: string | null): string | null {
  if (!path) return null;

  if (!supabase) {
    console.error('Supabase client is not initialized');
    return null;
  }

  const { data } = supabase.storage
    .from('sick_notes')
    .getPublicUrl(path);

  return data.publicUrl;
}

isSickWithoutFile(row: InstructorUnavailabilityRow): boolean {
  return String(row.category ?? '').toUpperCase() === 'SICK' && !row.sick_note_file_path;
}
isSickCategory(category?: string | null): boolean {
  return (category ?? '').toUpperCase() === 'SICK';
}

formatDateOnly(v?: string | null): string {
  if (!v) return '';

  const iso = String(v).slice(0, 10); // YYYY-MM-DD
  const [y, m, d] = iso.split('-');

  return `${d}.${m}.${y}`;
}

formatTimeOnly(v?: string | null): string {
  if (!v) return '';

  return new Date(v).toLocaleTimeString('he-IL', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

formatUnavailabilityWindow(d: InstructorUnavailabilityRow): string {
  const fromDate = this.formatDateOnly(d.from_ts);

  if (d.all_day) {
    return `${fromDate} · יום מלא`;
  }

  const toDate = this.formatDateOnly(d.to_ts);
  const fromTime = this.formatTimeOnly(d.from_ts);
  const toTime = this.formatTimeOnly(d.to_ts);

  return fromDate === toDate
    ? `${fromDate} · ${fromTime}–${toTime}`
    : `${fromDate} ${fromTime} – ${toDate} ${toTime}`;
}
}
