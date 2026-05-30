import type { Sop, SopDetail } from '@nova/database';
import { toUserSummaryDto, type UserSummaryDto } from '../users/user.dto';

export interface SopDetailDto {
  readonly sopId: string;
  readonly version: number;
  readonly fullText: string;
  readonly dateOfCreation: string;
  readonly createdById: string;
  readonly createdBy?: UserSummaryDto | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SopDto {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
  readonly description: string;
  readonly details?: readonly SopDetailDto[] | undefined;
  readonly latestVersion?: number | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function toSopDetailDto(detail: SopDetail): SopDetailDto {
  return {
    sopId: detail.sopId,
    version: detail.version,
    fullText: detail.fullText,
    dateOfCreation: detail.dateOfCreation.toISOString(),
    createdById: detail.createdById,
    createdBy: detail.createdBy ? toUserSummaryDto(detail.createdBy) : undefined,
    createdAt: detail.createdAt.toISOString(),
    updatedAt: detail.updatedAt.toISOString(),
  };
}

export function toSopDto(sop: Sop): SopDto {
  const details = sop.details
    ? [...sop.details].sort((a, b) => b.version - a.version).map(toSopDetailDto)
    : undefined;
  return {
    id: sop.id,
    name: sop.name,
    active: sop.active,
    description: sop.description,
    details,
    latestVersion: details?.[0]?.version,
    createdAt: sop.createdAt.toISOString(),
    updatedAt: sop.updatedAt.toISOString(),
  };
}
