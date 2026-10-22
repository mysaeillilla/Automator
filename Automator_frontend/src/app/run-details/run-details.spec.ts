import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RunDetails } from './run-details';

describe('RunDetails', () => {
  let component: RunDetails;
  let fixture: ComponentFixture<RunDetails>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RunDetails],
    }).compileComponents();

    fixture = TestBed.createComponent(RunDetails);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
