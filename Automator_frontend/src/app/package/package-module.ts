import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
export interface PackageActionResponse {
  id: number;
  packageId: number;
  name: string;
  inputs: Record<string, string>;
  outputs: Record<string, string>;
}

export interface PackageResponse {
  id: number;
  name: string;
  version: string;
  filePath: string;
  dependencies: string[];
  actions: PackageActionResponse[];
}
@NgModule({
  declarations: [],
  imports: [CommonModule],
})
export class PackageModule {


}
