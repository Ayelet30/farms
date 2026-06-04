import { ComponentFixture, TestBed } from '@angular/core/testing';

import { IndependentMyServices } from './independent-my-services';

describe('IndependentMyServices', () => {
  let component: IndependentMyServices;
  let fixture: ComponentFixture<IndependentMyServices>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [IndependentMyServices]
    })
    .compileComponents();

    fixture = TestBed.createComponent(IndependentMyServices);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
