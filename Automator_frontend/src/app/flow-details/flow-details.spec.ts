import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FlowDetails } from './flow-details';

describe('FlowDetails', () => {
  let component: FlowDetails;
  let fixture: ComponentFixture<FlowDetails>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FlowDetails],
    }).compileComponents();

    fixture = TestBed.createComponent(FlowDetails);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
