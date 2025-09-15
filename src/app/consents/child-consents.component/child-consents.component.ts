// src/app/pages/parent/child-consents.component.ts
import { Component, inject, input, Input, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AgreementsService, RequiredAgreement } from '../../services/agreements.service';
import { ConsentModalComponent } from '../consent-modal.component/consent-modal.component';

@Component({
  selector: 'child-consents',
  standalone: true,
  imports: [CommonModule, ConsentModalComponent],
  templateUrl: './child-consents.component.html',
  styleUrls: ['./child-consents.component.css']
})
export class ChildConsentsComponent implements OnInit {
  private svc = inject(AgreementsService);

   @Input() tenantSchema: string = '';
   @Input() parentUid: string = '';
   @Input() childId: string = '';
   @Input() childName: string = '';

  required = signal<RequiredAgreement[]>([]);
  openAgreement = signal<RequiredAgreement | null>(null);

  async ngOnInit() { await this.refresh(); }

  async refresh() {
    const list = await this.svc.getRequiredForChild(this.tenantSchema, this.childId, this.parentUid);
    this.required.set(list);
  }

  open(a: RequiredAgreement) { this.openAgreement.set(a); }
}
