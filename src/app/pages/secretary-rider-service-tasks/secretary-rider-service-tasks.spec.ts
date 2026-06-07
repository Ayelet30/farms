import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SecretaryRiderServiceTasksComponent } from './secretary-rider-service-tasks';

describe('SecretaryRiderServiceTasks', () => {
  let component: SecretaryRiderServiceTasksComponent;
  let fixture: ComponentFixture<SecretaryRiderServiceTasksComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SecretaryRiderServiceTasksComponent]
    })
      .compileComponents();

    fixture = TestBed.createComponent(SecretaryRiderServiceTasksComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
