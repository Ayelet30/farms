import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ParentPaymentsComponent } from './parent-payments.component';
import { TranzilaService } from '../../services/tranzila.service';
import { PaymentsService } from '../../services/payments.service';
import { CurrentUserService } from '../../core/auth/current-user.service';
import { TenantBootstrapService } from '../../services/tenant-bootstrap.service';
import { ParentPaymentsDbService } from '../../services/parent-payments-db.service';


declare const globalThis: any;

describe('ParentPaymentsComponent', () => {
  let fixture: ComponentFixture<ParentPaymentsComponent>;
  let component: ParentPaymentsComponent;

  const tranzilaSpy = {
    getHandshakeToken: jasmine.createSpy('getHandshakeToken'),
    savePaymentMethod: jasmine.createSpy('savePaymentMethod'),
  } as any;

  const pagosSpy = {
    listProfiles: jasmine.createSpy('listProfiles'),
    listProviderCharges: jasmine.createSpy('listProviderCharges'),
    setDefault: jasmine.createSpy('setDefault'),
  } as any;

  const bootSpy = {
    ensureReady: jasmine.createSpy('ensureReady').and.resolveTo(),
    getFarmMetaSync: jasmine.createSpy('getFarmMetaSync').and.returnValue({ schema_name: 'moacha_atarim_app' }),
  } as any;

  const cuStub = {
    current: { uid: 'parent-1', email: 'p1@test.com' },
  } as any;

  // minimal "query builder" mock for refreshInvoices
  const makeDbMock = (result: { data: any[] | null; error: any | null }) => {
    const q: any = {};
    q.select = jasmine.createSpy('select').and.returnValue(q);
    q.eq = jasmine.createSpy('eq').and.returnValue(q);
    q.not = jasmine.createSpy('not').and.returnValue(q);
    q.order = jasmine.createSpy('order').and.returnValue(q);
    q.limit = jasmine.createSpy('limit').and.resolveTo(result);
    return {
      from: jasmine.createSpy('from').and.returnValue(q),
      _q: q,
    };
  };

  let dbSvc: any;

  beforeEach(async () => {
    // reset calls
    Object.values(tranzilaSpy).forEach((s: any) => s?.calls?.reset?.());
    Object.values(pagosSpy).forEach((s: any) => s?.calls?.reset?.());
    Object.values(bootSpy).forEach((s: any) => s?.calls?.reset?.());

    // defaults
    tranzilaSpy.getHandshakeToken.and.resolveTo({ thtk: 'thtk-1' });
    tranzilaSpy.savePaymentMethod.and.resolveTo({ ok: true, is_default: true });

    pagosSpy.listProfiles.and.resolveTo([
      { id: 'pr1', brand: 'VISA', last4: '1111', is_default: true, created_at: '2026-01-01T00:00:00Z' },
      { id: 'pr2', brand: 'MC', last4: '2222', is_default: false, created_at: '2026-01-02T00:00:00Z' },
    ]);

    pagosSpy.listProviderCharges.and.resolveTo([
      // should be filtered out
      { id: 'c1', status: 'draft', amount_agorot: 1000, created_at: '2026-01-03T00:00:00Z', provider_id: null },
      // should pass
      { id: 'c2', status: 'succeeded', amount_agorot: 1234, created_at: '2026-01-04T00:00:00Z', provider_id: 'prov' },
      { id: 'c3', status: 'Paid', amount_agorot: 500, created_at: '2026-01-05T00:00:00Z', provider_id: null },
      { id: 'c4', status: 'SUCCESS', amount_agorot: 777, created_at: '2026-01-06T00:00:00Z', provider_id: null },
    ]);

    const dbMock = makeDbMock({
      data: [
        { id: 'p1', amount: 12.5, date: '2026-01-10', method: 'credit', invoice_url: 'https://x/1' },
      ],
      error: null,
    });

    dbSvc = { db: jasmine.createSpy('db').and.returnValue(dbMock) };
    

    await TestBed.configureTestingModule({
      imports: [ParentPaymentsComponent],
      providers: [
        { provide: TranzilaService, useValue: tranzilaSpy },
        { provide: PaymentsService, useValue: pagosSpy },
        { provide: CurrentUserService, useValue: cuStub },
        { provide: TenantBootstrapService, useValue: bootSpy },
        { provide: ParentPaymentsDbService, useValue: dbSvc },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ParentPaymentsComponent);
    component = fixture.componentInstance;

    // לא עושים detectChanges כדי לא להריץ ngOnInit אוטומטית
  });

  it('should create and initialize parent info from CurrentUserService', () => {
    expect(component).toBeTruthy();
    expect(component.parentUid).toBe('parent-1');
    expect(component.parentEmail).toBe('p1@test.com');
  });

  it('ngOnInit success should refreshAll and set loading=false', async () => {
    await component.ngOnInit();

    expect(component.loading()).toBeFalse();
    expect(component.error()).toBeNull();

    expect(pagosSpy.listProfiles).toHaveBeenCalledWith('parent-1');
    expect(pagosSpy.listProviderCharges).toHaveBeenCalledWith('parent-1', 50);

    // invoices loaded
    expect(dbSvc.db).toHaveBeenCalled();
    expect(component.invoices().length).toBe(1);
  });

  it('ngOnInit missing uid should set error and loading=false', async () => {
    // create a new component with missing uid
    const cuNoUid = { current: { uid: '', email: 'x@test.com' } } as any;

    await TestBed.resetTestingModule()
      .configureTestingModule({
        imports: [ParentPaymentsComponent],
        providers: [
          { provide: TranzilaService, useValue: tranzilaSpy },
          { provide: PaymentsService, useValue: pagosSpy },
          { provide: CurrentUserService, useValue: cuNoUid },
          { provide: TenantBootstrapService, useValue: bootSpy },
          { provide: ParentPaymentsDbService, useValue: dbSvc },
        ],
      })
      .compileComponents();

    const f2 = TestBed.createComponent(ParentPaymentsComponent);
    const c2 = f2.componentInstance;

    await c2.ngOnInit();

    expect(c2.loading()).toBeFalse();
    expect(c2.error()).toContain('missing uid');
  });

  it('refreshProfilesAndCharges should map profiles and filter charges by status', async () => {
    // call via refreshAll to hit private method indirectly
    await component.refreshAll();

    expect(component.profiles().length).toBe(2);

    const ch = component.charges();
    // should have only succeeded/paid/success (3 rows)
    expect(ch.length).toBe(3);
    expect(ch.map(x => x.id)).toEqual(['c2', 'c3', 'c4']);

    expect(ch[0].sumNis).toBe('12.34 ₪');
  });

  it('refreshProfilesAndCharges error should set error signal', async () => {
    pagosSpy.listProfiles.and.rejectWith(new Error('boom'));

    await component.refreshAll();

    expect(component.error()).toContain('boom');
  });

  it('refreshInvoices should map rows and not set error', async () => {
    await component.refreshAll();
    const inv = component.invoices();
    expect(inv.length).toBe(1);
    expect(inv[0].id).toBe('p1');
    expect(inv[0].invoice_url).toContain('http');
  });

  it('refreshInvoices failure should console.error and set invoices=[] (not throw)', async () => {
    const badDb = makeDbMock({ data: null, error: new Error('no perm') });
    dbSvc.db.and.returnValue(badDb);

    const consoleSpy = spyOn(console, 'error');

    await component.refreshAll();

    expect(consoleSpy).toHaveBeenCalled();
    expect(component.invoices()).toEqual([]);
  });


it('setDefault success should call pagos.setDefault and refreshProfilesAndCharges', fakeAsync(() => {
  // חשוב לוודא שזה Promise
  pagosSpy.setDefault.and.resolveTo();

  component.setDefault('pr2');

  // flush await setDefault + await refreshProfilesAndCharges (Promise.all)
  tick();
  tick();

  expect(pagosSpy.setDefault).toHaveBeenCalledWith('pr2', 'parent-1');

  // במקום "toHaveBeenCalled" כללי – עדיף בדיקות מדויקות:
  expect(pagosSpy.listProfiles).toHaveBeenCalledWith('parent-1');
  expect(pagosSpy.listProviderCharges).toHaveBeenCalledWith('parent-1', 50);
}));

  it('setDefault error should set error signal', async () => {
    pagosSpy.setDefault.and.rejectWith(new Error('fail def'));
    await component.setDefault('pr2');
    expect(component.error()).toContain('fail def');
  });

  it('openAddCardModal should open and queue HF init (microtask)', fakeAsync(() => {
    // prepare a fake hosted fields factory
    const hfInstance = { charge: () => {}, onEvent: jasmine.createSpy('onEvent') };
    globalThis.TzlaHostedFields = {
      create: jasmine.createSpy('create').and.returnValue(hfInstance),
    };

    component.openAddCardModal();
    expect(component.addCardOpen()).toBeTrue();

    tick(); // flush microtasks

    expect(tranzilaSpy.getHandshakeToken).toHaveBeenCalled();
    expect(globalThis.TzlaHostedFields.create).toHaveBeenCalled();
  }));

  it('closeAddCardModal should not close when savingToken=true', () => {
    component.addCardOpen.set(true);
    component.savingToken.set(true);

    component.closeAddCardModal();

    expect(component.addCardOpen()).toBeTrue();
  });

  it('ensureAddHostedFieldsReady should set tokenError if TzlaHostedFields missing', async () => {
    globalThis.TzlaHostedFields = undefined;

    component.openAddCardModal();
    await Promise.resolve(); // microtask-ish

    // ensureAddHostedFieldsReady runs once
    // might need another tick to let handshake resolve
    await Promise.resolve();

    expect(component.tokenError()).toBeTruthy();
  });

  it('tokenizeAndSaveCard should guard when hfAdd/thtk missing', async () => {
    await component.tokenizeAndSaveCard();
    expect(component.tokenError()).toContain('שדות התשלום לא מוכנים');
  });

  it('tokenizeAndSaveCard should guard when parentUid missing', async () => {
    // build component with empty uid
    const cuNoUid = { current: { uid: '', email: 'x@test.com' } } as any;

    await TestBed.resetTestingModule()
      .configureTestingModule({
        imports: [ParentPaymentsComponent],
        providers: [
          { provide: TranzilaService, useValue: tranzilaSpy },
          { provide: PaymentsService, useValue: pagosSpy },
          { provide: CurrentUserService, useValue: cuNoUid },
          { provide: TenantBootstrapService, useValue: bootSpy },
          { provide: ParentPaymentsDbService, useValue: dbSvc },
        ],
      })
      .compileComponents();

    const f2 = TestBed.createComponent(ParentPaymentsComponent);
    const c2 = f2.componentInstance;

    // fake ready hf
    (c2 as any).hfAdd = { charge: () => {} };
    (c2 as any).thtkAdd = 'thtk';

    await c2.tokenizeAndSaveCard();
    expect(c2.tokenError()).toContain('לא זוהה הורה מחובר');
  });

  it('tokenizeAndSaveCard should guard when tenant schema missing', async () => {
    // fake ready hf
    (component as any).hfAdd = { charge: (_p: any, _cb: any) => {} };
    (component as any).thtkAdd = 'thtk';

    bootSpy.getFarmMetaSync.and.returnValue(null);

    await component.tokenizeAndSaveCard();
    expect(component.tokenError()).toContain('לא זוהתה סכמת חווה');
  });

  it('tokenizeAndSaveCard should handle HF field errors (err.messages)', fakeAsync(() => {
    // prepare DOM error elements
    ['credit_card_number', 'expiry', 'cvv'].forEach(k => {
      const div = document.createElement('div');
      div.id = 'pm_errors_for_' + k;
      document.body.appendChild(div);
    });

    bootSpy.getFarmMetaSync.and.returnValue({ schema_name: 'moacha_atarim_app' });

    const hf = {
      charge: (_p: any, cb: any) => {
        cb({ messages: [{ param: 'cvv', message: 'bad cvv' }] }, null);
      },
      onEvent: () => {},
    };
    (component as any).hfAdd = hf;
    (component as any).thtkAdd = 'thtk';

    component.tokenizeAndSaveCard();
    tick(); // allow async callback flow

    expect(component.tokenError()).toContain('שגיאה בפרטי הכרטיס');
    expect(component.savingToken()).toBeFalse();
    expect((document.getElementById('pm_errors_for_cvv') as any).textContent).toContain('bad cvv');
  }));

  it('tokenizeAndSaveCard should handle tx.success=false', fakeAsync(() => {
    const hf = {
      charge: (_p: any, cb: any) => {
        cb(null, { transaction_response: { success: false, error: 'DECLINED' } });
      },
    };
    (component as any).hfAdd = hf;
    (component as any).thtkAdd = 'thtk';

    component.tokenizeAndSaveCard();
    tick();

    expect(component.tokenError()).toContain('DECLINED');
    expect(component.savingToken()).toBeFalse();
  }));

 it('tokenizeAndSaveCard should handle missing token', fakeAsync(() => {
  bootSpy.getFarmMetaSync.and.returnValue({ schema_name: 'moacha_atarim_app' }); // ✅ חובה

  const hf = {
    charge: (_p: any, cb: any) => {
      cb(null, { transaction_response: { success: true } }); // ✅ success=true אבל בלי token
    },
  };
  (component as any).hfAdd = hf;
  (component as any).thtkAdd = 'thtk';

  component.tokenizeAndSaveCard();
  tick(); // callback runs

  expect(component.tokenError()).toContain('לא התקבל טוקן');
  expect(component.savingToken()).toBeFalse();
}));


it('tokenizeAndSaveCard success should call savePaymentMethod, refresh, and close modal', fakeAsync(() => {
  component.addCardOpen.set(true);

  bootSpy.getFarmMetaSync.and.returnValue({ schema_name: 'moacha_atarim_app' }); // ✅ חובה

  const closeSpy = spyOn(component, 'closeAddCardModal').and.callThrough();
  const refreshSpy = spyOn<any>(component, 'refreshProfilesAndCharges').and.resolveTo(); // ✅ לא אמיתי, רק שיסיים מהר

  const hf = {
    charge: (_p: any, cb: any) => {
      cb(null, {
        transaction_response: {
          success: true,
          token: 'tok123',
          credit_card_last_4_digits: '4444',
          card_type_name: 'VISA',
          expiry_month: '12',
          expiry_year: '26',
        },
      });
    },
  };

  (component as any).hfAdd = hf;
  (component as any).thtkAdd = 'thtk';

  component.tokenizeAndSaveCard();

  tick(); // charge callback
  tick(); // await ensureReady + await savePaymentMethod + await refreshProfilesAndCharges

  expect(bootSpy.ensureReady).toHaveBeenCalled();
  expect(tranzilaSpy.savePaymentMethod).toHaveBeenCalled();

  const payload = tranzilaSpy.savePaymentMethod.calls.mostRecent().args[0];
  expect(payload).toEqual(jasmine.objectContaining({
    parentUid: 'parent-1',
    tenantSchema: 'moacha_atarim_app',
    token: 'tok123',
    last4: '4444',
    brand: 'VISA',
  }));

  expect(component.tokenSaved()).toBeTrue();
  expect(refreshSpy).toHaveBeenCalled();
  expect(closeSpy).toHaveBeenCalled();
  expect(component.savingToken()).toBeFalse();
}));


  it('tokenizeAndSaveCard should handle savePaymentMethod ok=false', fakeAsync(() => {
    tranzilaSpy.savePaymentMethod.and.resolveTo({ ok: false, error: 'server refused' });

    const hf = {
      charge: (_p: any, cb: any) => {
        cb(null, { transaction_response: { success: true, token: 'tok123' } });
      },
    };
    (component as any).hfAdd = hf;
    (component as any).thtkAdd = 'thtk';

    component.tokenizeAndSaveCard();
    tick();
    tick();

    expect(component.tokenError()).toContain('server refused');
    expect(component.tokenSaved()).toBeFalse();
    expect(component.savingToken()).toBeFalse();
  }));

  it('trackById should return id', () => {
    expect(component.trackById(0, { id: 'x' })).toBe('x');
  });
});
