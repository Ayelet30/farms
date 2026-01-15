import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AgreementsAdminComponent } from './agreements-admin.component';
import { AgreementsAdminService } from '../../services/agreements-admin.service';
import { CurrentUserService } from '../../core/auth/current-user.service';
import { TenantBootstrapService } from '../../services/tenant-bootstrap.service';

describe('AgreementsAdminComponent', () => {
  let component: AgreementsAdminComponent;
  let fixture: ComponentFixture<AgreementsAdminComponent>;

  const adminSpy = {
    listAgreements: jasmine.createSpy('listAgreements'),
    createAgreement: jasmine.createSpy('createAgreement'),
    listVersions: jasmine.createSpy('listVersions'),
    uploadPdf: jasmine.createSpy('uploadPdf'),
    addVersion: jasmine.createSpy('addVersion'),
    publishVersion: jasmine.createSpy('publishVersion'),
    archiveAgreement: jasmine.createSpy('archiveAgreement'),
    setTarget: jasmine.createSpy('setTarget'),
  } as any;

  const bootSpy = {
    ensureReady: jasmine.createSpy('ensureReady').and.resolveTo(),
    getFarmMetaSync: jasmine
      .createSpy('getFarmMetaSync')
      .and.returnValue({ schema_name: 'moacha_atarim_app' }),
  } as unknown as TenantBootstrapService;

 beforeEach(async () => {
  // ✅ איפוס היסטוריית קריאות מכל הטסטים הקודמים
  Object.values(adminSpy).forEach((s: any) => s?.calls?.reset?.());
  (bootSpy.ensureReady as any)?.calls?.reset?.();
  (bootSpy.getFarmMetaSync as any)?.calls?.reset?.();

  // ברירות מחדל
  adminSpy.listAgreements.and.resolveTo([
    { id: 'ag1', code: 'A', title: 'Agreement A' },
    { id: 'ag2', code: 'B', title: 'Agreement B' },
  ]);
  adminSpy.listVersions.and.resolveTo([{ version: 1 }, { version: 2 }]);

  (bootSpy.ensureReady as any).and.resolveTo();
  (bootSpy.getFarmMetaSync as any).and.returnValue({ schema_name: 'moacha_atarim_app' });

  await TestBed.configureTestingModule({
    imports: [AgreementsAdminComponent],
    providers: [
      { provide: AgreementsAdminService, useValue: adminSpy },
      { provide: CurrentUserService, useValue: {} },
      { provide: TenantBootstrapService, useValue: bootSpy },
    ],
  }).compileComponents();

  fixture = TestBed.createComponent(AgreementsAdminComponent);
  component = fixture.componentInstance;
});

beforeEach(() => {
  // חשוב: לאפס קריאות + להחזיר התנהגות ברירת מחדל של הצלחה
  adminSpy.createAgreement.calls.reset();
  adminSpy.createAgreement.and.resolveTo({ ok: true });

  adminSpy.listRequiredAgreements?.calls?.reset?.();
  adminSpy.listRequiredAgreements?.and?.resolveTo?.([]);
});


  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('ngOnInit should set tenantSchema and refresh agreements', async () => {
    await component.ngOnInit();

    expect(bootSpy.ensureReady).toHaveBeenCalled();
    expect(bootSpy.getFarmMetaSync).toHaveBeenCalled();

    expect(component.tenantSchema).toBe('moacha_atarim_app');
    expect(adminSpy.listAgreements).toHaveBeenCalledWith('moacha_atarim_app');
  });

  it('ngOnInit should not refresh when schema missing (and should catch error)', async () => {
    // מחזירים שאין schema
    (bootSpy.getFarmMetaSync as any).and.returnValue(null);
    const errSpy = spyOn(console, 'error');

    await component.ngOnInit();

    expect(adminSpy.listAgreements).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
  });

  it('refresh should do nothing when tenantSchema is not set', async () => {
    component.tenantSchema = undefined;
    await component.refresh();
    expect(adminSpy.listAgreements).not.toHaveBeenCalled();
  });

  it('refresh should map agreements and reset _open/_versions', async () => {
    component.tenantSchema = 'moacha_atarim_app';
    await component.refresh();

    const list = component.agreements();
    expect(list.length).toBe(2);
    expect(list[0]._open).toBeFalse();
    expect(list[0]._versions).toEqual([]);
  });

  it('createAgreement should call service with trimmed fields, toggle busy, reset form, and refresh', async () => {
    component.tenantSchema = 'moacha_atarim_app';

    component.newAgreement = {
      code: '  CONSENT_1  ',
      title: '  Title  ',
      scope: 'per_child',
      renewalIso: '',
      renewalNotifyDays: 14,
    };

    const states: boolean[] = [component.busy()];
    const p = component.createAgreement();
    states.push(component.busy());

    await p;
    states.push(component.busy());

    expect(adminSpy.createAgreement).toHaveBeenCalledWith({
      tenantSchema: 'moacha_atarim_app',
      code: 'CONSENT_1',
      title: 'Title',
      scope: 'per_child',
      renewalIso: null,
      renewalNotifyDays: 14,
    });

    expect(component.newAgreement).toEqual({
      code: '',
      title: '',
      scope: 'per_child',
      renewalIso: '',
      renewalNotifyDays: 14,
    });

    expect(adminSpy.listAgreements).toHaveBeenCalled();
    expect(states).toEqual([false, true, false]);
  });

  it('createAgreement should always reset busy even if service throws', async () => {
    component.tenantSchema = 'moacha_atarim_app';
    adminSpy.createAgreement.and.rejectWith(new Error('fail'));

    await expectAsync(component.createAgreement()).toBeRejected();
    expect(component.busy()).toBeFalse();
  });

  it('toggleAccordion should open, and lazy-load versions once', async () => {
    component.tenantSchema = 'moacha_atarim_app';
    const a: any = { id: 'ag1', _open: false, _versions: [] };

    await component.toggleAccordion(a);

    expect(a._open).toBeTrue();
    expect(adminSpy.listVersions).toHaveBeenCalledWith('moacha_atarim_app', 'ag1');
    expect(a._versions).toEqual([{ version: 1 }, { version: 2 }]);

    adminSpy.listVersions.calls.reset();

    await component.toggleAccordion(a); // close
    await component.toggleAccordion(a); // open again (already loaded)
    expect(adminSpy.listVersions).not.toHaveBeenCalled();
  });

  it('onPdfPick should do nothing when no file in event', async () => {
    component.tenantSchema = 'moacha_atarim_app';
    await component.onPdfPick({ target: { files: [] } }, 'CODE');
    expect(adminSpy.uploadPdf).not.toHaveBeenCalled();
  });

  it('onPdfPick should upload pdf and set newVersion.pdfPath', async () => {
    component.tenantSchema = 'moacha_atarim_app';
    const file = new File([new Blob(['x'], { type: 'application/pdf' })], 'a.pdf', { type: 'application/pdf' });

    adminSpy.uploadPdf.and.resolveTo('agreements/CODE/next/a.pdf');

    await component.onPdfPick({ target: { files: [file] } }, 'CODE');

    expect(adminSpy.uploadPdf).toHaveBeenCalledWith('moacha_atarim_app', 'CODE', 'next', file);
    expect(component.newVersion.pdfPath).toBe('agreements/CODE/next/a.pdf');
  });

  it('addVersion should send correct payload, reset newVersion and refresh', async () => {
    component.tenantSchema = 'moacha_atarim_app';
    component.newVersion = {
      severity: 'minor',
      effective_from: '2026-01-01',
      body_md: 'md',
      pdfPath: 'path/to.pdf',
      publish_now: true,
    };

    await component.addVersion('CODE');

    const args = adminSpy.addVersion.calls.mostRecent().args[0];
    expect(args).toEqual(
      jasmine.objectContaining({
        tenantSchema: 'moacha_atarim_app',
        agreementCode: 'CODE',
        severity: 'minor',
        bodyMd: 'md',
        storagePath: 'path/to.pdf',
        publishNow: true,
      })
    );
    expect(typeof args.effectiveFrom).toBe('string');

    expect(component.newVersion).toEqual({
      severity: 'major',
      effective_from: '',
      body_md: '',
      pdfPath: '',
      publish_now: true,
    });

    expect(adminSpy.listAgreements).toHaveBeenCalled();
  });

  it('publishVersion should call service and refresh', async () => {
    component.tenantSchema = 'moacha_atarim_app';
    await component.publishVersion('CODE', 3);

    expect(adminSpy.publishVersion).toHaveBeenCalledWith('moacha_atarim_app', 'CODE', 3);
    expect(adminSpy.listAgreements).toHaveBeenCalled();
  });

  it('archiveAgreement should call service and refresh', async () => {
    component.tenantSchema = 'moacha_atarim_app';
    await component.archiveAgreement('CODE');

    expect(adminSpy.archiveAgreement).toHaveBeenCalledWith('moacha_atarim_app', 'CODE');
    expect(adminSpy.listAgreements).toHaveBeenCalled();
  });

  it('saveTarget should call setTarget with current target', async () => {
    component.tenantSchema = 'moacha_atarim_app';
    component.target = { activityTag: 'riding', minChildAge: 6, maxChildAge: 18, required: true };

    await component.saveTarget('CODE');

    expect(adminSpy.setTarget).toHaveBeenCalledWith('moacha_atarim_app', 'CODE', component.target);
  });

  it('all actions should no-op when tenantSchema missing', async () => {
    component.tenantSchema = undefined;

    await component.refresh();
    await component.createAgreement();
    await component.onPdfPick({ target: { files: [new File(['x'], 'a.pdf')] } }, 'CODE');
    await component.addVersion('CODE');
    await component.publishVersion('CODE', 1);
    await component.archiveAgreement('CODE');
    await component.saveTarget('CODE');

    expect(adminSpy.listAgreements).not.toHaveBeenCalled();
    expect(adminSpy.createAgreement).not.toHaveBeenCalled();
    expect(adminSpy.uploadPdf).not.toHaveBeenCalled();
    expect(adminSpy.addVersion).not.toHaveBeenCalled();
    expect(adminSpy.publishVersion).not.toHaveBeenCalled();
    expect(adminSpy.archiveAgreement).not.toHaveBeenCalled();
    expect(adminSpy.setTarget).not.toHaveBeenCalled();
  });
});
