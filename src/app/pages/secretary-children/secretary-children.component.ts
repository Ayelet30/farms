import { Component, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatSidenav, MatSidenavModule } from '@angular/material/sidenav';

import { ensureTenantContextReady, dbTenant } from '../../services/legacy-compat';
import type { ChildRow } from '../../Types/detailes.model';

import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import {
  AddChildDialogComponent,
  AddChildPayload,
} from './add-child-dialog/add-child-dialog.component';

type ParentBrief = {
  uid: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
};

type ChildDetails = {
  child_uuid?: string;
  first_name?: string;
  last_name?: string;
  parent_uid?: string | null;
  gov_id?: string | null;
  birth_date?: string | null;
  gender?: string | null;
  health_fund?: string | null;
  status?: string | null;
  medical_notes?: string | null;
  behavior_notes?: string | null;
  parent?: ParentBrief | null;
};

@Component({
  selector: 'app-secretary-children',
  standalone: true,
  imports: [CommonModule, MatSidenavModule, MatDialogModule],
  templateUrl: './secretary-children.component.html',
  styleUrls: ['./secretary-children.component.css'], // ✅ רק הקובץ הזה!
})
export class SecretaryChildrenComponent implements OnInit {
  children: ChildRow[] = [];
  isLoading = true;
  error: string | null = null;

  @ViewChild('drawer') drawer!: MatSidenav;

  selectedId: string | null = null;
  drawerLoading = false;
  drawerChild: ChildDetails | null = null;

  constructor(private dialog: MatDialog) {}

  async ngOnInit(): Promise<void> {
    try {
      await ensureTenantContextReady();
      await this.loadChildren();
    } catch (e: any) {
      this.error =
        'Failed to initialize tenant context or load children: ' +
        (e?.message ?? e);
      this.isLoading = false;
      console.error(e);
    }
  }

  /** טוען את כל הילדים בסכימת הטננט הפעיל */
  async loadChildren(): Promise<void> {
    this.isLoading = true;
    this.error = null;

    try {
      const dbc = dbTenant();

      const { data, error } = await dbc
        .from('children')
        .select(
          `
          child_uuid,
          first_name,
          last_name,
          parent_uid,
          gov_id,
          birth_date,
          gender,
          health_fund,
          status
        `,
        )
        .order('first_name', { ascending: true })
        .order('last_name', { ascending: true });

      if (error) throw error;

      this.children = (data ?? []) as ChildRow[];
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

  /** פתיחת דיאלוג הוספת ילד/ה חדש/ה */
  openAddChildDialog() {
    const ref = this.dialog.open(AddChildDialogComponent, {
      width: '700px',
      maxWidth: '90vw',
      height: '90vh',
      panelClass: 'child-dialog',
      disableClose: true,
    });

    ref.afterClosed().subscribe(async (payload?: AddChildPayload) => {
      if (!payload) return; // המשתמשת לחצה ביטול

      try {
        await ensureTenantContextReady();
        const db = dbTenant();

        const { data, error } = await db
          .from('children')
          .insert({
            first_name: payload.first_name,
            last_name: payload.last_name,
            parent_uid: payload.parent_uid,
            gov_id: payload.gov_id ?? null,
            birth_date: payload.birth_date ?? null,
            gender: payload.gender ?? null,
            health_fund: payload.health_fund ?? null,
            status: payload.status ?? null,
            medical_notes: payload.medical_notes ?? null,
            behavior_notes: payload.behavior_notes ?? null,
          })
          .select(
            `
            child_uuid,
            first_name,
            last_name,
            parent_uid,
            gov_id,
            birth_date,
            gender,
            health_fund,
            status
          `,
          )
          .single();

        if (error) throw error;

        // מוסיפים את הילד החדש לרשימה (אפשר גם לקרוא ל-loadChildren)
        this.children = [...this.children, data as ChildRow];
      } catch (e: any) {
        console.error(e);
        alert('אירעה שגיאה בשמירת הילד: ' + (e?.message ?? e));
      }
    });
  }

  /** טוען פרטי ילד והורה למגירה */
  private async loadDrawerData(id: string) {
    this.drawerLoading = true;

    try {
      const db = dbTenant();

      // 1) פרטי הילד
      const { data: c, error: cErr } = await db
        .from('children')
        .select(
          `
           first_name,
           last_name,
           gov_id,
           birth_date,
           gender,
           parent_uid,
           health_fund,
           status,
           medical_notes,
           behavior_notes
        `,
        )
        .eq('child_uuid', id)
        .single();

      if (cErr) throw cErr;

      // 2) פרטי ההורה
      let parent: ParentBrief | null = null;

      if (c?.parent_uid) {
        const { data: p, error: pErr } = await db
          .from('parents')
          .select('first_name,last_name, phone, email')
          .eq('uid', c.parent_uid)
          .maybeSingle();

        if (!pErr && p) parent = p as ParentBrief;
      }

      // 3) שמירה לתצוגה
      this.drawerChild = { ...(c as ChildDetails), parent };
    } catch (e) {
      console.error('loadDrawerData error:', e);
      this.drawerChild = null;
    } finally {
      this.drawerLoading = false;
    }
  }
}
