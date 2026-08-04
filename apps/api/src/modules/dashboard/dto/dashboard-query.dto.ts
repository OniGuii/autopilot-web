import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsOptional, Validate } from 'class-validator';
import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

@ValidatorConstraint({ name: 'DashboardPeriodOrder', async: false })
class DashboardPeriodOrderConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments): boolean {
    const obj = args.object as DashboardQueryDto;
    if (obj.from && obj.to) {
      return obj.from.getTime() <= obj.to.getTime();
    }
    return true;
  }

  defaultMessage(): string {
    return 'from must be less than or equal to to';
  }
}

export class DashboardQueryDto {
  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Inclusive period start (filters createdAt of scoped entities)',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Inclusive period end',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  @Validate(DashboardPeriodOrderConstraint)
  to?: Date;
}
