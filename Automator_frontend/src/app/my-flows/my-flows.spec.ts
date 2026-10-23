import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MyFlows } from './my-flows';

describe('MyFlows', () => {
  let component: MyFlows;
  let fixture: ComponentFixture<MyFlows>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MyFlows],
    }).compileComponents();

    fixture = TestBed.createComponent(MyFlows);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
