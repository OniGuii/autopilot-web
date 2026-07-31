import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FollowUpService } from './follow-up.service';

/**
 * Scaffold only — no business endpoints in the foundation stage.
 */
@ApiTags('follow-up')
@Controller('follow-up')
export class FollowUpController {
  constructor(private readonly followUpService: FollowUpService) {}
}
