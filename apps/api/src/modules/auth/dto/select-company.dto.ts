import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class SelectCompanyDto {
  @ApiProperty({
    example: 'demo-concessionaria',
    description:
      'Company slug. Validated against caller Membership — never trust companyId from client.',
  })
  @IsString()
  @MinLength(1)
  companySlug!: string;
}
