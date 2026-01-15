// src/app/pages/parent/child-consents.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChildConsentsComponent } from './child-consents.component';
import { AgreementsService, RequiredAgreement } from '../../services/agreements.service';

describe('ChildConsentsComponent', () => {
  let fixture: ComponentFixture<ChildConsentsComponent>;
  let component: ChildConsentsComponent;

  let svcSpy: jasmine.SpyObj<AgreementsService>;

  const mockList: RequiredAgreement[] = [
    {
      agreement_id: 'a1',
      agreement_code: 'PARENT_SIGNUP',
      title: 'תקנון',
      scope: 'per_parent',
      version_id: 'v1',
      accepted: false,
      body_md: '## x',
      storage_path: null,
    },
    {
      agreement_id: 'a2',
      agreement_code: 'CHILD_MEDICAL',
      title: 'בריאות ילד',
      scope: 'per_child',
      version_id: 'v2',
      accepted: true,
      body_md: null,
      storage_path: 'agreements/a2.pdf',
    },
  ];

  beforeEach(async () => {
    svcSpy = jasmine.createSpyObj<AgreementsService>('AgreementsService', [
      'getRequiredForChild',
      'acceptAgreement',
    ]);

    await TestBed.configureTestingModule({
      imports: [ChildConsentsComponent], // standalone component
      providers: [{ provide: AgreementsService, useValue: svcSpy }],
    }).compileComponents();

    fixture = TestBed.createComponent(ChildConsentsComponent);
    component = fixture.componentInstance;

    // Inputs
    component.tenantSchema = 'moacha_atarim_app';
    component.parentUid = 'parent-123';
    component.childId = 'child-456';
    component.childName = 'דני';

    // default mock
    svcSpy.getRequiredForChild.and.resolveTo(mockList);
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('ngOnInit should call refresh and populate required signal', async () => {
    await component.ngOnInit();

    expect(svcSpy.getRequiredForChild).toHaveBeenCalledTimes(1);
    expect(svcSpy.getRequiredForChild).toHaveBeenCalledWith(
      'moacha_atarim_app',
      'child-456',
      'parent-123'
    );

    expect(component.required()).toEqual(mockList);
  });

  it('refresh should call service with correct params and set required signal', async () => {
    const list2: RequiredAgreement[] = [
      {
        agreement_id: 'a3',
        agreement_code: 'PHOTO_CONSENT',
        title: 'אישור צילום',
        scope: 'per_child',
        version_id: 'v3',
        accepted: false,
      },
    ];
    svcSpy.getRequiredForChild.and.resolveTo(list2);

    await component.refresh();

    expect(svcSpy.getRequiredForChild).toHaveBeenCalledWith(
      'moacha_atarim_app',
      'child-456',
      'parent-123'
    );
    expect(component.required()).toEqual(list2);
  });

  it('open should set openAgreement signal', () => {
    const a = mockList[0];

    expect(component.openAgreement()).toBeNull();

    component.open(a);

    expect(component.openAgreement()).toEqual(a);
  });

  it('refresh should propagate service error (reject)', async () => {
    const err = new Error('rpc failed');
    svcSpy.getRequiredForChild.and.rejectWith(err);

    await expectAsync(component.refresh()).toBeRejectedWith(err);
  });

  it('should not auto-refresh until ngOnInit is called', async () => {
    // if something triggers change detection, it won't call ngOnInit automatically unless we run it.
    expect(svcSpy.getRequiredForChild).not.toHaveBeenCalled();

    // Running detectChanges triggers lifecycle hooks (including ngOnInit)
    fixture.detectChanges();
    await fixture.whenStable();

    expect(svcSpy.getRequiredForChild).toHaveBeenCalledTimes(1);
  });
});
