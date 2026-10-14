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

  @Column('datetime')
  fetchedAt!: Date;
}
