import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SecretaryInstructorsComponent } from './secretary-instructors.component';
import { MatDialog } from '@angular/material/dialog';
import { MailService } from '../../services/mail.service';
import { CreateUserService } from '../../services/create-user.service';

describe('SecretaryInstructorsComponent', () => {
  let component: SecretaryInstructorsComponent;
  let fixture: ComponentFixture<SecretaryInstructorsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SecretaryInstructorsComponent],
      providers: [
        { provide: MatDialog, useValue: {} },
        { provide: MailService, useValue: {} },
        { provide: CreateUserService, useValue: {} },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SecretaryInstructorsComponent);
    component = fixture.componentInstance;

    // 🔥 קריטי – למנוע הרצה של ngOnInit (שקורא ל-ensureTenantContextReady)
    spyOn(component, 'ngOnInit').and.stub();

    fixture.detectChanges();
  });

  // =========================
  // בסיס
  // =========================

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // =========================
  // helpers / labels
  // =========================

  it('dayOfWeekToLabel should return correct hebrew label', () => {
    expect(component.dayOfWeekToLabel(1)).toBe('ראשון');
    expect(component.dayOfWeekToLabel(5)).toBe('חמישי');
    expect(component.dayOfWeekToLabel(7)).toBe('שבת');
    expect(component.dayOfWeekToLabel(null)).toBe('—');
  });

  it('lessonTypeLabel should map lesson type correctly', () => {
    expect(component.lessonTypeLabel('both')).toBe('בודד או זוגי');
    expect(component.lessonTypeLabel('double_only')).toBe('זוגי בלבד');
    expect(component.lessonTypeLabel('break')).toBe('הפסקה');
    expect(component.lessonTypeLabel('unknown')).toBe('—');
  });

  it('ridingTypeName should resolve name or fallback', () => {
    component.ridingTypes = [
      { id: 'rt1', name: 'רכיבה טיפולית' },
    ];

    expect(component.ridingTypeName('rt1')).toBe('רכיבה טיפולית');
    expect(component.ridingTypeName('x')).toBe('—');
    expect(component.ridingTypeName(null)).toBe('—');
  });

  // =========================
  // filters
  // =========================

  it('filteredInstructors should filter by name', () => {
    component.instructors = [
      { id_number: '1', first_name: 'דנה', last_name: 'כהן' },
      { id_number: '2', first_name: 'אורי', last_name: 'לוי' },
    ];

    component.searchText = 'דנה';
    component.searchMode = 'name';

    const res = component.filteredInstructors;
    expect(res.length).toBe(1);
    expect(res[0].first_name).toBe('דנה');
  });

  it('filteredInstructors should filter by exact id', () => {
    component.instructors = [
      { id_number: '111', first_name: 'א', last_name: 'ב' },
      { id_number: '222', first_name: 'ג', last_name: 'ד' },
    ];

    component.searchText = '222';
    component.searchMode = 'id';

    const res = component.filteredInstructors;
    expect(res.length).toBe(1);
    expect(res[0].id_number).toBe('222');
  });

  it('filteredInstructors should filter by gender female', () => {
    component.instructors = [
      { id_number: '1', first_name: 'א', last_name: 'ב', gender: 'זכר' },
      { id_number: '2', first_name: 'ג', last_name: 'ד', gender: 'נקבה' },
    ];

    component.genderFilter = 'female';

    const res = component.filteredInstructors;
    expect(res.length).toBe(1);
    expect(res[0].gender).toContain('נקבה');
  });

  // =========================
  // status & notify
  // =========================

  it('normalizeStatus should normalize various inputs', () => {
    expect((component as any).normalizeStatus('פעיל')).toBe('Active');
    expect((component as any).normalizeStatus('inactive')).toBe('Inactive');
    expect((component as any).normalizeStatus(undefined)).toBe('Active');
  });

  it('statusLabel should return hebrew label', () => {
    expect(component.statusLabel('Active')).toBe('פעיל');
    expect(component.statusLabel('Inactive')).toBe('לא פעיל');
    expect(component.statusLabel(null)).toBe('—');
  });

  it('getNotifyLabel should build combined label', () => {
    const notify = { email: true, sms: false, whatsapp: true };
    expect(component.getNotifyLabel(notify)).toBe('דוא״ל, WhatsApp');
    expect(component.getNotifyLabel(null)).toBe('—');
  });

  // =========================
  // taught genders
  // =========================

  it('hasTaughtGender should detect taught gender', () => {
    component.editModel = {
      id_number: '1',
      first_name: 'א',
      last_name: 'ב',
      taught_child_genders: ['זכר'],
    };

    expect(component.hasTaughtGender('זכר')).toBeTrue();
    expect(component.hasTaughtGender('נקבה')).toBeFalse();
  });

  it('onTaughtGenderChange should add and remove gender', () => {
    component.editModel = {
      id_number: '1',
      first_name: 'א',
      last_name: 'ב',
      taught_child_genders: [],
    };

    component.onTaughtGenderChange('נקבה', true);
    expect(component.editModel.taught_child_genders).toContain('נקבה');

    component.onTaughtGenderChange('נקבה', false);
    expect(component.editModel.taught_child_genders).not.toContain('נקבה');
  });
});
