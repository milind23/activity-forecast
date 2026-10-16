import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Raw upstream payloads per location, stored verbatim (JSON text).
 * One row per location, overwritten on refresh; history isn't needed for v1.
 */
@Entity('forecast_snapshot')
export class ForecastSnapshotEntity {
  /** "lat,lon" rounded to 2 decimals. */
  @PrimaryColumn('varchar')
  locationKey!: string;

  @Column('simple-json')
  weatherRaw!: unknown;

  /** null = location has no marine data. */
  @Column('simple-json', { nullable: true })
  marineRaw!: unknown | null;

  @Column('varchar', { nullable: true })
  marineStatus!: string | null;

  @Column('datetime', { nullable: true })
  marineFetchedAt!: Date | null;

  @Column('boolean', { nullable: true })
  marineIsStale!: boolean | null;

  @Column('simple-json', { nullable: true })
  skiWeatherRaw!: unknown | null;

  @Column('varchar', { nullable: true })
  skiWeatherLocationKey!: string | null;

  @Column('datetime', { nullable: true })
  skiWeatherFetchedAt!: Date | null;

  @Column('datetime')
  fetchedAt!: Date;
}
