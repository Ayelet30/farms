import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SecretaryParents } from './secretary-parents';

describe('SecretaryParents', () => {
  let component: SecretaryParents;
  let fixture: ComponentFixture<SecretaryParents>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SecretaryParents]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SecretaryParents);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
