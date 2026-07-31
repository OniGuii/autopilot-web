import { Injectable } from '@nestjs/common';

@Injectable()
export class HealthService {
  getHealth() {
    return {
      status: 'ok',
      service: 'autopilot-api',
      timestamp: new Date().toISOString(),
    };
  }

  getLive() {
    return {
      status: 'ok',
      check: 'live',
    };
  }

  getReady() {
    // Ready checks (DB/Redis) will be wired in a later infrastructure stage.
    return {
      status: 'ok',
      check: 'ready',
    };
  }
}
