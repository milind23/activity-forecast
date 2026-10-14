import { Module } from '@nestjs/common';
import { InfrastructureModule } from '../infrastructure/infrastructure.module';
import { ActivityForecastService } from './activity-forecast.service';

@Module({
  imports: [InfrastructureModule],
  providers: [ActivityForecastService],
  exports: [ActivityForecastService],
})
export class ApplicationModule {}
