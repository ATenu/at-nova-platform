import { ConflictError, NotFoundError } from '@nova/shared';
import { buildPaginatedResult, type PaginatedResult } from '../../http/pagination';
import { toAdminUserDto, type AdminUserDto } from '../users/user.dto';
import type { UserListFilter, UserRepository, UserWithRoles } from '../users/user.repository';
import type { KeycloakProvisioningService, ProvisionResult } from './keycloak-provisioning.service';

export interface CreateUserInput {
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly middleName?: string | null | undefined;
  readonly description?: string | null | undefined;
  readonly roles: readonly string[];
  readonly sendResetPasswordEmail?: boolean | undefined;
}

export interface UpdateUserInput {
  readonly firstName?: string | undefined;
  readonly lastName?: string | undefined;
  readonly middleName?: string | null | undefined;
  readonly description?: string | null | undefined;
  readonly active?: boolean | undefined;
}

export class AdminUserService {
  constructor(
    private readonly users: UserRepository,
    private readonly provisioning: KeycloakProvisioningService,
  ) {}

  async listUsers(filter: UserListFilter): Promise<PaginatedResult<AdminUserDto>> {
    const { items, total } = await this.users.findPaginated(filter);
    return buildPaginatedResult(
      items.map(({ user, roles }) => toAdminUserDto(user, roles)),
      total,
      filter,
    );
  }

  async getUser(id: string): Promise<AdminUserDto> {
    const found = await this.users.findById(id);
    if (!found) {
      throw new NotFoundError('User not found.');
    }
    return toAdminUserDto(found.user, found.roles);
  }

  async createUser(input: CreateUserInput): Promise<AdminUserDto> {
    const email = input.email.toLowerCase();
    if (await this.users.findByEmail(email)) {
      throw new ConflictError('A user with this email already exists.');
    }

    const created = await this.users.create({
      email,
      firstName: input.firstName,
      lastName: input.lastName,
      middleName: input.middleName ?? null,
      description: input.description ?? null,
      keycloakId: null,
      active: true,
    });
    await this.users.replaceRoles(created.id, input.roles);

    const provision = await this.provisioning.provisionUser({
      username: email,
      email,
      firstName: input.firstName,
      lastName: input.lastName,
      enabled: true,
      roles: input.roles,
      ...(input.sendResetPasswordEmail !== undefined
        ? { sendResetPasswordEmail: input.sendResetPasswordEmail }
        : {}),
    });
    if (provision.keycloakId) {
      await this.users.setKeycloakId(created.id, provision.keycloakId);
    }

    return this.reloadWithStatus(created.id, provision);
  }

  async updateUser(id: string, input: UpdateUserInput): Promise<AdminUserDto> {
    const existing = await this.users.findById(id);
    if (!existing) {
      throw new NotFoundError('User not found.');
    }

    await this.users.update(id, {
      ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
      ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
      ...(input.middleName !== undefined ? { middleName: input.middleName } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    });

    return this.syncAndReload(id);
  }

  async setUserRoles(id: string, roles: readonly string[]): Promise<AdminUserDto> {
    const existing = await this.users.findById(id);
    if (!existing) {
      throw new NotFoundError('User not found.');
    }
    await this.users.replaceRoles(id, roles);
    return this.syncAndReload(id);
  }

  async syncUserToKeycloak(id: string): Promise<AdminUserDto> {
    const found = await this.users.findById(id);
    if (!found) {
      throw new NotFoundError('User not found.');
    }
    const provision = await this.provisioning.syncUser({
      username: found.user.email,
      email: found.user.email,
      firstName: found.user.firstName,
      lastName: found.user.lastName,
      enabled: found.user.active,
      roles: found.roles,
      existingKeycloakId: found.user.keycloakId,
    });
    if (provision.keycloakId && provision.keycloakId !== found.user.keycloakId) {
      await this.users.setKeycloakId(id, provision.keycloakId);
    }
    return this.reloadWithStatus(id, provision);
  }

  /** Reconcile Keycloak (when provisioned) after a local change, then reload. */
  private async syncAndReload(id: string): Promise<AdminUserDto> {
    const found = await this.requireUser(id);
    if (!this.provisioning.isEnabled || found.user.keycloakId === null) {
      return toAdminUserDto(found.user, found.roles);
    }
    const provision = await this.provisioning.syncUser({
      username: found.user.email,
      email: found.user.email,
      firstName: found.user.firstName,
      lastName: found.user.lastName,
      enabled: found.user.active,
      roles: found.roles,
      existingKeycloakId: found.user.keycloakId,
    });
    return toAdminUserDto(found.user, found.roles, {
      status: provision.status,
      lastSyncError: provision.lastSyncError,
    });
  }

  private async reloadWithStatus(id: string, provision: ProvisionResult): Promise<AdminUserDto> {
    const found = await this.requireUser(id);
    return toAdminUserDto(found.user, found.roles, {
      status: provision.status,
      lastSyncError: provision.lastSyncError,
    });
  }

  private async requireUser(id: string): Promise<UserWithRoles> {
    const found = await this.users.findById(id);
    if (!found) {
      throw new NotFoundError('User not found.');
    }
    return found;
  }
}
