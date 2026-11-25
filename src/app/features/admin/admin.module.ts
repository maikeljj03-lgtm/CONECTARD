import { NgModule } from '@angular/core';
import { SharedModule } from '../../shared/shared.module';
import { AdminRoutingModule } from './admin-routing.module';
import { AdminShellComponent } from './components/admin-shell/admin-shell.component';
import { AreaChartComponent } from './components/area-chart/area-chart.component';
import { DonutChartComponent } from './components/donut-chart/donut-chart.component';
import { AdminAuditPage } from './pages/audit/audit.page';
import { AdminCadastrePage } from './pages/cadastre/cadastre.page';
import { AdminDashboardPage } from './pages/dashboard/dashboard.page';
import { AdminFlagsPage } from './pages/flags/flags.page';
import { AdminReportsPage } from './pages/reports/reports.page';
import { AdminSensorsPage } from './pages/sensors/sensors.page';
import { AdminUsersPage } from './pages/users/users.page';
import { AdminVerificationsPage } from './pages/verifications/verifications.page';
import { AdminVolunteersPage } from './pages/volunteers/volunteers.page';

/**
 * Consola de administración (RF-39 a RF-43, RF-52): resumen con métricas, usuarios (roles y bloqueo),
 * reportes, denuncias, verificaciones, voluntarios y auditoría. Solo administradores.
 */
@NgModule({
  declarations: [
    AdminShellComponent, AreaChartComponent, DonutChartComponent,
    AdminDashboardPage, AdminUsersPage, AdminReportsPage, AdminFlagsPage,
    AdminVerificationsPage, AdminVolunteersPage, AdminAuditPage, AdminSensorsPage, AdminCadastrePage,
  ],
  imports: [SharedModule, AdminRoutingModule],
})
export class AdminModule {}
