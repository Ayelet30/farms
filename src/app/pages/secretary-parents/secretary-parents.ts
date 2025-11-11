// import { Component, OnInit, ViewChild } from '@angular/core';
// import { CommonModule } from '@angular/common';
// import { MatSidenav, MatSidenavModule } from '@angular/material/sidenav';
// import { MatDialog, MatDialogModule } from '@angular/material/dialog';

// import {
//   ensureTenantContextReady,
//   dbTenant,
//   dbPublic,
//   listParents
// } from '../../services/supabaseClient.service';
// import {
//   AddParentDialogComponent,
//   AddParentPayload
// } from './add-parent-dialog/add-parent-dialog.component';
// import { CreateUserService } from '../../services/create-user.service';

// type ParentRow = { uid: string; full_name: string; phone?: string; email?: string };

// interface ParentDetailsRow extends ParentRow {
//   id_number?: string | null;
//   address?: string | null;
//   extra_notes?: string | null;
//   message_preferences?: string[] | null;
// }

// @Component({
//   selector: 'app-secretary-parents',
//   standalone: true,
//   imports: [CommonModule, MatSidenavModule, MatDialogModule],
//   templateUrl: './secretary-parents.html',
//   styleUrls: ['./secretary-parents.css'],
// })
// export class SecretaryParentsComponent implements OnInit {
//   parents: ParentRow[] = [];
//   isLoading = true;
//   error: string | null = null;

//   @ViewChild('drawer') drawer!: MatSidenav;

//   selectedUid: string | null = null;
//   drawerLoading = false;
//   drawerParent: ParentDetailsRow | null = null;

//   drawerChildren: Array<{
//     child_uuid: string;
//     full_name: string;
//     gender?: string | null;
//     status?: string | null;
//     birth_date?: string | null;
//     gov_id?: string | null;
//   }> = [];
//   toast: any;

//   constructor(private dialog: MatDialog, 
//     private createUserService: CreateUserService
//   ) {}

//   async ngOnInit() {
//     try {
//       await ensureTenantContextReady();
//       const res = await listParents();
//       this.parents = (res as any).rows ?? (res as any) ?? [];
//     } catch (e: any) {
//       this.error = e?.message || 'Failed to load parents';
//     } finally {
//       this.isLoading = false;
//     }
//   }

//   async openDetails(uid: string) {
//     this.selectedUid = uid?.trim();
//     this.drawerChildren = [];
//     this.drawer.open();
//     await this.loadDrawerData(this.selectedUid!);
//   }

//   closeDetails() {
//     this.drawer.close();
//     this.selectedUid = null;
//     this.drawerParent = null;
//     this.drawerChildren = [];
//   }

//   private async loadDrawerData(uid: string) {
//     this.drawerLoading = true;
//     try {
//       const db = dbTenant();

//       const { data: p, error: pErr } = await db
//         .from('parents')
//         .select('uid, full_name, id_number, phone, email, address, extra_notes, message_preferences')
//         .eq('uid', uid)
//         .single();
//       if (pErr) throw pErr;
//       this.drawerParent = p as any;

//       const cleanUid = uid?.trim();
//       const { data: kids, error: kidsErr } = await db
//         .from('children')
//         .select('child_uuid, full_name, parent_uid, gender, status')
//         .eq('parent_uid', cleanUid)
//         .order('full_name', { ascending: true });

//       if (kidsErr) throw kidsErr;
//       this.drawerChildren = kids ?? [];
//     } catch {
//       this.drawerChildren = [];
//     } finally {
//       this.drawerLoading = false;
//     }
//   }

//   openAddParentDialog() {
//     const ref = this.dialog.open(AddParentDialogComponent, {
//       width: '700px',
//       maxWidth: '90vw',
//       height: '90vh',
//       panelClass: 'parent-dialog'
//     });

//     ref.afterClosed().subscribe(async (payload?: AddParentPayload | any) => {
//       if (!payload) return;

//       // לוודא הקשר טננט טעון
//       await ensureTenantContextReady();

//       // פותח שם משתמש חדש בפיירבייס לפי אימייל ומחזיר את הסיסמא ואת הUID
//       try{
//       const { uid, tempPassword } = await this.createUserService.createUserIfNotExists(payload.email);
//       payload.uid = uid;
//       payload.password = tempPassword;
//        console.log('Created:', { uid, tempPassword });
//        } catch {
//           // הודעת שגיאה ידידותית זמינה בשירות:
//           this.toast.error(this.createUserService.errorMessage || 'שגיאה ביצירת משתמש');
//         }

