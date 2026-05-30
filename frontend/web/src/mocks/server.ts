import { setupServer } from 'msw/node';
import { handlers } from './handlers';

/** Node request-mocking server used by the test suite. */
export const server = setupServer(...handlers);
