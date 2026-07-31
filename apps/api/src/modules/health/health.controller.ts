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
  @ApiOperation({ summary: 'Liveness probe (prepared)' })
  getLive() {
    return this.healthService.getLive();
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe (prepared)' })
  getReady() {
    return this.healthService.getReady();
  }
}
