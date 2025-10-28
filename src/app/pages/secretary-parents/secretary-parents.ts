import { Component, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatSidenav, MatSidenavModule } from '@angular/material/sidenav';
import { ensureTenantContextReady, dbTenant, listParents } from '../../services/supabaseClient.service';

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
  imports: [CommonModule, MatSidenavModule],
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

  

  // ✅ חשוב: זה מה שהתבנית שלך מצפה לו
  drawerChildren: Array<{
    child_uuid: string;
    full_name: string;
    gender?: string | null;
    status?: string | null;
    birth_date?: string | null;
    gov_id?: string | null;
  }> = [];

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
  console.log('[openDetails] uid =', JSON.stringify(uid)); // ← צריך להדפיס מחרוזת תקינה
  this.selectedUid = uid?.trim();                          // הגנה מרווחים
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

    // שליפת פרטי הורה
    const { data: p, error: pErr } = await db
      .from('parents')
      .select('uid, full_name, id_number, phone, email, address, extra_notes, message_preferences')
      .eq('uid', uid)
      .single();
    if (pErr) throw pErr;
    this.drawerParent = p as any;

    // --- DEBUG: תראי בדיוק מה חוזר מהשרת ולמה ---
    const cleanUid = uid?.trim();
    const { data: kids, error: kidsErr } = await db
      .from('children')
      .select('child_uuid, full_name, parent_uid, gender, status') // הוספתי parent_uid להצגה
      .eq('parent_uid', cleanUid) // הסינון הקריטי
      .order('full_name', { ascending: true });

    console.log('[children:filtered]', { cleanUid, count: kids?.length ?? 0, kids });
    if (kidsErr) throw kidsErr;

    this.drawerChildren = kids ?? [];
  } catch (e) {
    console.error('loadDrawerData error:', e);
    this.drawerChildren = [];
  } finally {
    this.drawerLoading = false;
  }
}

}
