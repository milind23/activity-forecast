import { Activity } from './activity';
import { ActivityRanking } from './ranking';
import { MarineDataStatus } from './weather';
import { SkiArea, SkiAreaStatus, SkiOperatingStatus } from './ski-area';

export enum RecommendationAction {
  PLAN = 'PLAN',
  CONSIDER = 'CONSIDER',
  SKIP = 'SKIP',
  UNAVAILABLE = 'UNAVAILABLE',
}

export enum RecommendationConfidence {
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
  NONE = 'NONE',
}

export enum BookingReadiness {
  READY_TO_PLAN = 'READY_TO_PLAN',
  VERIFY_LIVE_STATUS = 'VERIFY_LIVE_STATUS',
  NOT_RECOMMENDED = 'NOT_RECOMMENDED',
  NOT_APPLICABLE = 'NOT_APPLICABLE',
  DATA_UNAVAILABLE = 'DATA_UNAVAILABLE',
}

export interface RecommendationContext {
  weatherFetchedAt?: Date;
  weatherIsStale?: boolean;
  marineStatus?: MarineDataStatus;
  marineFetchedAt?: Date | null;
  marineIsStale?: boolean;
  ski?: {
    status: SkiAreaStatus;
    area: SkiArea | null;
    mountainForecastAvailable: boolean;
    forecastFetchedAt?: Date | null;
    forecastIsStale?: boolean;
  };
}

export interface ActivityRecommendation {
  activity: Activity;
  action: RecommendationAction;
  bookingReadiness: BookingReadiness;
  confidence: RecommendationConfidence;
  /** Present only when the recommendation is actionable. */
  recommendedDate: string | null;
  /** Best assessed score; null means the activity could not be assessed. */
  score: number | null;
  /** Freshness of the activity-specific forecast behind this decision. */
  dataAsOf: Date | null;
  message: string;
  evidence: string[];
  checksBeforeBooking: string[];
}

/** Explicit, tunable policy above the activity-specific scoring functions. */
export const RECOMMENDATION = {
  PLAN_MIN_SCORE: 70,
  CONSIDER_MIN_SCORE: 40,
} as const;

const ACTIVITY_LABEL: Record<Activity, string> = {
  [Activity.SKIING]: 'skiing',
  [Activity.SURFING]: 'surfing',
  [Activity.OUTDOOR_SIGHTSEEING]: 'outdoor sightseeing',
  [Activity.INDOOR_SIGHTSEEING]: 'indoor sightseeing',
};

export function recommendActivity(
  ranking: ActivityRanking,
  context: RecommendationContext = {},
): ActivityRecommendation {
  const best = ranking.days[0];
  const label = ACTIVITY_LABEL[ranking.activity];

  // A reported closure is sufficient operational evidence to reject skiing,
  // even if the mountain-weather provider is also unavailable.
  if (
    ranking.activity === Activity.SKIING &&
    context.ski?.area?.operatingStatus === SkiOperatingStatus.CLOSED
  ) {
    return enrichRecommendation(
      {
        activity: ranking.activity,
        action: RecommendationAction.SKIP,
        recommendedDate: null,
        score: best?.score ?? null,
        message: `Do not plan skiing this week: ${context.ski.area.name} is reported closed.`,
      },
      'resort reported closed',
      context,
    );
  }

  if (!best || best.score === null) {
    const reason = best?.reason ?? 'no forecast data';
    return enrichRecommendation(
      {
        activity: ranking.activity,
        action: RecommendationAction.UNAVAILABLE,
        recommendedDate: null,
        score: null,
        message: `No ${label} recommendation: ${reason}.`,
      },
      reason,
      context,
    );
  }

  if (best.score >= RECOMMENDATION.PLAN_MIN_SCORE) {
    return enrichRecommendation(
      {
        activity: ranking.activity,
        action: RecommendationAction.PLAN,
        recommendedDate: best.date,
        score: best.score,
        message: actionableMessage(
          ranking.activity,
          'Plan',
          best.date,
          best.score,
          best.reason,
          context,
        ),
      },
      best.reason,
      context,
    );
  }

  if (best.score >= RECOMMENDATION.CONSIDER_MIN_SCORE) {
    return enrichRecommendation(
      {
        activity: ranking.activity,
        action: RecommendationAction.CONSIDER,
        recommendedDate: best.date,
        score: best.score,
        message: actionableMessage(
          ranking.activity,
          'Consider',
          best.date,
          best.score,
          best.reason,
          context,
        ),
      },
      best.reason,
      context,
    );
  }

  return enrichRecommendation(
    {
      activity: ranking.activity,
      action: RecommendationAction.SKIP,
      recommendedDate: null,
      score: best.score,
      message: `Skip ${label} this week; even the best assessed day, ${best.date}, scores ${best.score}/100: ${best.reason}.`,
    },
    best.reason,
    context,
  );
}

