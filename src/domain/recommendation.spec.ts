import { Activity } from './activity';
import {
  BookingReadiness,
  RecommendationAction,
  RecommendationConfidence,
  recommendActivity,
  summarizeRecommendations,
} from './recommendation';
import { ActivityRanking } from './ranking';
import { SkiArea, SkiAreaSource, SkiOperatingStatus } from './ski-area';

const ranking = (
  activity: Activity,
  score: number | null,
  reason = 'test conditions',
): ActivityRanking => ({
  activity,
  bestDay: score !== null && score > 0 ? '2026-10-20' : null,
  days: [{ date: '2026-10-20', score, reason }],
});

const skiArea = (operatingStatus: SkiOperatingStatus): SkiArea => ({
  id: 'catalog:test-resort',
  name: 'Test Mountain',
  latitude: 45.9,
  longitude: 7.7,
  forecastElevationM: 2800,
  source: SkiAreaSource.CURATED_CATALOG,
  operatingStatus,
  operationsUrl: 'https://example.com/live-status',
});

const skiContext = (operatingStatus: SkiOperatingStatus) => ({
  weatherFetchedAt: new Date('2026-10-16T06:00:00Z'),
  ski: {
    status: 'nearby' as const,
    area: skiArea(operatingStatus),
    mountainForecastAvailable: true,
    forecastFetchedAt: new Date('2026-10-16T06:05:00Z'),
  },
});

