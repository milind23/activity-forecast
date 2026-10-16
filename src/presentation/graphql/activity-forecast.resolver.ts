import { Args, Query, Resolver } from '@nestjs/graphql';
import { ActivityForecastService } from '../../application/activity-forecast.service';
import { ActivityForecastArgs } from './activity-forecast.args';
import { ActivityForecastType, ActivityRecommendationsType } from './types';
import { RequireScopes } from '../security/required-scopes.decorator';

@Resolver(() => ActivityForecastType)
export class ActivityForecastResolver {
  constructor(private readonly service: ActivityForecastService) {}

  @Query(() => ActivityRecommendationsType, {
    description:
      'Product-facing recommendation for the next 7 days. Returns a weather action, booking readiness, confidence, compact evidence and required live checks per activity.',
  })
  @RequireScopes('forecast:read')
  async activityRecommendations(
    @Args() { city, country }: ActivityForecastArgs,
  ): Promise<ActivityRecommendationsType> {
    return this.service.getRecommendations(city, country);
  }

  @Query(() => ActivityForecastType, {
    description:
      'Detailed evidence view. Ranks the next 7 days for skiing, surfing, outdoor and indoor sightseeing in a city. ' +
      'Each activity lists its days best-first plus a bestDay.',
  })
  @RequireScopes('forecast:read')
  async activityForecast(
    @Args() { city, country }: ActivityForecastArgs,
  ): Promise<ActivityForecastType> {
    return this.service.getForecast(city, country);
  }
}
