// src/app/pages/farm-settings/farm-settings.component.spec.ts
import { TestBed } from '@angular/core/testing';
import { FarmSettingsComponent } from './farm-settings.component';
import { UiDialogService } from '../../services/ui-dialog.service';
import { setDbTenantForTests, resetDbForTests } from '../../services/supabaseClient.service';

function createQueryMock() {
  const q: any = {
    schema: jasmine.createSpy('schema').and.callFake(() => q),
    from: jasmine.createSpy('from').and.callFake(() => q),
    select: jasmine.createSpy('select').and.callFake(() => q),
    order: jasmine.createSpy('order').and.callFake(() => q),
    eq: jasmine.createSpy('eq').and.callFake(() => q),
    maybeSingle: jasmine.createSpy('maybeSingle').and.callFake(() => q),
    insert: jasmine.createSpy('insert').and.callFake(() => q),
    update: jasmine.createSpy('update').and.callFake(() => q),
    delete: jasmine.createSpy('delete').and.callFake(() => q),
    upsert: jasmine.createSpy('upsert').and.callFake(() => q),
    rpc: jasmine.createSpy('rpc').and.resolveTo({ data: null, error: null }),
    single: jasmine.createSpy('single').and.resolveTo({ data: null, error: null }),
  };

  // ברירת מחדל: מחזירים "הכל בסדר ואין נתונים"
  q.then = undefined; // שלא יתבלבלו עם Promise
  return q;
}

function createSupabaseMock() {
  const q = createQueryMock();

  // נרצה להחזיר תוצאות שונות לפי הטבלה
  q.select.and.callFake((_: any) => q);

  // ברירת מחדל לכל הקריאות: {data:[], error:null}
  q.order.and.callFake(() => q);

  // helper: להגדיר מה יחזור מהקריאה האחרונה (single/maybeSingle/insert וכו')
  const setResolve = (methodName: string, value: any) => {
    (q as any)[methodName].and.resolveTo(value);
  };

  // ברירות מחדל
  setResolve('maybeSingle', { data: null, error: null });
  setResolve('single', { data: null, error: null });

  // insert/update/delete/upsert לרוב לא קוראים directly resolve, אז נחזיר אובייקט עם select().single()
  q.insert.and.callFake(() => ({
    select: () => ({
      single: () => Promise.resolve({ data: { id: 999, note: 'x' }, error: null }),
    }),
  }));

  q.update.and.callFake(() => ({
    eq: () => ({
      select: () => ({
        single: () => Promise.resolve({ data: { id: 1, note: 'updated' }, error: null }),
      }),
    }),
  }));

  q.delete.and.callFake(() => ({
    eq: () => Promise.resolve({ error: null }),
  }));

  q.upsert.and.callFake(() => ({
    select: () => ({
      single: () => Promise.resolve({ data: {}, error: null }),
    }),
  }));

  const supabase: any = {
    schema: (name: string) => {
      // חשוב: לא לשבור אם קוראים schema('moacha_atarim_app')
      return {
        from: (_table: string) => q,
      };
    },
    from: (_table: string) => q,
    rpc: q.rpc,
  };

  return { supabase, q };
}

describe('FarmSettingsComponent - Structured Notes', () => {
  let ui: jasmine.SpyObj<UiDialogService>;
  let supa: ReturnType<typeof createSupabaseMock>;

 beforeEach(async () => {
  supa = createSupabaseMock();

  setDbTenantForTests(() => supa.supabase); 

  ui = jasmine.createSpyObj<UiDialogService>('UiDialogService', ['alert', 'confirm']);
  ui.alert.and.resolveTo();
  ui.confirm.and.resolveTo(true);

  await TestBed.configureTestingModule({
    imports: [FarmSettingsComponent],
    providers: [{ provide: UiDialogService, useValue: ui }],
  }).compileComponents();
});

afterEach(() => {
  resetDbForTests(); 
});


  it('loadListNotes: טוען הערות מהטבלה list_notes', async () => {
    // מסדרים שהשאילתה תחזיר רשימה
    const list = [
      { id: 1, note: 'התקדמת יפה' },
      { id: 2, note: 'היה מצוין' },
    ];

    // נגרום ל- select/order להחזיר Promise בסוף השרשרת
    supa.q.order.and.callFake(() => Promise.resolve({ data: list, error: null }));

    const fixture = TestBed.createComponent(FarmSettingsComponent);
    const cmp = fixture.componentInstance;

    await cmp.loadListNotes();

    expect(cmp.listNotes().length).toBe(2);
    expect(cmp.listNotes()[0].note).toBe('התקדמת יפה');
  });

  it('addListNote: מוסיף הודעה ומעדכן את ה-signal', async () => {
    const fixture = TestBed.createComponent(FarmSettingsComponent);
    const cmp = fixture.componentInstance;

    cmp.newListNoteText.set('הודעה חדשה');

    // insert כבר מחזיר {id:999,note:'x'} אבל נעדכן שיהיה תואם
    supa.q.insert.and.callFake(() => ({
      select: () => ({
        single: () => Promise.resolve({ data: { id: 3, note: 'הודעה חדשה' }, error: null }),
      }),
    }));

    await cmp.addListNote();

    expect(cmp.listNotes().some(x => x.note === 'הודעה חדשה')).toBeTrue();
    expect(ui.alert).not.toHaveBeenCalledWith('הוספת הודעה נכשלה.', 'שגיאה');
  });

  it('addListNote: אם ריק — מציג alert', async () => {
    const fixture = TestBed.createComponent(FarmSettingsComponent);
    const cmp = fixture.componentInstance;

    cmp.newListNoteText.set('   ');

    await cmp.addListNote();

    expect(ui.alert).toHaveBeenCalled();
    expect(cmp.listNotes().length).toBe(0);
  });

  it('deleteListNote: מוחק ומסיר מהרשימה', async () => {
    const fixture = TestBed.createComponent(FarmSettingsComponent);
    const cmp = fixture.componentInstance;

    cmp.listNotes.set([
      { id: 1, note: 'א' },
      { id: 2, note: 'ב' },
    ]);

    await cmp.deleteListNote({ id: 1, note: 'א' });

    expect(cmp.listNotes().length).toBe(1);
    expect(cmp.listNotes()[0].id).toBe(2);
  });
});
