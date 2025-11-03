import { Component, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatSidenav, MatSidenavModule } from '@angular/material/sidenav';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';

import { ensureTenantContextReady, dbTenant, listParents, createParent } from '../../services/supabaseClient.service';
import { AddParentDialogComponent, AddParentPayload } from './add-parent-dialog/add-parent-dialog.component';

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

  constructor(private dialog: MatDialog) {}

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

  ref.afterClosed().subscribe(async (payload?: AddParentPayload) => {
    if (!payload) return;
    try {
      await ensureTenantContextReady();
      await createParent({
        full_name: payload.full_name!,
        email: payload.email!,
        phone: payload.phone!,
        id_number: payload.id_number!,
       address: payload.address!,
       extra_notes: payload.extra_notes!,
       message_preferences: payload.message_preferences!,

      });
      const res = await listParents();
      this.parents = (res as any).rows ?? (res as any) ?? [];
    } catch (e: any) {
      alert(e?.message ?? 'שגיאה בהוספת הורה');
    }
  });
}
 }
