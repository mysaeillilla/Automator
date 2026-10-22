import { TestBed } from '@angular/core/testing';
import { WorkflowExecutionHistory } from './workflow-execution-history';

describe('WorkflowExecutionHistory', () => {
  let service: WorkflowExecutionHistory;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(WorkflowExecutionHistory);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
