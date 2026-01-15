import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';

// ⬅️ חשוב: תתקני לשם הקובץ האמיתי אצלך
import { ParentActivitySummaryComponent, ParentActivityDeps } from './parent-activity-summary';

import * as legacyCompat from '../../services/legacy-compat';

import * as sb from '../../services/supabaseClient.service';


describe('ParentActivitySummaryComponent', () => {
  let fixture: ComponentFixture<ParentActivitySummaryComponent>;
  let component: ParentActivitySummaryComponent;

  const rpcSpy = jasmine.createSpy('rpc');
  const dbMock = { rpc: rpcSpy };
  let dbTenantSpy: jasmine.Spy;
let fetchKidsSpy: jasmine.Spy;

beforeEach(async () => {
  rpcSpy.calls.reset();

  dbTenantSpy = spyOn(ParentActivityDeps, 'dbTenant').and.returnValue(dbMock);

  fetchKidsSpy = spyOn(ParentActivityDeps, 'fetchMyChildren').and.resolveTo([
    { child_uuid: 'c1', first_name: 'Dan', last_name: 'Cohen', color: '#f00' },
    { child_id: 'c2', full_name: 'Noa Levi' },
    { id: 'c3', name: '  Yuval   Bar  ' },
    { uuid: null, name: 'bad' },
  ]);

  rpcSpy.and.resolveTo({ data: [], error: null });

  await TestBed.configureTestingModule({
    imports: [ParentActivitySummaryComponent],
  }).compileComponents();

  fixture = TestBed.createComponent(ParentActivitySummaryComponent);
  component = fixture.componentInstance;
});


  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('ngOnInit should load children and refresh', async () => {
  await component.ngOnInit();

  expect(fetchKidsSpy).toHaveBeenCalled();
  expect(dbTenantSpy).toHaveBeenCalled();
  expect(rpcSpy).toHaveBeenCalled();
  expect(component.loading()).toBeFalse();
});


  it('loadChildren should map ids and split names', async () => {
    await (component as any).loadChildren();

    const kids = component.children();
    expect(kids.length).toBe(3);

    expect(kids[0]).toEqual(jasmine.objectContaining({ child_uuid: 'c1', first_name: 'Dan', last_name: 'Cohen' }));
    expect(kids[1]).toEqual(jasmine.objectContaining({ child_uuid: 'c2', first_name: 'Noa', last_name: 'Levi' }));
    expect(kids[2]).toEqual(jasmine.objectContaining({ child_uuid: 'c3', first_name: 'Yuval', last_name: 'Bar' }));

    expect(component.selectedChildId()).toBeUndefined();
  });

  it('refresh should call rpc with year range and null p_child_ids when invalid uuid', async () => {
    component.year.set(2026);
    component.selectedChildId.set('not-a-uuid');

    await component.refresh();

    expect(rpcSpy).toHaveBeenCalledWith('get_parent_activity_from_view', {
      p_from: '2026-01-01',
      p_to: '2026-12-31',
      p_child_ids: null,
    });
  });

  it('refresh should pass p_child_ids=[uuid] only when uuid valid', async () => {
    component.year.set(2026);
    component.selectedChildId.set('11111111-1111-4111-8111-111111111111');

    await component.refresh();

    expect(rpcSpy).toHaveBeenCalledWith('get_parent_activity_from_view', {
      p_from: '2026-01-01',
      p_to: '2026-12-31',
      p_child_ids: ['11111111-1111-4111-8111-111111111111'],
    });
  });

  it('refresh should map rows and sort by date', async () => {
    rpcSpy.and.resolveTo({
      data: [
        {
          occ_date: '2026-02-10',
          start_time: '10:00:00',
          end_time: '10:45:00',
          child_id: 'c1',
          child_name: 'Dan',
          instructor_name: 'I1',
          status: 'ok',
          note_content: 'n1',
          lesson_type: 'private',
          base_price: 200,
          subsidy_amount: 50,
          discount_amount: 0,
          final_price: 150,
        },
        {
          occ_date: '2026-01-05',
          start_time: '09:00:00',
          end_time: '09:45:00',
          child_id: 'c2',
          child_name: 'Noa',
          instructor_name: 'I2',
          status: 'ok',
          note_content: '',
        },
      ],
      error: null,
    });

    await component.refresh();

    const rows = component.rows();
    expect(rows.length).toBe(2);

    expect(rows[0].date).toBe('2026-01-05');
    expect(rows[1].date).toBe('2026-02-10');

    expect(rows[0].time).toBe('09:00-09:45');
    expect(rows[1].pay_amount).toBe(150);
  });

  it('refresh error should set rows=[] and loading=false', async () => {
    const consoleSpy = spyOn(console, 'error');
    rpcSpy.and.resolveTo({ data: null, error: new Error('nope') });

    await component.refresh();

    expect(consoleSpy).toHaveBeenCalled();
    expect(component.rows()).toEqual([]);
    expect(component.loading()).toBeFalse();
  });
});
