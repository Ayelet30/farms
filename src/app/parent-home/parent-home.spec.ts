import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ParentHome } from './parent-home';

describe('ParentHome', () => {
  let component: ParentHome;
  let fixture: ComponentFixture<ParentHome>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ParentHome]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ParentHome);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
