import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class AssignLeadDto {
  @ApiProperty({
    description:
      'User id that will own the lead (must have ACTIVE membership in company)',
  })
  @IsUUID()
  ownerId!: string;
}
