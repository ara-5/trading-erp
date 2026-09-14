import { Controller, Get, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtSignOptions } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AccountingModule } from './accounting/accounting.module';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuard, Public } from './common/auth';
import { CommonModule } from './common/common.module';
import { CopilotModule } from './copilot/copilot.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { HrModule } from './hr/hr.module';
import { InventoryModule } from './inventory/inventory.module';
import { PrismaModule } from './prisma/prisma.service';
import { PurchasingModule } from './purchasing/purchasing.module';
import { SalesModule } from './sales/sales.module';

@Controller('health')
class HealthController {
  @Public()
  @Get()
  health() {
    return { status: 'ok', demo: process.env.DEMO_MODE === 'true', time: new Date().toISOString() };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.get('ACCESS_TOKEN_TTL', '15m') as JwtSignOptions['expiresIn'] },
      }),
    }),
    // Generous global limit per client IP; login has its own stricter limit.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: () => Number(process.env.RATE_LIMIT ?? 600) }]),
    PrismaModule,
    CommonModule,
    AuthModule,
    AdminModule,
    AccountingModule,
    InventoryModule,
    PurchasingModule,
    SalesModule,
    HrModule,
    DashboardModule,
    CopilotModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
