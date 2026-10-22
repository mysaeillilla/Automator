import { Component, signal } from '@angular/core';
import { environment } from '../../environments/environment.development';

@Component({
  imports: [],
  selector: 'app-header',
  styleUrl: './header.css',
  templateUrl: './header.html',
})
export class Header {


  readonly appName = 'Automator';
  readonly environmentLabel = 'Environments';
  readonly environmentName = signal('Default Directory (default)');
  readonly searchTerm = signal('');

  // Available if you later want to call the backend from this component
  private readonly apiUrl = environment.apiUrl;

  onSearch(event: Event): void {
    this.searchTerm.set((event.target as HTMLInputElement).value);
  }
}
