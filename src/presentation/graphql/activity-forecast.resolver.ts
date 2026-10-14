import { Args, Query, Resolver } from '@nestjs/graphql';
import { ActivityForecastService } from '../../application/activity-forecast.service';
import { ActivityForecastArgs } from './activity-forecast.args';
import { ActivityForecastType } from './types';
import { toGraphQLError } from './error-mapping';

@Resolver(() => ActivityForecastType)
export class ActivityForecastResolver {
  constructor(private readonly service: ActivityForecastService) {}

  @Query(() => ActivityForecastType, {
    description:
      'Ranks the next 7 days for skiing, surfing, outdoor and indoor sightseeing in a city. ' +
      'Each activity lists its days best-first plus a bestDay.',
  })
  async activityForecast(
    @Args() { city, country }: ActivityForecastArgs,
  ): Promise<ActivityForecastType> {
    try {
      return await this.service.getForecast(city, country);
    } catch (err) {
      throw toGraphQLError(err);
    }
  }
}
