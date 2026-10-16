/**
 * Turns per-day weather into the 28 (4 activities x 7 days) scores and ranks them.
 * Pure functions: no I/O, no framework.
 */
import { ALL_ACTIVITIES, Activity } from './activity';
import { DayScore, ScoreResult } from './score';
import { DailyMarine, DailyWeather, MarineDataStatus } from './weather';
import { SkiAreaStatus } from './ski-area';
import { scoreSkiing } from './scoring/skiing';
import { scoreSurfing } from './scoring/surfing';
import { scoreOutdoorSightseeing } from './scoring/outdoor-sightseeing';
import { scoreIndoorSightseeing } from './scoring/indoor-sightseeing';

export interface ScoringContext {
  skiArea: SkiAreaStatus;
  marineByDate: ReadonlyMap<string, DailyMarine>;
  /** undefined keeps legacy city weather; null means mountain weather failed. */
  skiWeatherByDate?: ReadonlyMap<string, DailyWeather> | null;
  marineStatus?: MarineDataStatus;
}

export interface ActivityRanking {
  activity: Activity;
  /** Best date, or null when no day has a positive score. */
  bestDay: string | null;
  /** Sorted best-first. */
  days: DayScore[];
}

export function scoreDay(
  activity: Activity,
  day: DailyWeather,
  ctx: ScoringContext,
): ScoreResult {
  switch (activity) {
    case Activity.SKIING: {
      if (ctx.skiArea !== 'nearby') return scoreSkiing(day, ctx.skiArea);
      if (ctx.skiWeatherByDate === null) {
        return { score: null, reason: 'mountain forecast unavailable' };
      }
      const skiDay =
        ctx.skiWeatherByDate === undefined
          ? day
          : ctx.skiWeatherByDate?.get(day.date);
      if (!skiDay)
        return { score: null, reason: 'mountain forecast unavailable' };
      return scoreSkiing(skiDay, ctx.skiArea);
    }
    case Activity.SURFING:
      if (ctx.marineStatus === 'not_applicable')
        return { score: 0, reason: 'no coastal waters near this location' };
      if (ctx.marineStatus === 'unavailable')
        return { score: null, reason: 'marine forecast unavailable' };
      return scoreSurfing(day, ctx.marineByDate.get(day.date));
    case Activity.OUTDOOR_SIGHTSEEING:
      return scoreOutdoorSightseeing(day);
    case Activity.INDOOR_SIGHTSEEING:
      return scoreIndoorSightseeing(day);
  }
}

/** Ordering: higher score first, null scores last, ties broken by earlier date. */
export function compareDayScores(a: DayScore, b: DayScore): number {
  if (a.score === null && b.score === null) return a.date.localeCompare(b.date);
  if (a.score === null) return 1;
  if (b.score === null) return -1;
  return b.score - a.score || a.date.localeCompare(b.date);
}

export function rankDays(days: DayScore[]): {
  bestDay: string | null;
  days: DayScore[];
} {
  const sorted = [...days].sort(compareDayScores);
  const top = sorted[0];
  const bestDay = top && top.score !== null && top.score > 0 ? top.date : null;
  return { bestDay, days: sorted };
}

/** Primary view: for each activity, its days ranked best-first. */
export function rankActivities(
  days: DailyWeather[],
  ctx: ScoringContext,
): ActivityRanking[] {
  return ALL_ACTIVITIES.map((activity) => {
    const scored = days.map((d) => ({
      date: d.date,
      ...scoreDay(activity, d, ctx),
    }));
    return { activity, ...rankDays(scored) };
  });
}

/**
 * Alternative reading of the brief ("which activity is best on each day"),
 * derived from the same scores. Not exposed in the API yet; kept to show both
 * views come from one source of truth.
 */
export function bestActivityPerDay(
  rankings: ActivityRanking[],
): { date: string; activity: Activity | null; score: number | null }[] {
  const dates = [
    ...new Set(rankings.flatMap((r) => r.days.map((d) => d.date))),
  ].sort();
  return dates.map((date) => {
    let best: { activity: Activity | null; score: number | null } = {
      activity: null,
      score: null,
    };
    for (const r of rankings) {
      const d = r.days.find((x) => x.date === date);
      if (d?.score != null && (best.score === null || d.score > best.score))
        best = { activity: r.activity, score: d.score };
    }
    return { date, ...best };
  });
}
