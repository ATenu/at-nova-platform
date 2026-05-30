import { ConflictError, NotFoundError } from '@nova/shared';
import { buildPaginatedResult, type PaginatedResult } from '../../http/pagination';
import type { AuthContext } from '../../auth/auth-context';
import { resolveCurrentUser } from '../users/current-user';
import type { UserRepository } from '../users/user.repository';
import { toSopDetailDto, toSopDto, type SopDetailDto, type SopDto } from './sop.dto';
import type { SopListFilter, SopRepository } from './sop.repository';

export interface CreateSopInput {
  readonly name: string;
  readonly description: string;
  readonly active: boolean;
  readonly fullText: string;
}

export interface UpdateSopInput {
  readonly name?: string | undefined;
  readonly description?: string | undefined;
  readonly active?: boolean | undefined;
}

export class SopService {
  constructor(
    private readonly sops: SopRepository,
    private readonly users: UserRepository,
  ) {}

  async listSops(filter: SopListFilter): Promise<PaginatedResult<SopDto>> {
    const { items, total } = await this.sops.findPaginated(filter);
    return buildPaginatedResult(items.map(toSopDto), total, filter);
  }

  async getSopById(id: string): Promise<SopDto> {
    const sop = await this.sops.findById(id);
    if (!sop) {
      throw new NotFoundError('SOP not found.');
    }
    return toSopDto(sop);
  }

  async createSop(input: CreateSopInput, auth: AuthContext): Promise<SopDto> {
    if (await this.sops.findByName(input.name)) {
      throw new ConflictError('A SOP with this name already exists.');
    }
    const { user } = await resolveCurrentUser(this.users, auth);
    const id = await this.sops.create({
      name: input.name,
      description: input.description,
      active: input.active,
      fullText: input.fullText,
      createdById: user.id,
      dateOfCreation: new Date(),
    });
    return this.getSopById(id);
  }

  async updateSop(id: string, input: UpdateSopInput): Promise<SopDto> {
    const sop = await this.sops.findById(id);
    if (!sop) {
      throw new NotFoundError('SOP not found.');
    }
    if (input.name !== undefined && input.name !== sop.name) {
      const clash = await this.sops.findByName(input.name);
      if (clash && clash.id !== id) {
        throw new ConflictError('A SOP with this name already exists.');
      }
    }
    await this.sops.update(id, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    });
    return this.getSopById(id);
  }

  async addVersion(id: string, fullText: string, auth: AuthContext): Promise<SopDetailDto> {
    if (!(await this.sops.findById(id))) {
      throw new NotFoundError('SOP not found.');
    }
    const { user } = await resolveCurrentUser(this.users, auth);
    const detail = await this.sops.addVersion(id, fullText, user.id, new Date());
    return toSopDetailDto(detail);
  }
}
