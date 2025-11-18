
import { Component, OnInit, ViewChild } from '@angular/core';

import { CommonModule } from '@angular/common';

import { MatSidenav, MatSidenavModule } from '@angular/material/sidenav';

import { MatDialog, MatDialogModule } from '@angular/material/dialog';
 
import {

  ensureTenantContextReady,

  dbPublic,

  dbTenant,

} from '../../services/legacy-compat';
 
import {

  AddParentDialogComponent,

  AddParentPayload

} from './add-parent-dialog/add-parent-dialog.component';
 
import { CreateUserService } from '../../services/create-user.service';
 
type ParentRow = { uid: string; first_name: string;last_name: string; id_number?: string | null; phone?: string; email?: string };
 
interface ParentDetailsRow extends ParentRow {

  id_number?: string | null;

  address?: string | null;

  extra_notes?: string | null;

  message_preferences?: string[] | null;

}
 
@Component({

  selector: 'app-secretary-parents',

  standalone: true,

  imports: [CommonModule, MatSidenavModule, MatDialogModule],

  templateUrl: './secretary-parents.html',

  styleUrls: ['./secretary-parents.css'],

})

export class SecretaryParentsComponent implements OnInit {

  parents: ParentRow[] = [];

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
 
  constructor(

    private dialog: MatDialog,

    private createUserService: CreateUserService

  ) {}
 
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
 
  /** טוען הורים מתוך סכימת הטננט הפעיל (לפי ההקשר שנקבע ב־ensureTenantContextReady) */

  private async loadParents() {

    this.isLoading = true;

    this.error = null;

    try {

      const dbc = dbTenant();

      const { data, error } = await dbc

        .from('parents')

        .select('uid,first_name,last_name,id_number,phone,email')

        .order('first_name','last_name', { ascending: true });
 
      if (error) throw error;

      this.parents = (data ?? []) as ParentRow[];

    } catch (e: any) {

      this.error = e?.message || 'Failed to fetch parents.';

      console.error(e);

      this.parents = [];

    } finally {

      this.isLoading = false;

    }

  }
 
  async openDetails(uid: string) {

    this.selectedUid = uid?.trim();

    this.drawerChildren = [];

    this.drawer.open();

    await this.loadDrawerData(this.selectedUid!);

  }
 
  closeDetails() {

    this.drawer.close();

    this.selectedUid = null;

    this.drawerParent = null;

    this.drawerChildren = [];

  }
 
  /** טוען פרטי הורה + ילדי ההורה מסכימת הטננט */

  private async loadDrawerData(uid: string) {

    this.drawerLoading = true;

    try {

      const db = dbTenant();
 
      const { data: p, error: pErr } = await db

        .from('parents')

        .select('uid,first_name,last_name, id_number, phone, email, address, extra_notes, message_preferences')

        .eq('uid', uid)

        .single();

      if (pErr) throw pErr;

      this.drawerParent = p as any;
 
      const { data: kids, error: kidsErr } = await db

        .from('children')

        .select('child_uuid,first_name,last_name, parent_uid, gender, status, birth_date, gov_id')

        .eq('parent_uid', uid)

        .order('first_name','last_name', { ascending: true });
 
      if (kidsErr) throw kidsErr;

      this.drawerChildren = kids ?? [];

    } catch (e) {

      console.error(e);

      this.drawerChildren = [];

    } finally {

      this.drawerLoading = false;

    }

  }
 
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

    // 1) חווה / סכימה נוכחית
    const tenant_id = localStorage.getItem('selectedTenant') || '';
    const schema_name = localStorage.getItem('selectedSchema') || '';

    if (!tenant_id) {
      alert('לא נמצא tenant פעיל. התחברי מחדש או בחרי חווה פעילה.');
      return;
    }

    // 2) בדיקה אם המשתמש כבר קיים במערכת / בחווה
    let uid = '';
    let tempPassword = '';

    try {
      const exists = await this.checkIfParentExists(payload.email, tenant_id);
      // exists = { existsInSystem, existsInTenant, uid }

      // 2א) אם כבר קיים כהורה באותה חווה → שגיאה
      if (exists.existsInTenant) {
        alert('משתמש עם המייל הזה כבר קיים כהורה בחווה הנוכחית.');
        return;
      }

      // 2ב) קיים במערכת (בכלל) אבל לא כהורה בחווה הזאת
      if (exists.existsInSystem && exists.uid) {
        uid = exists.uid;
        tempPassword = ''; // לא מחלקים סיסמה חדשה, הוא כבר משתמש קיים
      } else {
        // 2ג) לא קיים בכלל במערכת → יוצרים משתמש חדש בפיירבייס
        const res = await this.createUserService.createUserIfNotExists(payload.email);
        uid = res.uid;
        tempPassword = res.tempPassword;
      }
    } catch (e: any) {
      const msg =
        this.createUserService.errorMessage ||
        e?.message ||
        'שגיאה ביצירת / בדיקת המשתמש.';
      alert(msg);
      return;
    }

