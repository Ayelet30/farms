// src/app/shared/consents/consent-modal.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConsentModalComponent } from './consent-modal.component';
import { AgreementsService, RequiredAgreement } from '../../services/agreements.service';

describe('ConsentModalComponent', () => {
  let fixture: ComponentFixture<ConsentModalComponent>;
  let component: ConsentModalComponent;

  let svcSpy: jasmine.SpyObj<AgreementsService>;

  const agreement: RequiredAgreement = {
    agreement_id: 'a1',
    agreement_code: 'PARENT_SIGNUP',
    title: 'תקנון',
    scope: 'per_parent',
    version_id: 'v1',
    accepted: false,
    body_md: 'hello\nworld',
    storage_path: null,
  };

  beforeEach(async () => {
    svcSpy = jasmine.createSpyObj<AgreementsService>('AgreementsService', ['acceptAgreement', 'getRequiredForChild']);

    await TestBed.configureTestingModule({
      imports: [ConsentModalComponent], // standalone
      providers: [{ provide: AgreementsService, useValue: svcSpy }],
    }).compileComponents();

    fixture = TestBed.createComponent(ConsentModalComponent);
    component = fixture.componentInstance;

    // Inputs
    component.tenantSchema = 'moacha_atarim_app';
    component.parentUid = 'parent-123';
    component.childId = 'child-456';
    component.agreement = agreement;

    svcSpy.acceptAgreement.and.resolveTo({}); // default success
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renderMarkdown should replace newlines with <br/>', () => {
    expect(component.renderMarkdown('a\nb\nc')).toBe('a<br/>b<br/>c');
  });

  it('renderMarkdown should handle empty/null-ish strings safely', () => {
    expect(component.renderMarkdown('')).toBe('');
    // cast to avoid TS complaining in test
    expect(component.renderMarkdown((null as unknown) as string)).toBe('');
  });

  it('approve should do nothing when agreement is null', async () => {
    component.agreement = null;

    const acceptedSpy = spyOn(component.accepted, 'emit');
    const closedSpy = spyOn(component.closed, 'emit');

    await component.approve();

    expect(svcSpy.acceptAgreement).not.toHaveBeenCalled();
    expect(acceptedSpy).not.toHaveBeenCalled();
    expect(closedSpy).not.toHaveBeenCalled();
    expect(component.loading()).toBeFalse();
  });

  it('approve should call acceptAgreement with correct payload, emit accepted+closed, and toggle loading', async () => {
    const acceptedSpy = spyOn(component.accepted, 'emit');
    const closedSpy = spyOn(component.closed, 'emit');

    // capture loading states during the async flow
    const loadingStates: boolean[] = [];
    loadingStates.push(component.loading());

    const p = component.approve();
    loadingStates.push(component.loading()); // should be true immediately after entering approve()

    await p;
    loadingStates.push(component.loading()); // should be false at end

    expect(svcSpy.acceptAgreement).toHaveBeenCalledTimes(1);
    expect(svcSpy.acceptAgreement).toHaveBeenCalledWith('moacha_atarim_app', {
      versionId: 'v1',
      parentUid: 'parent-123',
      childId: 'child-456',
      roleSnapshot: 'parent',
    });

    expect(acceptedSpy).toHaveBeenCalledTimes(1);
    expect(closedSpy).toHaveBeenCalledTimes(1);

    // loading should go false -> true -> false
    expect(loadingStates[0]).toBeFalse();
    expect(loadingStates[1]).toBeTrue();
    expect(loadingStates[2]).toBeFalse();
  });

  it('approve should reset loading to false even if service throws, and should not emit accepted/closed', async () => {
    const acceptedSpy = spyOn(component.accepted, 'emit');
    const closedSpy = spyOn(component.closed, 'emit');

    const err = new Error('insert failed');
    svcSpy.acceptAgreement.and.rejectWith(err);

    await expectAsync(component.approve()).toBeRejectedWith(err);

    expect(component.loading()).toBeFalse();
    expect(acceptedSpy).not.toHaveBeenCalled();
    expect(closedSpy).not.toHaveBeenCalled();
  });

  it('close should emit closed', () => {
    const closedSpy = spyOn(component.closed, 'emit');
    component.close();
    expect(closedSpy).toHaveBeenCalledTimes(1);
  });
});
