import { makeDay } from '../testing/day.fixture';
import { scoreSkiing } from './skiing';

const powderDay = makeDay({
  snowDepthM: 1.2,
  snowfallCm: 15,
  tempMaxC: -4,
  windSpeedMaxKmh: 10,
});

describe('scoreSkiing', () => {
  it('is 0 with a clear reason when there is no ski area nearby', () => {
    expect(scoreSkiing(powderDay, 'none')).toEqual({
      score: 0,
      reason: 'no ski area nearby',
    });
  });

  it('is null when the ski-area lookup failed', () => {
    expect(scoreSkiing(powderDay, 'unknown').score).toBeNull();
  });

  it('gives a deep base, fresh snow and cold calm weather a perfect score', () => {
    expect(scoreSkiing(powderDay, 'nearby').score).toBe(100);
  });

  it('scores 0 when there is no snow at all', () => {
    const r = scoreSkiing(makeDay({ tempMaxC: 0 }), 'nearby');
    expect(r.score).toBe(0);
    expect(r.reason).toContain('little or no snow');
  });

  it('penalises mild temperatures', () => {
    const cold = scoreSkiing({ ...powderDay, snowfallCm: 0 }, 'nearby').score!;
    const mild = scoreSkiing(
      { ...powderDay, snowfallCm: 0, tempMaxC: 8 },
      'nearby',
    );
    expect(mild.score!).toBeLessThan(cold);
    expect(mild.reason).toContain('mild');
  });

  it('caps likely lift-closing wind below the recommendation thresholds', () => {
    const windy = scoreSkiing({ ...powderDay, windSpeedMaxKmh: 70 }, 'nearby');
    expect(windy.score).toBe(39);
    expect(windy.reason).toContain('lift-closing wind likely');
  });

  it('treats missing snow data as no snow', () => {
    const r = scoreSkiing(
      makeDay({ snowDepthM: null, snowfallCm: null }),
      'nearby',
    );
    expect(r.score).toBe(0);
  });
});
