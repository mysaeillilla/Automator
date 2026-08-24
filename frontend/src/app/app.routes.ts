import { Routes } from '@angular/router';
import { HomeComponent } from './home-component/home-component';
import { Login } from './login/login';
import { UserManagement } from './user-management/user-management';
import { AdminPanel } from './admin-panel/admin-panel';
import { DepartmentsComponent } from './departments-component/departments-component';
import { ProcessDetailsComponent } from './process-details-component/process-details-component';
import { AuditlogComponent } from './auditlog-component/auditlog-component';
import { Departments } from './departments/departments';
import { SchedulesComponent } from './schedules-component/schedules-component';
import { GitConnector } from './git-connector/git-connector';
import { RepoList } from './repo-list/repo-list';
import { GithubRepositories } from './github-repositories/github-repositories';

export const routes: Routes = [

  {path:'',
    component:HomeComponent
  },

  {path:'login',
    component:Login
  },
  {path:'users',
    component:UserManagement
  },
  {path:'control-panel',
    component:AdminPanel
  },
{ path: 'admin', component: AdminPanel },
  { path: 'departments/:id', component: DepartmentsComponent },
  { path: 'process/process-list', component: ProcessDetailsComponent },
  { path: 'history', component: AuditlogComponent },
  { path: 'departments', component: Departments },
  { path: 'schedules', component: SchedulesComponent },
  { path: 'git', component: GitConnector },
  { path: 'git/repos', component: RepoList },
  { path: 'git/repos1', component: GithubRepositories },





];
