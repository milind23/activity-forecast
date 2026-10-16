# Live booking smoke — 2026-10-16 IST

This is a concise execution record, not a golden fixture. Live forecast values and public
provider availability will change.

## Execution

- Built service started in production mode on port 3101.
- Fresh isolated SQLite database: `/tmp/activity-forecast-booking-smoke-v2.sqlite`.
- Same lean GraphQL selection sent for three city/country pairs.
- Atmospheric, marine and geocoding calls used the configured live Open-Meteo services.
- No response was manually edited into a test assertion.

## Results

| Input | Key live result | Safety/provenance behavior |
|---|---|---|
| Zermatt, Switzerland | Skiing `PLAN` for 2026-10-21, 88/100: 70 cm modeled snow depth and 17.3 cm fresh snow at the 3000 m target | `VERIFY_LIVE_STATUS`, medium confidence, Matterhorn Ski Paradise named, official lift/piste link returned, operations explicitly `UNKNOWN` |
| Phoenix, United States of America | Surfing `NOT_APPLICABLE`; outdoor sightseeing `PLAN` for 2026-10-18 | Ski lookup exceeded the public-provider deadline, so result stayed `DATA_UNAVAILABLE` with `dataAsOf: null`; it did not falsely claim “no resort” |
| Biarritz, France | Surfing `PLAN` for 2026-10-16, 100/100; outdoor sightseeing `PLAN` for 2026-10-18 | Surf remained `VERIFY_LIVE_STATUS` with tide, beach-warning and ability checks |

The service logs also captured the expected real dependency failure: the public Overpass
endpoint returned HTTP 502/capacity errors and timed out for uncatalogued destinations.
Zermatt was unaffected because the reviewed catalog resolved the venue immediately. This is
why the API distinguishes `DATA_UNAVAILABLE` from `NOT_APPLICABLE`, and why the README does
not claim global deterministic ski coverage.

The process was stopped after the matrix; the database is temporary and is not part of the
submission.
