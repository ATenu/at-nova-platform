import type { Customer } from '@nova/database';

/** Stable, client-facing representation of a customer. Never leak the entity. */
export interface CustomerDto {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly age: number | null;
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function toCustomerDto(customer: Customer): CustomerDto {
  return {
    id: customer.id,
    email: customer.email,
    fullName: customer.fullName,
    firstName: customer.firstName,
    lastName: customer.lastName,
    age: customer.age,
    active: customer.active,
    createdAt: customer.createdAt.toISOString(),
    updatedAt: customer.updatedAt.toISOString(),
  };
}
