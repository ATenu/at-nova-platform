import { User } from './user.entity';
import { Role } from './role.entity';
import { Permission } from './permission.entity';
import { UserRole } from './user-role.entity';
import { RolePermission } from './role-permission.entity';
import { Customer } from './customer.entity';
import { Product } from './product.entity';
import { Sale } from './sale.entity';
import { ProductSold } from './product-sold.entity';
import { CustomerIssue } from './customer-issue.entity';
import { IssueAction } from './issue-action.entity';
import { IssueActionDependency } from './issue-action-dependency.entity';
import { ActionComment } from './action-comment.entity';
import { Sop } from './sop.entity';
import { SopDetail } from './sop-detail.entity';
import { Conversation } from './conversation.entity';
import { Message } from './message.entity';

export {
  User,
  Role,
  Permission,
  UserRole,
  RolePermission,
  Customer,
  Product,
  Sale,
  ProductSold,
  CustomerIssue,
  IssueAction,
  IssueActionDependency,
  ActionComment,
  Sop,
  SopDetail,
  Conversation,
  Message,
};

export { TimestampedEntity } from './base.entity';

/** All entity classes, registered with the DataSource. */
export const ENTITIES = [
  User,
  Role,
  Permission,
  UserRole,
  RolePermission,
  Customer,
  Product,
  Sale,
  ProductSold,
  CustomerIssue,
  IssueAction,
  IssueActionDependency,
  ActionComment,
  Sop,
  SopDetail,
  Conversation,
  Message,
] as const;
