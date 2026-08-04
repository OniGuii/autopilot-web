import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuditModule } from '../audit/audit.module';
import { AccessPrincipalService } from './access-principal.service';
import { AuthController } from './auth.controller';
import { AuthRevocationService } from './auth-revocation.service';
import { AuthService } from './auth.service';
import { CompanyContextGuard } from './guards/company-context.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    AuditModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const expiresIn = config.get<string>('jwt.accessTtl', '15m');
        return {
          // P0: secret validated at boot (required outside test; no insecure fallback).
          secret: config.getOrThrow<string>('jwt.accessSecret'),
          signOptions: {
            // nest/jsonwebtoken StringValue — keep as configured TTL string
            expiresIn: expiresIn as `${number}${'s' | 'm' | 'h' | 'd'}`,
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AccessPrincipalService,
    AuthRevocationService,
    JwtStrategy,
    JwtAuthGuard,
    CompanyContextGuard,
    RolesGuard,
  ],
  exports: [
    AuthService,
    AccessPrincipalService,
    AuthRevocationService,
    JwtModule,
    PassportModule,
    JwtAuthGuard,
    CompanyContextGuard,
    RolesGuard,
  ],
})
export class AuthModule {}
