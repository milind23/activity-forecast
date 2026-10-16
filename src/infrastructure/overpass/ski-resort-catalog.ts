import {
  Location,
  SkiArea,
  SkiAreaSource,
  SkiOperatingStatus,
} from '../../domain';

/**
 * Small versioned seed for deterministic fallbacks when public Overpass is busy.
 * A production deployment would import a reviewed global OSM/resort dataset into
 * its own geospatial database. Keeping this list explicit avoids pretending the
 * take-home ships that global dataset.
 */
export const SKI_RESORT_CATALOG: readonly (SkiArea & {
  countryCode: string;
  localityLatitude: number;
  localityLongitude: number;
})[] = [
  {
    id: 'catalog:matterhorn-ski-paradise',
    name: 'Matterhorn Ski Paradise',
    countryCode: 'CH',
    localityLatitude: 45.9763,
    localityLongitude: 7.6586,
    // Representative high-alpine ski terrain, rather than Zermatt village.
    latitude: 45.9384,
    longitude: 7.729,
    forecastElevationM: 3000,
    source: SkiAreaSource.CURATED_CATALOG,
    sourceUrl: 'https://zermatt.swiss/en/ski',
    operatingStatus: SkiOperatingStatus.UNKNOWN,
    operationsUrl: 'https://zermatt.swiss/en/info/lifts-pistes',
  },
  {
    id: 'catalog:chamonix-mont-blanc',
    name: 'Chamonix Mont-Blanc ski areas',
    countryCode: 'FR',
    localityLatitude: 45.9237,
    localityLongitude: 6.8694,
    latitude: 45.965,
    longitude: 6.862,
    forecastElevationM: 2500,
    source: SkiAreaSource.CURATED_CATALOG,
    sourceUrl: 'https://www.montblancnaturalresort.com/en/',
    operatingStatus: SkiOperatingStatus.UNKNOWN,
    operationsUrl: 'https://www.montblancnaturalresort.com/en/opening',
  },
] as const;

export function findCatalogSkiArea(
  location: Pick<Location, 'countryCode' | 'latitude' | 'longitude'>,
  radiusKm: number,
): SkiArea | null {
  const match = SKI_RESORT_CATALOG.filter(
    (area) => area.countryCode === location.countryCode.toUpperCase(),
  )
    .map((area) => ({
      area,
      distanceKm: haversineKm(
        location.latitude,
        location.longitude,
        area.localityLatitude,
        area.localityLongitude,
      ),
    }))
    .filter(({ distanceKm }) => distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)[0]?.area;

  if (!match) return null;
  return {
    id: match.id,
    name: match.name,
    latitude: match.latitude,
    longitude: match.longitude,
    forecastElevationM: match.forecastElevationM,
    source: match.source,
    sourceUrl: match.sourceUrl,
    operatingStatus: match.operatingStatus,
    operationsUrl: match.operationsUrl,
  };
}

export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