//       // משיכה מה-LocalStorage (שני המפתחות האלו לפי מה שיש אצלך; אם שם אחר – עדכני)
//       const tenant_id = localStorage.getItem('selectedTenant') || '';
//       const schema_name = localStorage.getItem('selectedSchema') || '';

//       if (!tenant_id || !schema_name) {
//         alert('לא נמצא tenant או schema. התחברי מחדש או בחרי חווה פעילה.');
//         return;
//       }

//       // המרת prefs (צ׳קבוקסים) למערך מפתחות, אם לא הגיע מערך מוכן
//       const message_preferences: string[] =
//         Array.isArray(payload?.message_preferences) && payload.message_preferences.length
//           ? payload.message_preferences
//           : Object.keys(payload?.prefs ?? {}).filter((k: string) => !!payload.prefs[k]);

//       // נרמול שדות
//       const body = {
        
//         uid: payload.uid,
//         full_name: (payload.full_name ?? '').trim(),
//         email: (payload.email ?? '').trim(),
//         phone: (payload.phone ?? '').trim(),
//         id_number: (payload.id_number ?? '').trim(),
//         address: (payload.address ?? '').trim(),
//         extra_notes: (payload.extra_notes ?? '').trim(),
//         message_preferences: message_preferences.length ? message_preferences : ['inapp'],
//         tenant_id,
//         schema_name
//       };

//       // בדיקת שדות חובה (גיבוי לצד-לקוח)
//       const missing = ['full_name','email','phone','id_number','address']
//         .filter(k => !(body as any)[k]);
//       if (missing.length) {
//         alert('שדות חובה חסרים: ' + missing.join(', '));
//         return;
//       }

//       try {
//         //add user in User Table
//         await createUserInSupabase(payload.uid, payload.email, payload.phone);

//         //add user in tenant-user table
//          await createTenantUserInSupabase(body);

//         // add parent in Parent table of schema
//          await createParentInSupabase(body);

//         const res = await listParents();
//         this.parents = (res as any).rows ?? (res as any) ?? [];
//         alert('הורה נוצר בהצלחה ✅');
//       } catch (e: any) {
//         console.error(e);
//         alert(e?.message ?? 'שגיאה בהוספת הורה ❌');
//       }
//     });
//   }

// }
import { Component, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatSidenav, MatSidenavModule } from '@angular/material/sidenav';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';

import {
  ensureTenantContextReady,
  dbTenant,
  dbPublic,
  listParents
} from '../../services/supabaseClient.service';

import {
  AddParentDialogComponent,
  AddParentPayload
} from './add-parent-dialog/add-parent-dialog.component';

import { CreateUserService } from '../../services/create-user.service';


