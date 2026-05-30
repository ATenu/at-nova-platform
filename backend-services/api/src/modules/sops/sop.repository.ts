import { Sop, SopDetail } from '@nova/database';
import type { DataSource, Repository } from 'typeorm';
import type { PageRequest } from '../../http/pagination';

export interface SopListFilter extends PageRequest {
  readonly search?: string;
  readonly active?: boolean;
}

export interface SopListResult {
  readonly items: Sop[];
  readonly total: number;
}

export interface CreateSopData {
  readonly name: string;
  readonly description: string;
  readonly active: boolean;
  readonly fullText: string;
  readonly createdById: string;
  readonly dateOfCreation: Date;
}

export interface UpdateSopData {
  readonly name?: string;
  readonly description?: string;
  readonly active?: boolean;
}

export class SopRepository {
  private readonly sops: Repository<Sop>;

  constructor(private readonly dataSource: DataSource) {
    this.sops = dataSource.getRepository(Sop);
  }

  async findPaginated(filter: SopListFilter): Promise<SopListResult> {
    const query = this.sops.createQueryBuilder('sop').leftJoinAndSelect('sop.details', 'details');

    if (filter.search) {
      query.andWhere('(sop.name ILIKE :search OR sop.description ILIKE :search)', {
        search: `%${filter.search}%`,
      });
    }
    if (filter.active !== undefined) {
      query.andWhere('sop.active = :active', { active: filter.active });
    }

    query
      .orderBy('sop.name', 'ASC')
      .skip((filter.page - 1) * filter.pageSize)
      .take(filter.pageSize);

    const [items, total] = await query.getManyAndCount();
    return { items, total };
  }

  async findById(id: string): Promise<Sop | null> {
    return this.sops.findOne({
      where: { id },
      relations: { details: { createdBy: true } },
    });
  }

  async findByName(name: string): Promise<Sop | null> {
    return this.sops.findOne({ where: { name } });
  }

  async create(data: CreateSopData): Promise<string> {
    return this.dataSource.transaction(async (manager) => {
      const sopRepo = manager.getRepository(Sop);
      const detailRepo = manager.getRepository(SopDetail);
      const sop = await sopRepo.save(
        sopRepo.create({ name: data.name, description: data.description, active: data.active }),
      );
      await detailRepo.insert({
        sopId: sop.id,
        version: 1,
        fullText: data.fullText,
        dateOfCreation: data.dateOfCreation,
        createdById: data.createdById,
      });
      return sop.id;
    });
  }

  async update(id: string, data: UpdateSopData): Promise<void> {
    await this.sops.update({ id }, data);
  }

  /** Append a new immutable detail version. Returns the created detail. */
  async addVersion(
    sopId: string,
    fullText: string,
    createdById: string,
    dateOfCreation: Date,
  ): Promise<SopDetail> {
    return this.dataSource.transaction(async (manager) => {
      const detailRepo = manager.getRepository(SopDetail);
      const latest = await detailRepo
        .createQueryBuilder('detail')
        .where('detail.sop_id = :sopId', { sopId })
        .orderBy('detail.version', 'DESC')
        .setLock('pessimistic_write')
        .getOne();
      const version = (latest?.version ?? 0) + 1;
      const detail = detailRepo.create({
        sopId,
        version,
        fullText,
        dateOfCreation,
        createdById,
      });
      await detailRepo.insert(detail);
      const reloaded = await detailRepo.findOne({
        where: { sopId, version },
        relations: { createdBy: true },
      });
      return reloaded ?? detail;
    });
  }
}
