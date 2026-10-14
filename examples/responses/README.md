# Saved live responses

Captured 2026-10-14 around 22:05 IST against the live Open-Meteo / Overpass APIs with
`examples/query.sh <file> > examples/responses/<name>.json`.

- `chamonix.json`, `madrid.json`: required samples. Mid-October, so no snow at town level:
  skiing is 0 everywhere (`bestDay: null`) even though a ski area was found nearby.
- `biarritz.json`: surfing scored from the Marine API. Skiing is `null` because the public
  Overpass servers were overloaded (504 / timeouts) and the lookup hadn't succeeded yet;
  the next successful lookup is cached.
- `paris-ambiguous.json`: no country → top match is Paris, FR. Overpass found no ski area.
- `error-*.json`: error shapes (`CITY_NOT_FOUND`, `BAD_REQUEST`).

`fetchedAt` is UTC (ISO 8601 with `Z`).
