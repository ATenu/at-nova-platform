import { InitialNovaSchema1717200000000 } from './1717200000000-InitialNovaSchema';
import { AddUserKeycloakIdentity1717300000000 } from './1717300000000-AddUserKeycloakIdentity';
import { McpReadDataSurface1717600000000 } from './1717600000000-McpReadDataSurface';
import { McpReadStatusAsText1717700000000 } from './1717700000000-McpReadStatusAsText';
import { DynamicRbac1717800000000 } from './1717800000000-DynamicRbac';
import { CapabilityRequiresApproval1717900000000 } from './1717900000000-CapabilityRequiresApproval';

/** Ordered list of migrations registered with the DataSource. */
export const MIGRATIONS = [
  InitialNovaSchema1717200000000,
  AddUserKeycloakIdentity1717300000000,
  McpReadDataSurface1717600000000,
  McpReadStatusAsText1717700000000,
  DynamicRbac1717800000000,
  CapabilityRequiresApproval1717900000000,
] as const;
