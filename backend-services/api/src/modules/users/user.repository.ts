import { User, UserRole } from '@nova/database';
import type { DataSource, Repository } from 'typeorm';
import type { PageRequest } from '../../http/pagination';

export interface UserListFilter extends PageRequest {
  readonly search?: string;
  readonly role?: string;
}

export interface UserWithRoles {
  readonly user: User;
  readonly roles: string[];
}

export interface UserListResult {
  readonly items: readonly UserWithRoles[];
  readonly total: number;
}

export interface CreateUserData {
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly middleName: string | null;
  readonly description: string | null;
  readonly keycloakId: string | null;
  readonly active: boolean;
}

export interface UpdateUserData {
  readonly firstName?: string;
  readonly lastName?: string;
  readonly middleName?: string | null;
  readonly description?: string | null;
  readonly active?: boolean;
}

function rolesOf(user: User): string[] {
  return (user.userRoles ?? []).map((userRole) => userRole.roleName).sort();
}

/** Data-access for application users and their role mappings. */
export class UserRepository {
  private readonly users: Repository<User>;

  constructor(private readonly dataSource: DataSource) {
    this.users = dataSource.getRepository(User);
  }

  async findPaginated(filter: UserListFilter): Promise<UserListResult> {
    const query = this.users
      .createQueryBuilder('u')
      .leftJoinAndSelect('u.userRoles', 'ur');

    if (filter.search) {
      query.andWhere(
        '(u.email ILIKE :search OR u.first_name ILIKE :search OR u.last_name ILIKE :search)',
        { search: `%${filter.search}%` },
      );
    }
    if (filter.role) {
      query.andWhere(
        'EXISTS (SELECT 1 FROM "user_roles" "urf" WHERE "urf"."user_id" = u.id AND "urf"."role_name" = :role)',
        { role: filter.role },
      );
    }

    query
      .orderBy('u.createdAt', 'DESC')
      .addOrderBy('u.id', 'DESC')
      .skip((filter.page - 1) * filter.pageSize)
      .take(filter.pageSize);

    const [items, total] = await query.getManyAndCount();
    return { items: items.map((user) => ({ user, roles: rolesOf(user) })), total };
  }

  async findById(id: string): Promise<UserWithRoles | null> {
    const user = await this.users.findOne({ where: { id }, relations: { userRoles: true } });
    return user ? { user, roles: rolesOf(user) } : null;
  }

  async findByEmail(email: string): Promise<UserWithRoles | null> {
    const user = await this.users.findOne({ where: { email }, relations: { userRoles: true } });
    return user ? { user, roles: rolesOf(user) } : null;
  }

  async findByKeycloakId(keycloakId: string): Promise<UserWithRoles | null> {
    const user = await this.users.findOne({
      where: { keycloakId },
      relations: { userRoles: true },
    });
    return user ? { user, roles: rolesOf(user) } : null;
  }

  async create(data: CreateUserData): Promise<User> {
    const user = this.users.create(data);
    return this.users.save(user);
  }

  async update(id: string, data: UpdateUserData): Promise<void> {
    await this.users.update({ id }, data);
  }

  async setKeycloakId(id: string, keycloakId: string | null): Promise<void> {
    await this.users.update({ id }, { keycloakId });
  }

  /** Replace a user's role mappings atomically with the provided valid roles. */
  async replaceRoles(id: string, roles: readonly string[]): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(UserRole);
      await repo.delete({ userId: id });
      if (roles.length > 0) {
        await repo.insert(roles.map((roleName) => ({ userId: id, roleName })));
      }
    });
  }
}
