import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FlowBuilderComponent } from './flow-builder';

describe('FlowBuilder', () => {
  let component: FlowBuilderComponent;
  let fixture: ComponentFixture<FlowBuilderComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FlowBuilderComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(FlowBuilderComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
