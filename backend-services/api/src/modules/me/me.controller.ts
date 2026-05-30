import type { Request, Response } from 'express';
import { UnauthenticatedError } from '@nova/shared';
import { resolveCurrentUser } from '../users/current-user';
import { toCurrentUserDto } from '../users/user.dto';
import type { UserRepository } from '../users/user.repository';

/** Returns the authenticated caller's profile with effective roles/permissions. */
export class MeController {
  constructor(private readonly users: UserRepository) {}

  me = async (req: Request, res: Response): Promise<void> => {
    if (!req.auth) {
      throw new UnauthenticatedError();
    }
    const { user, roles } = await resolveCurrentUser(this.users, req.auth);
    res.json(toCurrentUserDto(user, roles));
  };
}
