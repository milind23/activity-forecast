import { makeDay } from '../testing/day.fixture';
import { scoreOutdoorSightseeing } from './outdoor-sightseeing';

describe('scoreOutdoorSightseeing', () => {
  it('scores a dry, sunny, mild, calm day at 100', () => {
    expect(scoreOutdoorSightseeing(makeDay()).score).toBe(100);
  });

  it('applies the larger of the rain-probability and rain-amount penalties', () => {
    expect(
      scoreOutdoorSightseeing(makeDay({ precipitationProbability: 100 })).score,
    ).toBe(55);
    expect(
      scoreOutdoorSightseeing(makeDay({ precipitationMm: 20 })).score,
    ).toBe(55);
  });

  it('penalises 3 points per degree outside the comfort band, capped', () => {
    expect(scoreOutdoorSightseeing(makeDay({ tempMaxC: 10 })).score).toBe(85);
    expect(scoreOutdoorSightseeing(makeDay({ tempMaxC: 30 })).score).toBe(88);
    expect(scoreOutdoorSightseeing(makeDay({ tempMaxC: -20 })).score).toBe(70);
  });

  it('penalises wind and lack of sunshine', () => {
    expect(
      scoreOutdoorSightseeing(makeDay({ windSpeedMaxKmh: 60 })).score,
    ).toBe(85);
    expect(scoreOutdoorSightseeing(makeDay({ sunshineHours: 0 })).score).toBe(
      90,
    );
  });

  it('caps thunderstorm days', () => {
    const r = scoreOutdoorSightseeing(makeDay({ weatherCode: 95 }));
    expect(r.score).toBe(10);
    expect(r.reason).toMatch(/^thunderstorms/);
  });

  it('never goes below 0', () => {
    const awful = makeDay({
      precipitationMm: 50,
      tempMaxC: -30,
      windSpeedMaxKmh: 100,
      sunshineHours: 0,
    });
    expect(scoreOutdoorSightseeing(awful).score).toBe(0);
  });
});
