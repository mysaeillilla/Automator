import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GithubRepositories } from './github-repositories';

describe('GithubRepositories', () => {
  let component: GithubRepositories;
  let fixture: ComponentFixture<GithubRepositories>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GithubRepositories],
    }).compileComponents();

    fixture = TestBed.createComponent(GithubRepositories);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
