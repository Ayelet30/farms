import { Component, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatSidenav, MatSidenavModule } from '@angular/material/sidenav';

import { ensureTenantContextReady, dbTenant, fetchMyChildren } from '../../services/supabaseClient.service';
import { ChildRow } from '../../Types/detailes.model';

type ParentBrief = {
  uid: string;
  full_name: string;
  phone: string | null;
  email: string | null;
};

type ChildDetails = {
  child_uuid?: string;
  full_name?: string;
  parent_uid?: string | null;
  gov_id?: string | null;
  birth_date?: string | null;
  gender?: string | null;
  health_fund?: string | null;
  status?: string | null;
  medical_notes?: string | null;
  behavior_notes?: string | null;
  parent?: ParentBrief | null;   // ← ההורה המקוצר לתצוגה במגירה
};

@Component({
  selector: 'app-secretary-children',
  standalone: true,
  imports: [CommonModule, MatSidenavModule],
  templateUrl: './secretary-children.component.html',
  styleUrls: ['./secretary-children.component.css'],
})
export class SecretaryChildrenComponent implements OnInit {
  children: ChildRow[] = [];
  isLoading = true;
  error: string | null = null;

  @ViewChild('drawer') drawer!: MatSidenav;
  selectedId: string | null = null;
  drawerLoading = false;
 drawerChild: ChildDetails | null = null;

  async ngOnInit(): Promise<void> {
    try {
      await ensureTenantContextReady();
      await this.loadChildren();
    } catch (e: any) {
      this.error = 'Failed to initialize tenant context or load children: ' + (e?.message ?? e);
      this.isLoading = false;
      console.error(e);
    }
  }

  async loadChildren(): Promise<void> {
    this.isLoading = true;
    this.error = null;
    try {
      const res = await fetchMyChildren();
      if (!res?.ok) throw new Error(res?.error || 'fetchMyChildren failed');
      this.children = res.data ?? [];
    } catch (e: any) {
      this.error = e?.message ?? 'Failed to fetch children.';
      this.children = [];
      console.error(e);
    } finally {
      this.isLoading = false;
    }
  }

  async openDetails(id?: string) {
    if (!id) return;
    this.selectedId = id;
    this.drawer.open();
    await this.loadDrawerData(id);
  }

  closeDetails() {
    this.drawer.close();
    this.selectedId = null;
    this.drawerChild = null;
  }

  private async loadDrawerData(id: string) {
  this.drawerLoading = true;
  try {
    const db = dbTenant();

    // 1) נטען את הילד
    const { data: c, error: cErr } = await db
      .from('children')
      .select(`
        child_uuid, full_name, gov_id, birth_date, gender,
        parent_uid, health_fund, status,
        medical_notes, behavior_notes
      `)
      .eq('child_uuid', id)
      .single();
    if (cErr) throw cErr;

    // 2) אם יש parent_uid — נטען את פרטי ההורה (שם, טלפון, אימייל)
    let parent: ParentBrief | null = null;
    if (c?.parent_uid) {
      const { data: p, error: pErr } = await db
        .from('parents')
        .select('uid, full_name, phone, email')
        .eq('uid', c.parent_uid)
        .single();
      if (!pErr && p) parent = p as ParentBrief;
    }

    // 3) נשמור במגירה
    this.drawerChild = { ...(c as ChildDetails), parent };
  } catch (e) {
    console.error('loadDrawerData error:', e);
    this.drawerChild = null;
  } finally {
    this.drawerLoading = false;
  }
}
}
