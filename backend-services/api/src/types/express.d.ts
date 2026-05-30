import type { AuthContext } from '../auth/auth-context';

declare global {
  namespace Express {
    interface Request {
      /** Populated by the authentication middleware for protected routes. */
      auth?: AuthContext;
    }
  }
}

export {};
