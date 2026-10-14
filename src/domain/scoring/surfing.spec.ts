import { DailyMarine } from '../weather';
import { makeDay } from '../testing/day.fixture';
import { scoreSurfing } from './surfing';

const sea = (
  waveHeightMaxM: number | null,
  wavePeriodMaxS: number | null = 12,
): DailyMarine => ({
  date: '2026-10-15',
  waveHeightMaxM,
  wavePeriodMaxS,
});
const calm = makeDay({ windSpeedMaxKmh: 10 });

describe('scoreSurfing', () => {
  it('is null with "no coastal data" without marine data', () => {
    expect(scoreSurfing(calm, undefined)).toEqual({
      score: null,
      reason: 'no coastal data',
    });
    expect(scoreSurfing(calm, sea(null)).score).toBeNull();
  });

  it('scores ideal waves, long period and light wind at 100', () => {
    expect(scoreSurfing(calm, sea(1.8, 13)).score).toBe(100);
  });

  it('scores a flat sea at 0 regardless of period or wind', () => {
    const r = scoreSurfing(calm, sea(0.2, 14));
    expect(r.score).toBe(0);
    expect(r.reason).toContain('flat');
  });

  it('ranks small < ideal and huge < ideal', () => {
    const ideal = scoreSurfing(calm, sea(1.5)).score!;
    expect(scoreSurfing(calm, sea(0.6)).score!).toBeLessThan(ideal);
    expect(scoreSurfing(calm, sea(5)).score!).toBeLessThan(ideal);
  });

  it('penalises short period and strong wind', () => {
    const ideal = scoreSurfing(calm, sea(1.5, 12)).score!;
    expect(scoreSurfing(calm, sea(1.5, 6)).score).toBe(ideal - 30);
    expect(
      scoreSurfing(makeDay({ windSpeedMaxKmh: 45 }), sea(1.5, 12)).score,
    ).toBe(ideal - 20);
  });
});