    // שמים את ה־uid וה־password (אם חדש) ב־payload
    payload.uid = uid;
    payload.password = tempPassword || '';

    // 3) העדפות הודעות
    const message_preferences: string[] =
      Array.isArray(payload?.message_preferences) && payload.message_preferences.length
        ? payload.message_preferences
        : ['inapp'];

    // 4) נרמול שדות
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

    const missing = ['first_name', 'last_name', 'email', 'phone', 'id_number', 'address']
      .filter(k => !(body as any)[k]);

    if (missing.length) {
      alert('שדות חובה חסרים: ' + missing.join(', '));
      return;
    }

    try {
      // 5) users (public) – upsert תמיד, גם אם המשתמש קיים
      await this.createUserInSupabase(body.uid, body.email, body.phone);

      // 6) tenant_users (public) – משייכים כהורה לחווה הנוכחית
      await this.createTenantUserInSupabase({
        tenant_id: body.tenant_id,
        uid: body.uid,
      });

      // 7) parents (tenant schema) – יצירת רשומת הורה בחווה הנוכחית
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

      // 8) רענון הטבלה
      await this.loadParents();

      alert('הורה נוצר/שויך בהצלחה');

    } catch (e: any) {
      console.error(e);
      alert(e?.message ?? 'שגיאה - המערכת לא הצליחה להוסיף הורה');
    }
  });
}



 
  /** ================== Helpers: Inserts to Supabase ================== */

  private async getParentRoleId(): Promise<number> {
  const dbcTenant = dbTenant();

  const { data, error } = await dbcTenant
    .from('role')
    .select('id')
    .eq('table', 'parents')  // אפשר גם description = 'הורה'
    .maybeSingle();

  if (error || !data?.id) {
    console.error('getParentRoleId error', error);
    throw new Error('לא הצלחתי למצוא role_id לתפקיד הורה בטננט הנוכחי');
  }

  return data.id as number;
}
 

  // public.users – upsert לפי uid (אימייל/טלפון)

  async checkIfParentExists(email: string, tenant_id: string) {
  // 1) בדיקה אם המשתמש קיים בטבלת users (כל המערכת)
  const { data: user, error: userErr } = await dbPublic()
    .from('users')
    .select('uid')
    .eq('email', email.toLowerCase())
    .maybeSingle();

  if (userErr) throw userErr;

  if (!user) {
    return { existsInSystem: false, existsInTenant: false, uid: null };
  }

  // 2) בדיקה אם המשתמש קיים כ-parent באותה חווה
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
    uid: user.uid
  };
}


  private async createUserInSupabase(uid: string, email: string, phone?: string | null): Promise<void> {

    const dbcPublic = dbPublic();

    const row = {

      uid: (uid || '').trim(),

      email: (email || '').trim(),

      phone: (phone || '').trim() || null,

    };

    const { error } = await dbcPublic

      .from('users')

      .upsert(row, { onConflict: 'uid' });

    if (error) throw new Error(`users upsert failed: ${error.message}`);

  }
 
 

  // public.tenant_users – שיוך לטננט פעיל כ-parent
private async createTenantUserInSupabase(body: { tenant_id: string; uid: string }): Promise<void> {
  const dbcPublic = dbPublic();

  // 🔹 לוקחים דינמית את ה-role_id מהחווה הנוכחית
  const parentRoleId = await this.getParentRoleId();

  const { error } = await dbcPublic
    .from('tenant_users')
    .upsert(
      {
        tenant_id: body.tenant_id,
        uid: body.uid,
        role_in_tenant: 'parent',
        role_id: parentRoleId,
        is_active: true
      },
      {
        onConflict: 'tenant_id,uid,role_in_tenant'
      }
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

  const { data, error } = await dbcTenant
    .from('parents')
    .insert({
      uid: body.uid,
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
    })
    .select('*')      // ← שימי לב: **אין כאן id בכלל**
    .single();

  if (error) {
    throw new Error(`parents insert failed: ${error.message}`);
  }

  return data;
}


}

 