import { parseGeocoding } from './open-meteo-geocoder.adapter';
import {
  hasMarineData,
  parseOpenMeteoMarine,
} from './open-meteo-marine.adapter';
import { parseOpenMeteoForecast } from './open-meteo-weather.adapter';
import { buildSkiAreaQueries } from '../overpass/overpass-terrain.adapter';

describe('Open-Meteo parsers', () => {
  it('maps the forecast payload and takes the daily max of hourly snow depth', () => {
    const days = parseOpenMeteoForecast({
      daily: {
        time: ['2026-10-15', '2026-10-16'],
        temperature_2m_max: [1, 2],
        temperature_2m_min: [-5, -4],
        precipitation_sum: [0, 3],
        precipitation_probability_max: [5, 80],
        snowfall_sum: [0, 4.2],
        wind_speed_10m_max: [10, 20],
        weather_code: [1, 73],
        sunshine_duration: [36000, null],
      },
      hourly: {
        time: ['2026-10-15T00:00', '2026-10-15T12:00', '2026-10-16T00:00'],
        snow_depth: [0.5, 0.7, null],
      },
    });
    expect(days[0]).toEqual({
      date: '2026-10-15',
      tempMaxC: 1,
      tempMinC: -5,
      precipitationMm: 0,
      precipitationProbability: 5,
      snowfallCm: 0,
      snowDepthM: 0.7,
      windSpeedMaxKmh: 10,
      weatherCode: 1,
      sunshineHours: 10,
    });
    expect(days[1]).toMatchObject({
      snowDepthM: null,
      sunshineHours: null,
      snowfallCm: 4.2,
    });
  });

  it('returns no days for an empty payload', () => {
    expect(parseOpenMeteoForecast({})).toEqual([]);
  });

  it('detects inland (all-null) marine payloads', () => {
    const inland = {
      daily: {
        time: ['2026-10-15'],
        wave_height_max: [null],
        wave_period_max: [null],
      },
    };
    const coast = {
      daily: {
        time: ['2026-10-15'],
        wave_height_max: [1.4],
        wave_period_max: [11],
      },
    };
    expect(hasMarineData(inland)).toBe(false);
    expect(hasMarineData(coast)).toBe(true);
    expect(parseOpenMeteoMarine(coast)).toEqual([
      { date: '2026-10-15', waveHeightMaxM: 1.4, wavePeriodMaxS: 11 },
    ]);
  });

  it('takes the top geocoding match, or null', () => {
    expect(parseGeocoding({})).toBeNull();
    expect(
      parseGeocoding({
        results: [
          {
            name: 'Paris',
            latitude: 48.85,
            longitude: 2.35,
            country: 'France',
            country_code: 'FR',
            admin1: 'Île-de-France',
            timezone: 'Europe/Paris',
          },
          {
            name: 'Paris',
            latitude: 33.66,
            longitude: -95.55,
            country: 'United States',
            country_code: 'US',
          },
        ],
      }),
    ).toEqual({
      name: 'Paris',
      country: 'France',
      countryCode: 'FR',
      region: 'Île-de-France',
      latitude: 48.85,
      longitude: 2.35,
      timezone: 'Europe/Paris',
    });
  });

  it('builds an Overpass query for ski resorts and downhill pistes within the radius', () => {
    const [resorts, pistes] = buildSkiAreaQueries(45.92, 6.87, 50);
    expect(resorts).toContain('"landuse"="winter_sports"');
    expect(pistes).toContain('"piste:type"="downhill"');
    expect(resorts).toContain('around:50000,45.92,6.87');
  });
});