type BaseRecommendation = Pick<
  ActivityRecommendation,
  'activity' | 'action' | 'recommendedDate' | 'score' | 'message'
>;

function enrichRecommendation(
  base: BaseRecommendation,
  reason: string,
  context: RecommendationContext,
): ActivityRecommendation {
  const notApplicable =
    reason === 'no ski area nearby' ||
    reason === 'no coastal waters near this location';
  const unavailable = base.action === RecommendationAction.UNAVAILABLE;
  const rejected = base.action === RecommendationAction.SKIP;

  let confidence = unavailable
    ? RecommendationConfidence.NONE
    : RecommendationConfidence.HIGH;
  let bookingReadiness = unavailable
    ? BookingReadiness.DATA_UNAVAILABLE
    : rejected
      ? notApplicable
        ? BookingReadiness.NOT_APPLICABLE
        : BookingReadiness.NOT_RECOMMENDED
      : BookingReadiness.READY_TO_PLAN;
  let dataAsOf = context.weatherFetchedAt ?? null;
  const evidence = [`Weather assessment: ${reason}`];
  const checksBeforeBooking: string[] = [];

  switch (base.activity) {
    case Activity.SKIING: {
      const ski = context.ski;
      // City weather is not the activity-specific evidence for skiing. With no
      // concrete venue/mountain forecast there is no honest ski evidence time.
      dataAsOf = ski?.area ? (ski.forecastFetchedAt ?? null) : null;
      if (ski?.area) {
        const elevation = ski.area.forecastElevationM;
        evidence.push(
          `Ski venue: ${ski.area.name} (${ski.area.source})`,
          elevation === null
            ? `Mountain forecast point: ${ski.area.latitude.toFixed(4)}, ${ski.area.longitude.toFixed(4)} (provider elevation)`
            : `Mountain forecast elevation: ${elevation} m`,
          `Resort operations: ${ski.area.operatingStatus}`,
        );
        if (ski.area.sourceUrl)
          evidence.push(`Venue source: ${ski.area.sourceUrl}`);
        dataAsOf = ski.forecastFetchedAt ?? dataAsOf;
        if (!unavailable) {
          confidence = ski.mountainForecastAvailable
            ? RecommendationConfidence.MEDIUM
            : ski.area.operatingStatus === SkiOperatingStatus.CLOSED
              ? RecommendationConfidence.LOW
              : RecommendationConfidence.NONE;
        }
        if (
          !rejected &&
          !unavailable &&
          ski.area.operatingStatus !== SkiOperatingStatus.OPEN
        ) {
          bookingReadiness = BookingReadiness.VERIFY_LIVE_STATUS;
        }
        if (ski.area.operationsUrl) {
          checksBeforeBooking.push(
            `Live lift and piste status: ${ski.area.operationsUrl}`,
          );
        }
      }
      if (!notApplicable) {
        checksBeforeBooking.push(
          'Local avalanche bulletin and weather warnings',
          'Ability-appropriate terrain and equipment',
        );
      }
      break;
    }
    case Activity.SURFING:
      // Atmospheric freshness must not masquerade as marine-data freshness.
      dataAsOf = context.marineFetchedAt ?? null;
      if (!unavailable && !notApplicable) {
        confidence = RecommendationConfidence.MEDIUM;
        if (!rejected) bookingReadiness = BookingReadiness.VERIFY_LIVE_STATUS;
      }
      evidence.push(`Marine data: ${context.marineStatus ?? 'unknown'}`);
      if (!notApplicable) {
        checksBeforeBooking.push(
          'Local tide, swell direction and beach warnings',
          'Conditions appropriate for the surfer’s ability',
        );
      }
      break;
    case Activity.OUTDOOR_SIGHTSEEING:
      checksBeforeBooking.push('Local alerts, access and opening hours');
      break;
    case Activity.INDOOR_SIGHTSEEING:
      if (!rejected && !unavailable)
        bookingReadiness = BookingReadiness.VERIFY_LIVE_STATUS;
      checksBeforeBooking.push('Venue opening hours and ticket availability');
      break;
  }

  const staleEvidence = activityStaleEvidence(base.activity, context);
  if (staleEvidence) {
    evidence.push(staleEvidence);
    if (confidence === RecommendationConfidence.HIGH)
      confidence = RecommendationConfidence.MEDIUM;
    else if (confidence === RecommendationConfidence.MEDIUM)
      confidence = RecommendationConfidence.LOW;
  }

  // Missing required data always wins over secondary live-status checks.
  if (unavailable) {
    bookingReadiness = BookingReadiness.DATA_UNAVAILABLE;
    confidence = RecommendationConfidence.NONE;
  }

  return {
    ...base,
    bookingReadiness,
    confidence,
    dataAsOf,
    evidence,
    checksBeforeBooking,
  };
}

