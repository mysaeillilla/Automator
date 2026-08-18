import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DepartmentsComponent } from './departments-component';

describe('DepartmentsComponent', () => {
  let component: DepartmentsComponent;
  let fixture: ComponentFixture<DepartmentsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DepartmentsComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(DepartmentsComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
