import { AvailabilityTabComponent } from './availability-tab';
import { ChangeDetectorRef } from '@angular/core';

fdescribe('AvailabilityTabComponent – validation', () => {

  let component: AvailabilityTabComponent;

  beforeEach(() => {
    component = new AvailabilityTabComponent(
      {} as ChangeDetectorRef,
      {} as any
    );

    component.farmStart = '08:00';
    component.farmEnd = '17:00';

    component.days = [
      {
        key: 'sun',
        label: 'ראשון',
        active: true,
        slots: [],
      },
    ];
  });

  function createSlot(overrides?: Partial<any>) {
    return {
      start: null,
      end: null,
      ridingTypeId: null,
      hasError: false,
      errorMessage: null,
      ...overrides,
    };
  }

  it('❌ should error when end <= start', () => {
    const slot = createSlot({
      start: '10:00',
      end: '09:00',
      ridingTypeId: 'rt1',
    });

    component.days[0].slots = [slot];

    component.onTimeBlur(component.days[0], slot);

    expect(slot.hasError).toBeTrue();
    expect(slot.errorMessage).toContain('שעת סיום');
  });

  it('❌ should error when outside farm hours', () => {
    const slot = createSlot({
      start: '07:00',
      end: '09:00',
      ridingTypeId: 'rt1',
    });

    component.days[0].slots = [slot];

    component.onTimeBlur(component.days[0], slot);

    expect(slot.hasError).toBeTrue();
    expect(slot.errorMessage).toContain('08:00');
  });

  it('❌ should error when riding type missing', () => {
    const slot = createSlot({
      start: '10:00',
      end: '11:00',
      ridingTypeId: null,
    });

    component.days[0].slots = [slot];

    component.onTimeBlur(component.days[0], slot);

    expect(slot.hasError).toBeTrue();
    expect(slot.errorMessage).toContain('סוג רכיבה');
  });

  it('✅ should be valid for correct slot', () => {
    const slot = createSlot({
      start: '10:00',
      end: '11:00',
      ridingTypeId: 'rt1',
    });

    component.days[0].slots = [slot];

    component.onTimeBlur(component.days[0], slot);

    expect(slot.hasError).toBeFalse();
    expect(slot.errorMessage).toBeNull();
  });
});
