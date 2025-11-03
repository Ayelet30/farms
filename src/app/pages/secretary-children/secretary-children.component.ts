import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';

import { ChildRow } from '../../Types/detailes.model';
import { ensureTenantContextReady, fetchMyChildren } from '../../services/supabaseClient.service';

@Component({
  selector: 'app-secretary-children',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './secretary-children.component.html',
  styleUrls: ['./secretary-children.component.css']
})
export class SecretaryChildrenComponent implements OnInit {
  children: ChildRow[] = [];
  isLoading = true;
  error: string | null = null;

  constructor() {}

  async ngOnInit(): Promise<void> {
    try {
      await ensureTenantContextReady();   // בוחר סכימת טננט תקפה
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
 const res = await fetchMyChildren(); // בלי מחרוזת select


      console.log('תשובה מ-fetchMyChildren:', res);

      if (!res.ok) {
        this.error = 'Failed to fetch children: ' + (res.error ?? 'Unknown error');
        this.children = [];
        return;
        }

      this.children = res.data;
    } catch (e: any) {
      this.error = e?.message ?? 'Failed to fetch children.';
      this.children = [];
      console.error(e);
    } finally {
      this.isLoading = false;
    }
  }
}
