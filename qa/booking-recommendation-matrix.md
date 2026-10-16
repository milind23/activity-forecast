# Booking recommendation QA matrix

This matrix converts the product concern into observable acceptance criteria. The automated
cases run through Nest, GraphQL, the recommendation service and an in-memory TypeORM
database; only external HTTP adapters are replaced with deterministic fakes.

| Scenario | Expected product behavior | Automated evidence |
|---|---|---|
| Zermatt, resort known, strong snow at 3000 m, live operations unknown | `SKIING = PLAN`, `VERIFY_LIVE_STATUS`, medium confidence; name the resort and official status check | `booking-scenarios.e2e-spec.ts` |
| Zermatt valley is mild but mountain is snowy | Use the separate 3000 m forecast, never village snow, for skiing | Service unit + scenario e2e |
| Resort reports `OPEN` | Strong ski weather may be `READY_TO_PLAN`; safety checks remain | Recommendation domain unit |
| Resort reports `CLOSED` with excellent snow | Force `SKIP`, no recommended date | Recommendation domain unit |
| Mountain forecast reaches likely lift-closing wind (60+ km/h) | Hard-cap below `CONSIDER`; excellent snow must not produce a booking signal | Ski scoring unit |
| Stored atmospheric weather is stale | Preserve the decision when seven-date coverage remains, downgrade confidence and disclose fallback | Service + recommendation domain units |
| Phoenix, no nearby ski venue or coastal water | `SKIING` and `SURFING` are `SKIP / NOT_APPLICABLE`, not provider errors | Scenario e2e |
| Biarritz, usable waves | `SURFING = PLAN / VERIFY_LIVE_STATUS`; retain tide, beach-warning and ability checks | Scenario e2e |
| Terrain provider outage | `SKIING = UNAVAILABLE / DATA_UNAVAILABLE`; outdoor/indoor answers still succeed | Scenario e2e |
| Mountain weather provider outage | Do not substitute valley weather; skiing is unavailable | Service/ranking units |
| Good outdoor day and storm day in one window | Recommend the activities on different locally appropriate dates | Scenario e2e |
| Country entered as full name/alias | Normalize names such as `United States of America` before geocoding | Country unit + GraphQL e2e |
| Repeated request inside TTL | Serve persisted weather/terrain/mountain evidence without another provider call | Service units |

The final independent QA pass also probes combinations that are easy to miss in a happy
path: `CLOSED` plus missing mountain weather, fresh city weather plus stale mountain data,
and a known resort with no mountain response.

Run the repeatable gate:

```bash
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run build
npm run lint:check
npm run format:check
```

Live-provider smoke tests are useful evidence, but they are intentionally not CI assertions:
forecasts change, public Overpass availability varies, and a resort's operating state must
come from its current authoritative page. Save any manual responses under
`examples/responses/` with the execution date instead of making them golden fixtures.

## Explicit non-goals for this take-home

- No claim of global resort coverage: the deterministic fallback catalog has two reviewed
  entries, and other destinations depend on OSM discovery.
- No claim that `PLAN` guarantees safety, venue opening or purchasable inventory.
- No fabricated live lift state. Unknown operations require verification.
- No user-specific skill, accessibility, budget or risk model.
