import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common'; 

import {
  ensureTenantContextReady,
  listParents,
  ParentRow,
}  from '../../services/supabaseClient.service';


@Component({
  selector: 'app-secretary-parents',
   standalone: true,
    imports: [CommonModule],
  templateUrl: './secretary-parents.html',
  styleUrls: ['./secretary-parents.css'],
})
export class SecretaryParentsComponent implements OnInit {
  parents: ParentRow[] = [];
  isLoading = true;
  error: string | null = null;

  constructor() {}

  async ngOnInit(): Promise<void> {
    try {
      await ensureTenantContextReady();
      await this.loadParents();
    } catch (e: any) {
      this.isLoading = false;
      this.error = 'Failed to initialize tenant context: ' + e.message;
      console.error(e);
    }
  }

  async loadParents(): Promise<void> {
    this.isLoading = true;
    this.error = null;
    try {
      const result = await listParents();
      this.parents = result.rows;
    } catch (e: any) {
      this.error = e.message || 'Failed to fetch parents.';
      console.error(e);
    } finally {
      this.isLoading = false;
    }
  }
}