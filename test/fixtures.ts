/** Fixture payloads shaped like the real Open-Meteo responses, dated from today. */
export function isoDays(n: number, timeZone: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.now() + i * 86_400_000);
    out.push(new Intl.DateTimeFormat('en-CA', { timeZone }).format(d));
  }
  return out;
}

export const chamonixLocation = {
  name: 'Chamonix-Mont-Blanc',
  country: 'France',
  countryCode: 'FR',
  region: 'Auvergne-Rhône-Alpes',
  latitude: 45.9237,
  longitude: 6.8694,
  timezone: 'Europe/Paris',
};

export function chamonixWeatherRaw() {
  const time = isoDays(7, 'Europe/Paris');
  return {
    timezone: 'Europe/Paris',
    daily: {
      time,
      weather_code: [3, 73, 71, 0, 0, 61, 95],
      temperature_2m_max: [-2, -5, -3, 1, 4, 6, 8],
      temperature_2m_min: [-8, -10, -9, -6, -3, 0, 2],
      precipitation_sum: [0, 12, 6, 0, 0, 4, 10],
      precipitation_probability_max: [10, 90, 70, 5, 0, 60, 85],
      snowfall_sum: [0, 18, 6, 0, 0, 0, 0],
      wind_speed_10m_max: [12, 25, 15, 8, 10, 20, 45],
      sunshine_duration: [20000, 0, 3600, 36000, 36000, 7200, 0],
    },
    hourly: {
      time: time.map((d) => `${d}T12:00`),
      snow_depth: [0.9, 1.1, 1.2, 1.2, 1.15, 1.0, 0.9],
    },
  };
}
