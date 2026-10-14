import { makeDay } from '../testing/day.fixture';
import { INDOOR, scoreIndoorSightseeing } from './indoor-sightseeing';

describe('scoreIndoorSightseeing', () => {
  it('never drops below the floor, even on a perfect outdoor day', () => {
    expect(scoreIndoorSightseeing(makeDay()).score).toBe(INDOOR.FLOOR);
  });

  it('is 100 when outdoor conditions are terrible', () => {
    const awful = makeDay({
      precipitationMm: 50,
      tempMaxC: -30,
      windSpeedMaxKmh: 100,
      sunshineHours: 0,
    });
    expect(scoreIndoorSightseeing(awful).score).toBe(100);
  });

  it('rises as outdoor conditions worsen', () => {
    const dry = scoreIndoorSightseeing(makeDay()).score!;
    const wet = scoreIndoorSightseeing(
      makeDay({ precipitationProbability: 90, precipitationMm: 10 }),
    );
    expect(wet.score!).toBeGreaterThan(dry);
  });
});
