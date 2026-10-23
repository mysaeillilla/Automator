import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FlowBuilder } from './flow-builder';

describe('FlowBuilder', () => {
  let component: FlowBuilder;
  let fixture: ComponentFixture<FlowBuilder>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FlowBuilder],
    }).compileComponents();

    fixture = TestBed.createComponent(FlowBuilder);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
