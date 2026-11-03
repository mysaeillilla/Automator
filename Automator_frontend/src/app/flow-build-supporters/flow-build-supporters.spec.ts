import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FlowBuildSupporters } from './flow-build-supporters';

describe('FlowBuildSupporters', () => {
  let component: FlowBuildSupporters;
  let fixture: ComponentFixture<FlowBuildSupporters>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FlowBuildSupporters],
    }).compileComponents();

    fixture = TestBed.createComponent(FlowBuildSupporters);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