describe('recommendActivity', () => {
  it.each([
    [70, RecommendationAction.PLAN, '2026-10-20'],
    [69, RecommendationAction.CONSIDER, '2026-10-20'],
    [40, RecommendationAction.CONSIDER, '2026-10-20'],
    [39, RecommendationAction.SKIP, null],
    [0, RecommendationAction.SKIP, null],
  ])('maps score %s to %s', (score, action, recommendedDate) => {
    expect(recommendActivity(ranking(Activity.SURFING, score))).toMatchObject({
      action,
      recommendedDate,
      score,
    });
  });

  it('does not make a recommendation from missing data', () => {
    expect(
      recommendActivity(ranking(Activity.SURFING, null, 'no coastal data')),
    ).toMatchObject({
      activity: Activity.SURFING,
      action: RecommendationAction.UNAVAILABLE,
      bookingReadiness: 'DATA_UNAVAILABLE',
      confidence: 'NONE',
      recommendedDate: null,
      score: null,
      message: 'No surfing recommendation: no coastal data.',
    });
  });

  it('does not label atmospheric freshness as marine freshness when marine data is unavailable', () => {
    expect(
      recommendActivity(
        ranking(Activity.SURFING, null, 'marine forecast unavailable'),
        { weatherFetchedAt: new Date('2026-10-16T06:00:00Z') },
      ),
    ).toMatchObject({
      bookingReadiness: BookingReadiness.DATA_UNAVAILABLE,
      dataAsOf: null,
    });
  });

  it('omits irrelevant pre-booking checks when an activity is not applicable', () => {
    expect(
      recommendActivity(
        ranking(Activity.SURFING, 0, 'no coastal waters near this location'),
        {
          marineStatus: 'not_applicable',
          marineFetchedAt: new Date('2026-10-16T06:00:00Z'),
        },
      ),
    ).toMatchObject({
      bookingReadiness: BookingReadiness.NOT_APPLICABLE,
      checksBeforeBooking: [],
      dataAsOf: new Date('2026-10-16T06:00:00Z'),
    });
  });

  it('handles an empty ranking as unavailable', () => {
    expect(
      recommendActivity({
        activity: Activity.SKIING,
        bestDay: null,
        days: [],
      }).action,
    ).toBe(RecommendationAction.UNAVAILABLE);
  });

  it('requires live verification when mountain weather is good but resort operations are unknown', () => {
    expect(
      recommendActivity(
        ranking(Activity.SKIING, 88, 'deep snow, fresh snow'),
        skiContext(SkiOperatingStatus.UNKNOWN),
      ),
    ).toMatchObject({
      action: RecommendationAction.PLAN,
      bookingReadiness: BookingReadiness.VERIFY_LIVE_STATUS,
      confidence: RecommendationConfidence.MEDIUM,
      recommendedDate: '2026-10-20',
      dataAsOf: new Date('2026-10-16T06:05:00Z'),
      message: expect.stringContaining('Verify live lift and piste status'),
      checksBeforeBooking: expect.arrayContaining([
        'Live lift and piste status: https://example.com/live-status',
      ]),
    });
  });

  it('keeps missing mountain weather as data unavailable even when resort operations are unknown', () => {
    expect(
      recommendActivity(
        ranking(Activity.SKIING, null, 'mountain forecast unavailable'),
        {
          ...skiContext(SkiOperatingStatus.UNKNOWN),
          ski: {
            ...skiContext(SkiOperatingStatus.UNKNOWN).ski,
            mountainForecastAvailable: false,
            forecastFetchedAt: null,
          },
        },
      ),
    ).toMatchObject({
      action: RecommendationAction.UNAVAILABLE,
      bookingReadiness: BookingReadiness.DATA_UNAVAILABLE,
      confidence: RecommendationConfidence.NONE,
      dataAsOf: null,
    });
  });

  it('is ready to plan when mountain weather is good and resort operations are open', () => {
    expect(
      recommendActivity(
        ranking(Activity.SKIING, 88, 'deep snow, fresh snow'),
        skiContext(SkiOperatingStatus.OPEN),
      ),
    ).toMatchObject({
      action: RecommendationAction.PLAN,
      bookingReadiness: BookingReadiness.READY_TO_PLAN,
      confidence: RecommendationConfidence.MEDIUM,
      recommendedDate: '2026-10-20',
    });
  });

  it('never recommends booking a resort reported closed even when the weather score is high', () => {
    expect(
      recommendActivity(
        ranking(Activity.SKIING, 88, 'deep snow, fresh snow'),
        skiContext(SkiOperatingStatus.CLOSED),
      ),
    ).toMatchObject({
      action: RecommendationAction.SKIP,
      bookingReadiness: BookingReadiness.NOT_RECOMMENDED,
      recommendedDate: null,
      score: 88,
      message:
        'Do not plan skiing this week: Test Mountain is reported closed.',
    });
  });

  it('lets a reported closure override missing mountain weather', () => {
    expect(
      recommendActivity(
        ranking(Activity.SKIING, null, 'mountain forecast unavailable'),
        {
          ...skiContext(SkiOperatingStatus.CLOSED),
          ski: {
            ...skiContext(SkiOperatingStatus.CLOSED).ski,
            mountainForecastAvailable: false,
            forecastFetchedAt: null,
          },
        },
      ),
    ).toMatchObject({
      action: RecommendationAction.SKIP,
      bookingReadiness: BookingReadiness.NOT_RECOMMENDED,
      confidence: RecommendationConfidence.LOW,
      recommendedDate: null,
      score: null,
    });
  });

  it('downgrades stale mountain evidence without treating fresh mountain data as stale city data', () => {
    const stale = recommendActivity(ranking(Activity.SKIING, 88, 'deep snow'), {
      ...skiContext(SkiOperatingStatus.OPEN),
      weatherIsStale: false,
      ski: {
        ...skiContext(SkiOperatingStatus.OPEN).ski,
        forecastIsStale: true,
      },
    });
    const freshMountain = recommendActivity(
      ranking(Activity.SKIING, 88, 'deep snow'),
      {
        ...skiContext(SkiOperatingStatus.OPEN),
        weatherIsStale: true,
        ski: {
          ...skiContext(SkiOperatingStatus.OPEN).ski,
          forecastIsStale: false,
        },
      },
    );

    expect(stale).toMatchObject({
      confidence: RecommendationConfidence.LOW,
      evidence: expect.arrayContaining([
        'Mountain forecast is stored fallback data',
      ]),
    });
    expect(freshMountain.confidence).toBe(RecommendationConfidence.MEDIUM);
    expect(freshMountain.evidence).not.toContain(
      'Atmospheric forecast is stored fallback data',
    );
  });

  it('downgrades confidence when a stored forecast is stale', () => {
    expect(
      recommendActivity(ranking(Activity.OUTDOOR_SIGHTSEEING, 90), {
        weatherIsStale: true,
        weatherFetchedAt: new Date('2026-10-15T06:00:00Z'),
      }),
    ).toMatchObject({
      action: RecommendationAction.PLAN,
      bookingReadiness: BookingReadiness.READY_TO_PLAN,
      confidence: RecommendationConfidence.MEDIUM,
      evidence: expect.arrayContaining([
        'Atmospheric forecast is stored fallback data',
      ]),
    });
  });
});

describe('summarizeRecommendations', () => {
  it('summarizes decisions without comparing unlike activity scores', () => {
    const recommendations = [
      recommendActivity(ranking(Activity.SKIING, 90)),
      recommendActivity(ranking(Activity.SURFING, null)),
      recommendActivity(ranking(Activity.OUTDOOR_SIGHTSEEING, 65)),
      recommendActivity(ranking(Activity.INDOOR_SIGHTSEEING, 20)),
    ];

    expect(summarizeRecommendations(recommendations)).toBe(
      'Strong weather window for skiing; 1 worth considering; 1 better skipped; 1 could not be assessed.',
    );
  });
});
