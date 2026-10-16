# Scoring and recommendation model

This is the auditable specification for the v1 heuristic model. The source of truth is
the pure functions under `src/domain/scoring/`; their named constants and unit tests match
the rules below. Scores describe **weather suitability within one activity**, not purchase
certainty, personal safety, price, or a scientific comparison between different activities.

## Decision pipeline

1. Resolve the city/country and the seven local calendar dates (today + 6).
2. Load persisted atmospheric, marine and, when applicable, mountain weather.
3. Establish applicability: a real nearby ski area is required for skiing and coastal
   marine data is required for surfing.
4. Produce one 0–100 score per activity/day. `null` means required data was unavailable;
   `0` means the activity was assessed and conditions/applicability were bad.
5. Sort each activity's days by score descending, with `null` last and earlier date first
   when scores tie.
6. Classify the best day: `PLAN` ≥ 70, `CONSIDER` 40–69, `SKIP` 0–39, or `UNAVAILABLE`
   for `null`.
7. Apply operational evidence: a resort reported `CLOSED` always changes skiing to `SKIP`;
   unknown live operations, surf conditions and indoor venue availability require a live
   check before booking.

All linear ranges below use clamped interpolation. The final score is rounded to the
nearest integer and clamped to 0–100.

## Skiing

A ski venue must exist within the configured radius. `none` produces 0; a failed lookup
produces `null`. Once a venue is known, the service scores its representative mountain
coordinate/elevation—not valley-town weather.

`score = snow base + fresh snow + temperature + wind`

| Component | Points | Rule |
|---|---:|---|
| Snow base | 0–45 | Below 0.10 m = 0; 0.10–1.00 m interpolates 10–45; ≥1.00 m = 45 |
| Fresh snow | 0–25 | 0–10 cm interpolates 0–25; ≥10 cm = 25 |
| Temperature | 0–20 | Full points for daily max −12…2 °C; loses points linearly to zero 8 °C outside that band; missing temperature = 10 |
| Wind | 0–10 | Full at ≤30 km/h; linearly reaches zero at 60 km/h |

Safety/feasibility gates override the sum:

- no base (<0.10 m) and <1 cm fresh snow → score 0;
- wind ≥60 km/h → score capped at 39, so likely lift-closing wind is never recommended;
- a venue explicitly reported closed → recommendation `SKIP`, even if its weather score is high.

## Surfing

Missing or unavailable marine data produces `null`; a confirmed inland/non-coastal
location produces 0 before this function is called.

`score = wave height + wave period + wind`, except a flat sea forces 0.

| Component | Points | Rule |
|---|---:|---|
| Wave height | 0–50 | <0.30 m = flat/0 total; 0.30–1.00 m interpolates 5–50; 1.00–2.50 m = 50; 2.50–4.00 m falls 50–10; ≥4.00 m = 10 |
| Wave period | 0–30 | 6–12 s interpolates 0–30; missing period = 10 |
| Wind | 0–20 | Full at ≤15 km/h; linearly reaches zero at 40 km/h |

This intentionally does not model tide, swell direction, bathymetry, beach orientation or
surfer skill. Therefore a positive surf recommendation remains `VERIFY_LIVE_STATUS` with
explicit local checks.

## Outdoor sightseeing

Start at 100 and subtract penalties:

| Penalty | Maximum | Rule |
|---|---:|---|
| Rain | 45 | Take the worse of probability (20–100% → 0–45) and amount (0.2–8 mm → 0–45) |
| Temperature | 30 | 3 points per °C outside a 15–26 °C daily-max comfort band |
| Wind | 15 | 30–60 km/h interpolates 0–15 |
| Lack of sunshine | 10 | 6–0 sunshine hours interpolates 0–10 |

A thunderstorm weather code caps the result at 10. Open-Meteo normally supplies these
fields; missing precipitation/wind is treated as zero and missing temperature/sun adds no
penalty, an explicit optimistic v1 assumption that should be revisited if providers change.

## Indoor sightseeing

Indoor activity is always possible from a weather perspective, so it has a floor of 40 and
rises when outdoor conditions deteriorate:

`indoor = 40 + (100 − outdoor score) × 0.60`

It deliberately does not infer that a destination has a suitable venue or that tickets are
available; non-skipped results therefore require venue verification.

## Confidence and booking readiness

The numeric score drives only `action`. Separate fields prevent a good weather score from
being mistaken for a purchase guarantee:

- `confidence` falls when required activity data is missing/stale or when evidence is
  inherently incomplete (skiing and surfing start at medium even with fresh model data).
- `bookingReadiness` distinguishes ready to plan, verify live status, not recommended,
  not applicable, and data unavailable.
- `dataAsOf`, `evidence`, and `checksBeforeBooking` expose why the decision was made and
  what must still be checked.

## Validation and evolution

Unit tests pin every boundary and cap; deterministic GraphQL scenarios cover ski, inland,
coastal, provider-failure and conflicting-weather cases. A production v2 should calibrate
weights/thresholds using observed outcomes, segment by skill level, version the scoring
policy in the API, and monitor recommendation distribution/drift before changing constants.
