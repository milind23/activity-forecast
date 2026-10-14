import { Activity } from './activity';
import {
  bestActivityPerDay,
  compareDayScores,
  rankActivities,
  rankDays,
} from './ranking';
import { makeDay } from './testing/day.fixture';
import { DailyMarine } from './weather';

describe('rankDays', () => {
  it('sorts best-first, nulls last, ties by earlier date', () => {
    const { days, bestDay } = rankDays([
      { date: '2026-10-15', score: 50, reason: '' },
      { date: '2026-10-16', score: null, reason: '' },
      { date: '2026-10-17', score: 80, reason: '' },
      { date: '2026-10-14', score: 50, reason: '' },
    ]);
    expect(days.map((d) => d.date)).toEqual([
      '2026-10-17',
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
    ]);
    expect(bestDay).toBe('2026-10-17');
  });

  it('has no bestDay when every score is 0 or null', () => {
    expect(rankDays([{ date: 'a', score: 0, reason: '' }]).bestDay).toBeNull();
    expect(
      rankDays([{ date: 'a', score: null, reason: '' }]).bestDay,
    ).toBeNull();
    expect(rankDays([]).bestDay).toBeNull();
  });

  it('does not mutate its input', () => {
    const input = [
      { date: 'b', score: 1, reason: '' },
      { date: 'a', score: 2, reason: '' },
    ];
    rankDays(input);
    expect(input[0].date).toBe('b');
  });

  it('compareDayScores orders two nulls by date', () => {
    expect(
      compareDayScores(
        { date: 'a', score: null, reason: '' },
        { date: 'b', score: null, reason: '' },
      ),
    ).toBeLessThan(0);
  });
});

describe('rankActivities', () => {
  const days = [
    makeDay({
      date: '2026-10-15',
      precipitationMm: 15,
      precipitationProbability: 95,
    }),
    makeDay({ date: '2026-10-16' }),
  ];
  const marine = new Map<string, DailyMarine>([
    [
      '2026-10-15',
      { date: '2026-10-15', waveHeightMaxM: 1.5, wavePeriodMaxS: 12 },
    ],
  ]);

  const rankings = rankActivities(days, {
    skiArea: 'none',
    marineByDate: marine,
  });
  const get = (a: Activity) => rankings.find((r) => r.activity === a)!;

  it('returns all four activities, each with every day (28 scores for 7 days)', () => {
    expect(rankings.map((r) => r.activity)).toEqual([
      Activity.SKIING,
      Activity.SURFING,
      Activity.OUTDOOR_SIGHTSEEING,
      Activity.INDOOR_SIGHTSEEING,
    ]);
    rankings.forEach((r) => expect(r.days).toHaveLength(2));
  });

  it('ranks outdoor and indoor sightseeing in opposite directions', () => {
    expect(get(Activity.OUTDOOR_SIGHTSEEING).bestDay).toBe('2026-10-16');
    expect(get(Activity.INDOOR_SIGHTSEEING).bestDay).toBe('2026-10-15');
  });

  it('uses marine data per date and null where it is missing', () => {
    const surf = get(Activity.SURFING);
    expect(surf.bestDay).toBe('2026-10-15');
    expect(surf.days[1]).toMatchObject({
      date: '2026-10-16',
      score: null,
      reason: 'no coastal data',
    });
  });

  it('gives skiing no bestDay without a ski area', () => {
    expect(get(Activity.SKIING).bestDay).toBeNull();
    expect(get(Activity.SKIING).days.every((d) => d.score === 0)).toBe(true);
  });

  it('bestActivityPerDay derives the alternative view from the same scores', () => {
    expect(bestActivityPerDay(rankings)).toEqual([
      {
        date: '2026-10-15',
        activity: Activity.SURFING, // rain does not bother surfers
        score: expect.any(Number),
      },
      {
        date: '2026-10-16',
        activity: Activity.OUTDOOR_SIGHTSEEING,
        score: 100,
      },
    ]);
  });
});
