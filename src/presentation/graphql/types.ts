import {
  Field,
  Float,
  Int,
  ObjectType,
  registerEnumType,
} from '@nestjs/graphql';
import {
  Activity,
  BookingReadiness,
  RecommendationAction,
  RecommendationConfidence,
} from '../../domain';

registerEnumType(Activity, { name: 'Activity' });
registerEnumType(RecommendationAction, {
  name: 'RecommendationAction',
  description:
    'PLAN (strong fit), CONSIDER (reasonable), SKIP (poor fit), or UNAVAILABLE (insufficient data)',
});
registerEnumType(RecommendationConfidence, {
  name: 'RecommendationConfidence',
  description: 'Confidence in the evidence available for this decision',
});
registerEnumType(BookingReadiness, {
  name: 'BookingReadiness',
  description:
    'Whether the result is ready to plan, needs live verification, is not recommended/applicable, or lacks data',
});

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
    description: 'When the atmospheric forecast was fetched from Open-Meteo',
  })
  fetchedAt!: Date;
  @Field({
    description:
      'true if atmospheric refresh failed and stored weather is being served; marine data may independently be older',
  })
  isStale!: boolean;
}

@ObjectType('DayScore')
export class DayScoreType {
  @Field({ description: 'Local date, YYYY-MM-DD' }) date!: string;
  @Field(() => Int, {
    nullable: true,
    description:
      '0-100 activity-specific weather suitability; null when required data is unavailable. See docs/SCORING.md.',
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

@ObjectType('ActivityRecommendation')
export class ActivityRecommendationType {
  @Field(() => Activity) activity!: Activity;
  @Field(() => RecommendationAction) action!: RecommendationAction;
  @Field(() => BookingReadiness) bookingReadiness!: BookingReadiness;
  @Field(() => RecommendationConfidence)
  confidence!: RecommendationConfidence;
  @Field(() => String, {
    nullable: true,
    description: 'YYYY-MM-DD when action is PLAN or CONSIDER; otherwise null',
  })
  recommendedDate!: string | null;
  @Field(() => Int, {
    nullable: true,
    description:
      'Activity-specific weather score for the best assessed day; null if required data is unavailable. Scores are not calibrated across activities.',
  })
  score!: number | null;
  @Field(() => Date, {
    nullable: true,
    description: 'When the activity-specific forecast evidence was fetched',
  })
  dataAsOf!: Date | null;
  @Field({ description: 'Human-readable decision and its main weather reason' })
  message!: string;
  @Field(() => [String], {
    description: 'Compact evidence and source provenance behind the decision',
  })
  evidence!: string[];
  @Field(() => [String], {
    description: 'Live or local checks still required before purchasing',
  })
  checksBeforeBooking!: string[];
}

@ObjectType('ActivityRecommendations')
export class ActivityRecommendationsType {
  @Field({ description: 'Resolved place name, without exposing coordinates' })
  destination!: string;
  @Field({
    description: 'One-line overview; does not compare unlike activity scores',
  })
  summary!: string;
  @Field(() => [ActivityRecommendationType])
  recommendations!: ActivityRecommendationType[];
  @Field({ description: 'Important limits on weather-based recommendations' })
  advisory!: string;
}
