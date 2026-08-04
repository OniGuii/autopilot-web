import { ApiProperty } from '@nestjs/swagger';
import { MembershipRole } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateMembershipDto {
  @ApiProperty({ enum: MembershipRole })
  @IsEnum(MembershipRole)
  role!: MembershipRole;
}
