import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Location } from '../../domain';
import {
  ForecastRepositoryPort,
  ForecastSnapshot,
  SkiTerrainRecord,
} from '../../application/ports';
import {
  ForecastSnapshotEntity,
  GeocodeCacheEntity,
  SkiTerrainEntity,
} from './entities';

/** TypeORM implementation of the repository port. Maps entities <-> plain objects. */
@Injectable()
export class TypeOrmForecastRepository implements ForecastRepositoryPort {
  constructor(
    @InjectRepository(GeocodeCacheEntity)
    private readonly geocodes: Repository<GeocodeCacheEntity>,
    @InjectRepository(ForecastSnapshotEntity)
    private readonly snapshots: Repository<ForecastSnapshotEntity>,
    @InjectRepository(SkiTerrainEntity)
    private readonly terrain: Repository<SkiTerrainEntity>,
  ) {}

  async findGeocode(queryKey: string): Promise<Location | null> {
    const row = await this.geocodes.findOneBy({ queryKey });
    if (!row) return null;
    return {
      name: row.name,
      country: row.country,
      countryCode: row.countryCode,
      region: row.region ?? undefined,
      latitude: row.latitude,
      longitude: row.longitude,
      timezone: row.timezone,
    };
  }

  async saveGeocode(queryKey: string, l: Location): Promise<void> {
    await this.geocodes.save({ queryKey, ...l, region: l.region ?? null });
  }

  async findSnapshot(locationKey: string): Promise<ForecastSnapshot | null> {
    const row = await this.snapshots.findOneBy({ locationKey });
    return row ? { ...row, fetchedAt: new Date(row.fetchedAt) } : null;
  }

  async saveSnapshot(s: ForecastSnapshot): Promise<void> {
    await this.snapshots.save({ ...s });
  }

  async findSkiTerrain(locationKey: string): Promise<SkiTerrainRecord | null> {
    const row = await this.terrain.findOneBy({ locationKey });
    return row ? { ...row, checkedAt: new Date(row.checkedAt) } : null;
  }

  async saveSkiTerrain(r: SkiTerrainRecord): Promise<void> {
    await this.terrain.save({ ...r });
  }
}
