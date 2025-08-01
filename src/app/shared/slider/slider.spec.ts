import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SliderComponent  } from './slider';

describe('Slider', () => {
  let component: SliderComponent ;
  let fixture: ComponentFixture<SliderComponent >;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SliderComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SliderComponent );
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
