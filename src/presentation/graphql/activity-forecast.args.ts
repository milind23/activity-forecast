import { ArgsType, Field } from '@nestjs/graphql';
import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

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
    description: 'Optional ISO 3166-1 alpha-2 country filter, e.g. "FR"',
  })
  @Transform(trim)
  @IsOptional()
  @Matches(/^[A-Za-z]{2}$/, {
    message: 'country must be a 2-letter ISO 3166-1 alpha-2 code, e.g. "FR"',
  })
  country?: string;
}
