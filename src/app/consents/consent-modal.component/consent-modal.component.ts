// src/app/shared/consents/consent-modal.component.ts
import { Component, Input, Output, EventEmitter, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AgreementsService, RequiredAgreement } from '../../services/agreements.service';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'consent-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './consent-modal.component.html',
  styleUrl: './consent-modal.component.css'
  
})
export class ConsentModalComponent {
  @Input() tenantSchema!: string;
  @Input() parentUid!: string;
  @Input() childId!: string; // נדרש ל-per_child
  @Input() agreement!: RequiredAgreement | null;

  @Output() closed = new EventEmitter<void>();
  @Output() accepted = new EventEmitter<void>();

  checked = false;
  loading = signal(false);

  constructor(private svc: AgreementsService) {}

  renderMarkdown(md: string) {
    // אפשר לשלב marked/sanitize. בינתיים פשטני: מחליף שורות
    return (md || '').replace(/\n/g, '<br/>');
  }

  async approve() {
    if (!this.agreement) return;
    try {
      this.loading.set(true);
      await this.svc.acceptAgreement(this.tenantSchema, {
        versionId: this.agreement.version_id,
        parentUid: this.parentUid,
        childId: this.childId,
        roleSnapshot: 'parent'
      });
      this.accepted.emit();
      this.close();
    } finally {
      this.loading.set(false);
    }
  }

  close() { this.closed.emit(); }
}
