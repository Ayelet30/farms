// app/billing/parent-payments.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ParentPaymentsComponent } from './parent-payments.component';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { beforeEach, describe, it } from 'node:test';

// מוקים לשירותים החיצוניים:
class MockCurrentUserService {
  uid() { return 'test-uid'; }
  email() { return 'parent@test.com'; }
}

class MockPaymentsService {
  async listProfiles() { return []; }
  async listCharges() { return []; }
  async setDefault() { return; }
  async deactivate() { return; }
}

class MockTranzilaService {
  async createHostedUrl() { return 'https://example.com/hpp'; }
  async chargeByToken() { return { ok: true }; }
}

describe('ParentPayments', () => {
  let component: ParentPaymentsComponent;
  let fixture: ComponentFixture<ParentPaymentsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HttpClientTestingModule, ParentPaymentsComponent],
      providers: [
        { provide: 'CurrentUserService', useClass: MockCurrentUserService }, // אם הוא מוזרק בטוקן – עדכני
        { provide: (await import('../../services/payments.service')).PaymentsService, useClass: MockPaymentsService },
        { provide: (await import('../../services/tranzila.service')).TranzilaService, useClass: MockTranzilaService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ParentPaymentsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
function expect(component: ParentPaymentsComponent) {
  throw new Error('Function not implemented.');
}

