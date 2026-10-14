import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/** Geocoding result per normalised query ("paris|FR"). Coordinates don't move, so no TTL. */
@Entity('geocode_cache')
export class GeocodeCacheEntity {
  @PrimaryColumn('varchar')
  queryKey!: string;

  @Column('varchar')
  name!: string;

  @Column('varchar')
  country!: string;

  @Column('varchar')
  countryCode!: string;

  @Column('varchar', { nullable: true })
  region!: string | null;

  @Column('double')
  latitude!: number;

  @Column('double')
  longitude!: number;

  @Column('varchar')
  timezone!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
