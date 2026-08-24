import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GitConnector } from './git-connector';

describe('GitConnector', () => {
  let component: GitConnector;
  let fixture: ComponentFixture<GitConnector>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GitConnector],
    }).compileComponents();

    fixture = TestBed.createComponent(GitConnector);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
