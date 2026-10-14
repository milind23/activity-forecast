import {
  Field,
  Float,
  Int,
  ObjectType,
  registerEnumType,
} from '@nestjs/graphql';
import { Activity } from '../../domain';

registerEnumType(Activity, { name: 'Activity' });

@ObjectType('Location')
export class LocationType {
  @Field() name!: string;
  @Field() country!: string;
  @Field({ description: 'ISO 3166-1 alpha-2' }) countryCode!: string;
  @Field(() => String, {
    nullable: true,
    description: 'State/region, helps with ambiguous names',
  })
  region?: string;
  @Field(() => Float) latitude!: number;
  @Field(() => Float) longitude!: number;
  @Field({ description: 'IANA timezone; all dates are local to it' })
  timezone!: string;
}

@ObjectType('DataFreshness')
export class DataFreshnessType {
  @Field({
    description: 'When the underlying forecast was fetched from Open-Meteo',
  })
  fetchedAt!: Date;
  @Field({
    description:
      'true if a refresh failed and older stored data is being served',
  })
  isStale!: boolean;
}

@ObjectType('DayScore')
export class DayScoreType {
  @Field({ description: 'Local date, YYYY-MM-DD' }) date!: string;
  @Field(() => Int, {
    nullable: true,
    description: '0-100; null when it cannot be assessed',
  })
  score!: number | null;
  @Field() reason!: string;
}

@ObjectType('ActivityRanking')
export class ActivityRankingType {
  @Field(() => Activity) activity!: Activity;
  @Field(() => String, {
    nullable: true,
    description: 'Best date, null if no day scores above 0',
  })
  bestDay!: string | null;
  @Field(() => [DayScoreType], { description: 'Sorted best-first' })
  days!: DayScoreType[];
}

@ObjectType('ActivityForecast')
export class ActivityForecastType {
  @Field(() => LocationType) location!: LocationType;
  @Field(() => DataFreshnessType) dataFreshness!: DataFreshnessType;
  @Field(() => [ActivityRankingType]) activities!: ActivityRankingType[];
}
