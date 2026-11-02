import { Routes } from '@angular/router';
import { Packages } from './packages/packages';
import { Activity } from './activity/activity';
import { MyFlows } from './my-flows/my-flows';
import { FlowBuilderComponent } from './flow-builder/flow-builder';
import { CreateNewFlow } from './create-new-flow/create-new-flow';
import { Workflow } from './workflow/workflow';

export const routes: Routes = [

  { path: 'packages', component: Packages },
  { path: '', component: Packages },
  { path: 'history', component: Activity },
  { path: 'myflows', component: MyFlows },
  { path: 'createflow', component: FlowBuilderComponent },
  { path: 'myflows/:id', component: FlowBuilderComponent },
  { path: 'myflows1', component: CreateNewFlow },
  { path: 'myflows2', component: Workflow },
  { path: 'myflows2/:id', component: Workflow },

{
  path: 'my-flows/:id',
  loadComponent: () => import('./flow-details/flow-details').then((m) => m.FlowDetails),
},




];
