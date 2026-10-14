/** Pre-filled in Apollo Sandbox at /graphql. Keep in sync with examples/chamonix.graphql. */
export const EXAMPLE_QUERY = `# Try other places: Biarritz (FR), Madrid (ES), Paris (no country = top match)
query ActivityForecast {
  activityForecast(city: "Chamonix", country: "FR") {
    location { name country region latitude longitude timezone }
    dataFreshness { fetchedAt isStale }
    activities {
      activity
      bestDay
      days { date score reason }
    }
  }
}
`;
