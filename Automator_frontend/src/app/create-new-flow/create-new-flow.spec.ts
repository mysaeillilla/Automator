import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CreateNewFlow } from './create-new-flow';

describe('CreateNewFlow', () => {
  let component: CreateNewFlow;
  let fixture: ComponentFixture<CreateNewFlow>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CreateNewFlow],
    }).compileComponents();

    fixture = TestBed.createComponent(CreateNewFlow);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
