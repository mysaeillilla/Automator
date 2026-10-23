import { Component, input, signal } from '@angular/core';
import { JsonBlock } from '../../utils/format';

@Component({
  imports: [],
  selector: 'app-json-viewer',
  styleUrl: './json-viewer.css',
  templateUrl: './json-viewer.html',
})
export class JsonViewer {

  readonly block = input<JsonBlock | null>(null);
  readonly copied = signal(false);

  async copy(): Promise<void> {
    const block = this.block();
    if (!block) return;
    try {
      await navigator.clipboard.writeText(block.text);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    } catch {
      // Clipboard unavailable (permission denied or insecure context)
    }
  }


}
