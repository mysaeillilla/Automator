import { TestBed } from '@angular/core/testing';
import { Workflow } from './workflow';

describe('Workflow', () => {
  let service: Workflow;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Workflow);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
