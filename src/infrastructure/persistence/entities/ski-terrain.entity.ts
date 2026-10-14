import { Column, Entity, PrimaryColumn } from 'typeorm';

/** Cached Overpass answer: is there a ski area near this location? */
@Entity('ski_terrain')
export class SkiTerrainEntity {
  @PrimaryColumn('varchar')
  locationKey!: string;

  @Column('boolean')
  hasSkiArea!: boolean;

  @Column('datetime')
  checkedAt!: Date;
}
