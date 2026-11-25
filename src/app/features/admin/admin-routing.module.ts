import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AdminShellComponent } from './components/admin-shell/admin-shell.component';
import { AdminAuditPage } from './pages/audit/audit.page';
import { AdminCadastrePage } from './pages/cadastre/cadastre.page';
import { AdminDashboardPage } from './pages/dashboard/dashboard.page';
import { AdminFlagsPage } from './pages/flags/flags.page';
import { AdminReportsPage } from './pages/reports/reports.page';
import { AdminSensorsPage } from './pages/sensors/sensors.page';
import { AdminUsersPage } from './pages/users/users.page';
import { AdminVerificationsPage } from './pages/verifications/verifications.page';
import { AdminVolunteersPage } from './pages/volunteers/volunteers.page';

// Toda la sección exige rol de administrador (roleGuard en app-routing).
// La base de datos vuelve a comprobarlo en cada acción (is_admin).
const routes: Routes = [
  {
    path: '',
    component: AdminShellComponent,
    children: [
      { path: '', redirectTo: 'resumen', pathMatch: 'full' },
      { path: 'resumen', component: AdminDashboardPage, data: { title: 'Resumen', subtitle: 'Cómo va la plataforma: actividad, resolución, participación y lo que está pendiente.' } },
      { path: 'usuarios', component: AdminUsersPage, data: { title: 'Usuarios', subtitle: 'Busca cuentas, revisa su actividad, cambia roles y bloquea a quien abuse.' } },
      { path: 'reportes', component: AdminReportsPage, data: { title: 'Reportes', subtitle: 'Todos los reportes con su autor real (incluso los anónimos), moderación en lote y exportación.' } },
      { path: 'denuncias', component: AdminFlagsPage, data: { title: 'Denuncias', subtitle: 'Contenido marcado por la comunidad. Un comentario con 3 denuncias se oculta solo hasta que lo revises.' } },
      { path: 'verificaciones', component: AdminVerificationsPage, data: { title: 'Verificaciones', subtitle: 'Revisa la documentación oficial antes de conceder permisos de organización o institución.' } },
      { path: 'voluntarios', component: AdminVolunteersPage, data: { title: 'Voluntarios', subtitle: 'Personas que pidieron ser voluntarias. Al aprobarlas pueden sumarse a soluciones y jornadas.' } },
      { path: 'sensores', component: AdminSensorsPage, data: { title: 'Sensores', subtitle: 'Sensores urbanos que crean reportes solos cuando una medición pasa su límite.' } },
      { path: 'catastro', component: AdminCadastrePage, data: { title: 'Catastro', subtitle: 'Zonas oficiales para saber si cada problema está en terreno público, privado o protegido.' } },
      { path: 'auditoria', component: AdminAuditPage, data: { title: 'Auditoría', subtitle: 'Registro inalterable de cada acción de la administración.' } },
    ],
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class AdminRoutingModule {}
