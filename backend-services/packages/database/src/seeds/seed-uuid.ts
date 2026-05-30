import { v5 as uuidv5 } from 'uuid';

/** Fixed namespace so seed keys always map to the same UUIDs across runs. */
export const NOVA_SEED_NAMESPACE = '3a14d7c5-6a78-47e5-b67e-47b0b7fd6d29';

/** Deterministic UUID for a stable seed key. */
export function seedUuid(seedKey: string): string {
  return uuidv5(seedKey, NOVA_SEED_NAMESPACE);
}
