import { TestBed } from '@angular/core/testing';
import { Package } from './package';

describe('Package', () => {
  let service: Package;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Package);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
