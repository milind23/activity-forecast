import { ArgsType, Field } from '@nestjs/graphql';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

@ArgsType()
export class ActivityForecastArgs {
  @Field({ description: 'City or town name, e.g. "Chamonix"' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'city must not be empty' })
  @MaxLength(100)
  city!: string;

  @Field(() => String, {
    nullable: true,
    description:
      'Optional English country name or ISO alpha-2/alpha-3 code, e.g. "India", "USA" or "US"',
  })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'country must not be empty' })
  @MaxLength(100)
  country?: string;
}