type ParentRow = { uid: string; full_name: string; phone?: string; email?: string };

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
    full_name: string;
    gender?: string | null;
    status?: string | null;
    birth_date?: string | null;
    gov_id?: string | null;
  }> = [];

  // החליפי אם יש לך שירות טוסטים
  toast: { error: (msg: string) => void } | any;

  constructor(
    private dialog: MatDialog,
    private createUserService: CreateUserService
  ) {}

  async ngOnInit() {
    try {
      await ensureTenantContextReady();
      const res = await listParents();
      this.parents = (res as any).rows ?? (res as any) ?? [];
    } catch (e: any) {
      this.error = e?.message || 'Failed to load parents';
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

  private async loadDrawerData(uid: string) {
    this.drawerLoading = true;
    try {
      const db = dbTenant();

      const { data: p, error: pErr } = await db
        .from('parents')
        .select('uid, full_name, id_number, phone, email, address, extra_notes, message_preferences')
        .eq('uid', uid)
        .single();
      if (pErr) throw pErr;
      this.drawerParent = p as any;

      const cleanUid = uid?.trim();
      const { data: kids, error: kidsErr } = await db
        .from('children')
        .select('child_uuid, full_name, parent_uid, gender, status')
        .eq('parent_uid', cleanUid)
        .order('full_name', { ascending: true });

      if (kidsErr) throw kidsErr;
      this.drawerChildren = kids ?? [];
    } catch {
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
      panelClass: 'parent-dialog'
    });

    ref.afterClosed().subscribe(async (payload?: AddParentPayload | any) => {
      if (!payload) return;

      // לוודא הקשר טננט טעון
      await ensureTenantContextReady();

      // יצירת משתמש בפיירבייס לפי אימייל והחזרת uid + סיסמה זמנית
      try {
        const { uid, tempPassword } =
          await this.createUserService.createUserIfNotExists(payload.email);
        payload.uid = uid;
        payload.password = tempPassword;
        console.log('Created Firebase user:', { uid, tempPassword });
      } catch {
        this.toast?.error?.(this.createUserService.errorMessage || 'שגיאה ביצירת משתמש');
        return; // לא ממשיכים בלי uid תקין
      }

      // נתוני טננט/סכימה מה-LocalStorage 
      const tenant_id = localStorage.getItem('selectedTenant') || '';
      const schema_name = localStorage.getItem('selectedSchema') || '';

      if (!tenant_id || !schema_name) {
        alert('לא נמצא tenant או schema. התחברי מחדש או בחרי חווה פעילה.');
        return;
      }

      // המרת prefs (צ׳קבוקסים) למערך
      const message_preferences: string[] =
        Array.isArray(payload?.message_preferences) && payload.message_preferences.length
          ? payload.message_preferences
          : Object.keys(payload?.prefs ?? {}).filter((k: string) => !!payload.prefs[k]);

      // נרמול שדות
      const body = {
        uid: (payload.uid ?? '').trim(),
        full_name: (payload.full_name ?? '').trim(),
        email: (payload.email ?? '').trim(),
        phone: (payload.phone ?? '').trim(),
        id_number: (payload.id_number ?? '').trim(),
        address: (payload.address ?? '').trim(),
        extra_notes: (payload.extra_notes ?? '').trim(),
        message_preferences: message_preferences.length ? message_preferences : ['inapp'],
        tenant_id,
        schema_name
      };

      // בדיקת שדות חובה
      const missing = ['full_name','email','phone','id_number','address'].filter(k => !(body as any)[k]);
      if (missing.length) {
        alert('שדות חובה חסרים: ' + missing.join(', '));
        return;
      }

      try {
        // 1) upsert ל-public.users
        await this.createUserInSupabase(body.uid, body.email, body.phone);

        // 2) שיוך לטננט ב-public.tenant_users
        await this.createTenantUserInSupabase({ tenant_id, uid: body.uid });

        // 3) יצירת ההורה בטבלת הטננט <schema>.parents
        await this.createParentInSupabase(body);

        // רענון רשימת הורים
        const res = await listParents();
        this.parents = (res as any).rows ?? (res as any) ?? [];
        alert('הורה נוצר בהצלחה ✅');
      } catch (e: any) {
        console.error(e);
        alert(e?.message ?? 'שגיאה בהוספת הורה ❌');
      }
    });
  }

  /** ================== Helpers: Inserts to Supabase ================== */

  // ❶ public.users – upsert לפי uid (שומר אימייל/טלפון)
  private async createUserInSupabase(uid: string, email: string, phone?: string | null): Promise<void> {
    const dbcPublic = dbPublic();

    const row = {
      uid: (uid || '').trim(),
      email: (email || '').trim(),
      phone: (phone || '').trim() || null, // שמירה כ-null אם ריק
    };

    const { error } = await dbcPublic
      .from('users')
      .upsert(row, { onConflict: 'uid' });

    if (error) throw new Error(`users upsert failed: ${error.message}`);
  }

  // ❷ public.tenant_users – שיוך לטננט פעיל כ-parent
  private async createTenantUserInSupabase(body: { tenant_id: string; uid: string }): Promise<void> {
    const dbcPublic = dbPublic();
    const { error } = await dbcPublic
      .from('tenant_users')
      .upsert(
        {
          tenant_id: body.tenant_id,
          uid: body.uid,
          role_in_tenant: 'parent',
          is_active: true
        },
        { onConflict: 'tenant_id,uid' }
      );
    if (error) throw new Error(`tenant_users upsert failed: ${error.message}`);
  }

  // ❸ <tenant>.parents – יצירת הורה בסכימת הטננט
  private async createParentInSupabase(body: {
    uid: string;
    full_name: string;
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
        full_name: body.full_name,
        email: body.email,
        phone: body.phone ?? null,
        id_number: body.id_number ?? null,
        address: body.address ?? null,
        extra_notes: body.extra_notes ?? null,
        message_preferences: body.message_preferences?.length ? body.message_preferences : ['inapp'],
        is_active: body.is_active ?? true
      })
      .select('id, uid, full_name, email, phone, created_at')
      .single();

    if (error) throw new Error(`parents insert failed: ${error.message}`);
    return data;
  }
}
