
// src/app/auth/membership-picker.dialog.ts
import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import type { Membership } from '../../services/supabaseClient';

@Component({
  selector: 'app-membership-picker-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule],
  template: `
    <h2 class="title">בחרי חווה/תפקיד</h2>
    <div class="list">
      <button class="item" *ngFor="let m of data.memberships" (click)="choose(m.tenant_id)">
        <div class="name">{{ m.farm?.name || m.tenant_id }}</div>
        <div class="role">{{ m.role_in_tenant }}</div>
      </button>
    </div>
    <div class="actions">
      <button class="cancel" (click)="close()">ביטול</button>
    </div>
  `,
  styles: [`
    .title { margin: 0 0 12px; font-size: 20px; font-weight: 600; }
    .list { display: grid; gap: 8px; }
    .item { text-align: start; padding: 10px 12px; border-radius: 12px; border: 1px solid #e5e7eb; cursor: pointer; }
    .item:hover { background: #f9fafb; }
    .name { font-weight: 600; }
    .role { font-size: 12px; opacity: .75; }
    .actions { margin-top: 12px; text-align: end; }
    .cancel { padding: 6px 12px; border-radius: 10px; border: 1px solid #e5e7eb; background: white; cursor: pointer; }
  `]
})
export class MembershipPickerDialogComponent {
  constructor(
    private ref: MatDialogRef<MembershipPickerDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { memberships: Membership[] }
  ) {}
  choose(tenantId: string) { this.ref.close(tenantId); }
  close() { this.ref.close(null); }
}