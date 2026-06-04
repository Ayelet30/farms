import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SecretaryRiderServiceTasks } from './secretary-rider-service-tasks';

describe('SecretaryRiderServiceTasks', () => {
  let component: SecretaryRiderServiceTasks;
  let fixture: ComponentFixture<SecretaryRiderServiceTasks>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SecretaryRiderServiceTasks]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SecretaryRiderServiceTasks);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