function activityStaleEvidence(
  activity: Activity,
  context: RecommendationContext,
): string | null {
  switch (activity) {
    case Activity.SKIING:
      return context.ski?.forecastIsStale
        ? 'Mountain forecast is stored fallback data'
        : null;
    case Activity.SURFING:
      return context.marineIsStale
        ? 'Marine forecast is stored fallback data'
        : null;
    case Activity.OUTDOOR_SIGHTSEEING:
    case Activity.INDOOR_SIGHTSEEING:
      return context.weatherIsStale
        ? 'Atmospheric forecast is stored fallback data'
        : null;
  }
}

function actionableMessage(
  activity: Activity,
  verb: 'Plan' | 'Consider',
  date: string,
  score: number,
  reason: string,
  context: RecommendationContext,
): string {
  const label = ACTIVITY_LABEL[activity];
  if (activity === Activity.SKIING && context.ski?.area) {
    const verify =
      context.ski.area.operatingStatus === SkiOperatingStatus.OPEN
        ? ''
        : ' Verify live lift and piste status before booking.';
    return `${verb} ${label} at ${context.ski.area.name} for ${date} (${score}/100): ${reason}.${verify}`;
  }
  return `${verb} ${label} ${verb === 'Plan' ? 'for' : 'on'} ${date} (${score}/100): ${reason}.`;
}

export function recommendActivities(
  rankings: ActivityRanking[],
  context: RecommendationContext = {},
): ActivityRecommendation[] {
  return rankings.map((ranking) => recommendActivity(ranking, context));
}

export function summarizeRecommendations(
  recommendations: ActivityRecommendation[],
): string {
  const planned = recommendations.filter(
    (item) => item.action === RecommendationAction.PLAN,
  );
  const considered = recommendations.filter(
    (item) => item.action === RecommendationAction.CONSIDER,
  ).length;
  const skipped = recommendations.filter(
    (item) => item.action === RecommendationAction.SKIP,
  ).length;
  const unavailable = recommendations.filter(
    (item) => item.action === RecommendationAction.UNAVAILABLE,
  ).length;

  const parts: string[] = [];
  if (planned.length) {
    const labels = planned.map((item) => ACTIVITY_LABEL[item.activity]);
    parts.push(
      `Strong weather window${planned.length === 1 ? '' : 's'} for ${joinLabels(labels)}`,
    );
  } else {
    parts.push('No strong weather-based booking signal this week');
  }
  if (considered) parts.push(`${considered} worth considering`);
  if (skipped) parts.push(`${skipped} better skipped`);
  if (unavailable) parts.push(`${unavailable} could not be assessed`);
  return `${parts.join('; ')}.`;
}

function joinLabels(labels: string[]): string {
  if (labels.length < 2) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}
