import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Application health check' })
  getHealth() {
    return this.healthService.getHealth();
  }

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe (process up)' })
  getLive() {
    return this.healthService.getLive();
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe (Postgres + Redis)' })
  getReady() {
    return this.healthService.getReady();
  }
}
