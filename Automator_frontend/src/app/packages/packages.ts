import { Component, ElementRef, inject, OnInit, signal, viewChild } from '@angular/core';
import { PackageService } from '../package';
import { PackageResponse } from '../package/package-module';
import { HttpErrorResponse } from '@angular/common/http';


@Component({
  imports: [],
  selector: 'app-packages',
  styleUrl: './packages.css',
  templateUrl: './packages.html',
})
export class Packages  implements OnInit{


  private readonly packageService = inject(PackageService);
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  readonly packages = signal<PackageResponse[]>([]);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly expandedId = signal<number | null>(null);

  readonly selectedFile = signal<File | null>(null);
  readonly uploading = signal(false);
  readonly uploadError = signal<string | null>(null);
  readonly uploadSuccess = signal<string | null>(null);

  ngOnInit(): void {
    this.loadPackages();
  }

  loadPackages(): void {
    this.loading.set(true);
    this.loadError.set(null);

    this.packageService.getAll().subscribe({
      next: (data) => {
        this.packages.set(data);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.loadError.set(this.toMessage(err, 'Could not load packages.'));
        this.loading.set(false);
      },
    });
  }

  toggle(id: number): void {
    this.expandedId.update((current) => (current === id ? null : id));
  }

  entries(record: Record<string, string>): [string, string][] {
    return Object.entries(record);
  }

  onFileSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0] ?? null;
    this.uploadError.set(null);
    this.uploadSuccess.set(null);

    if (file && !file.name.toLowerCase().endsWith('.zip')) {
      this.selectedFile.set(null);
      this.uploadError.set('Only .zip files are supported.');
      this.clearInput();
      return;
    }
    this.selectedFile.set(file);
  }

  upload(): void {
    const file = this.selectedFile();
    if (!file || this.uploading()) return;

    this.uploading.set(true);
    this.uploadError.set(null);
    this.uploadSuccess.set(null);

    this.packageService.upload(file).subscribe({
      next: () => {
        this.uploadSuccess.set(`${file.name} uploaded successfully.`);
        this.uploading.set(false);
        this.selectedFile.set(null);
        this.clearInput();
        this.loadPackages();
      },
      error: (err: HttpErrorResponse) => {
        this.uploadError.set(this.toMessage(err, 'Upload failed.'));
        this.uploading.set(false);
      },
    });
  }

  private clearInput(): void {
    const input = this.fileInput()?.nativeElement;
    if (input) input.value = '';
  }

  // Handles ProblemDetails objects, plain-text bodies, and network errors
  private toMessage(err: HttpErrorResponse, fallback: string): string {
    if (err.status === 0) return 'Cannot reach the server.';
    const body = err.error;
    if (typeof body === 'string' && body.length > 0) return body;
    if (body?.detail) return body.detail;
    if (body?.title) return body.title;
    return fallback;
  }


}
