import { IssueActionStatus } from '@nova/database';
import type { IssueAction } from '@nova/database';
import { ValidationError } from '@nova/shared';
import type { AuthContext } from '../../auth/auth-context';
import { ActionService } from './action.service';
import type { ActionRepository } from './action.repository';
import type { IssueRepository } from '../issues/issue.repository';
import type { UserRepository, UserWithRoles } from '../users/user.repository';

const ISSUE_ID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';
const ACTION_ID = '11111111-1111-1111-1111-111111111111';

function auth(): AuthContext {
  return {
    subject: 'kc-support',
    applicationUserId: USER_ID,
    issuer: '',
    audience: [],
    roles: ['customer-support'],
    permissions: new Set(['create-actions']),
    scopes: [],
  } as unknown as AuthContext;
}

function makeAction(overrides: Partial<IssueAction> = {}): IssueAction {
  const now = new Date('2026-06-01T00:00:00.000Z');
  return {
    id: ACTION_ID,
    issueId: ISSUE_ID,
    title: 'Verify refund policy',
    description: 'Check SOP and confirm eligibility.',
    status: IssueActionStatus.PENDING,
    updatedById: USER_ID,
    updatedAI: false,
    createdDate: now,
    assignedOwnerId: USER_ID,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as IssueAction;
}

function userWithRoles(id: string): UserWithRoles {
  return { user: { id } as UserWithRoles['user'], roles: ['customer-support'] };
}

describe('ActionService.createAction', () => {
  it('defaults assignedOwnerId to the actor when omitted', async () => {
    const actions = {
      create: jest.fn(async () => ACTION_ID),
      findById: jest.fn(async () => makeAction()),
    } as unknown as ActionRepository;
    const users = {
      findById: jest.fn(async (id: string) => (id === USER_ID ? userWithRoles(USER_ID) : null)),
    } as unknown as UserRepository;
    const issues = {
      findById: jest.fn(async () => ({ id: ISSUE_ID })),
    } as unknown as IssueRepository;

    const service = new ActionService(actions, users, issues);
    const result = await service.createAction(
      {
        issueId: ISSUE_ID,
        title: 'Verify refund policy',
        description: 'Check SOP and confirm eligibility.',
      },
      auth(),
    );

    expect(actions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: ISSUE_ID,
        assignedOwnerId: USER_ID,
        status: IssueActionStatus.PENDING,
        updatedById: USER_ID,
      }),
    );
    expect(result.id).toBe(ACTION_ID);
  });

  it('rejects a missing issue FK', async () => {
    const actions = { create: jest.fn(), findById: jest.fn() } as unknown as ActionRepository;
    const users = {
      findById: jest.fn(async () => userWithRoles(USER_ID)),
    } as unknown as UserRepository;
    const issues = { findById: jest.fn(async () => null) } as unknown as IssueRepository;

    const service = new ActionService(actions, users, issues);
    await expect(
      service.createAction(
        { issueId: ISSUE_ID, title: 'T', description: 'D' },
        auth(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(actions.create).not.toHaveBeenCalled();
  });

  it('rejects an unknown assigned owner', async () => {
    const actions = { create: jest.fn(), findById: jest.fn() } as unknown as ActionRepository;
    const users = {
      findById: jest.fn(async (id: string) => (id === USER_ID ? userWithRoles(USER_ID) : null)),
    } as unknown as UserRepository;
    const issues = {
      findById: jest.fn(async () => ({ id: ISSUE_ID })),
    } as unknown as IssueRepository;

    const service = new ActionService(actions, users, issues);
    await expect(
      service.createAction(
        {
          issueId: ISSUE_ID,
          title: 'T',
          description: 'D',
          assignedOwnerId: '44444444-4444-4444-4444-444444444444',
        },
        auth(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(actions.create).not.toHaveBeenCalled();
  });
});
