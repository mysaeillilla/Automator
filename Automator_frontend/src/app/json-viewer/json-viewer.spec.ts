import { ComponentFixture, TestBed } from '@angular/core/testing';
import { JsonViewer } from './json-viewer';

describe('JsonViewer', () => {
  let component: JsonViewer;
  let fixture: ComponentFixture<JsonViewer>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [JsonViewer],
    }).compileComponents();

    fixture = TestBed.createComponent(JsonViewer);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
