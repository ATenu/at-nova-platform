import { InitialNovaSchema1717200000000 } from './1717200000000-InitialNovaSchema';
import { AddUserKeycloakIdentity1717300000000 } from './1717300000000-AddUserKeycloakIdentity';

/** Ordered list of migrations registered with the DataSource. */
export const MIGRATIONS = [
  InitialNovaSchema1717200000000,
  AddUserKeycloakIdentity1717300000000,
] as const;
