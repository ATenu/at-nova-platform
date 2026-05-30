import { randomUUID } from 'node:crypto';
import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import type { Logger } from '@nova/shared';
import { ForbiddenError } from '@nova/shared';
import type { DataSource } from 'typeorm';
import type { ApiConfig } from './config';
import { TokenVerifier } from './auth/token-verifier';
import { createAuthenticate } from './auth/authenticate';
import { KeycloakAdminClient } from './auth/keycloak-admin-client';
import { createErrorHandler } from './http/error-handler';
import { notFoundHandler } from './http/not-found';
import { createHealthRouter } from './modules/health/health.routes';
import { UserRepository } from './modules/users/user.repository';
import { createMeRouter } from './modules/me/me.routes';
import { CustomerRepository } from './modules/customers/customer.repository';
import { CustomerService } from './modules/customers/customer.service';
import { createCustomerRouter } from './modules/customers/customer.routes';
import { ProductRepository } from './modules/products/product.repository';
import { ProductService } from './modules/products/product.service';
import { createProductRouter } from './modules/products/product.routes';
import { SaleRepository } from './modules/sales/sale.repository';
import { SaleService } from './modules/sales/sale.service';
import { createSaleRouter } from './modules/sales/sale.routes';
import { IssueRepository } from './modules/issues/issue.repository';
import { IssueService } from './modules/issues/issue.service';
import { createIssueRouter } from './modules/issues/issue.routes';
import { ActionRepository } from './modules/actions/action.repository';
import { ActionService } from './modules/actions/action.service';
import { createActionRouter } from './modules/actions/action.routes';
import { SopRepository } from './modules/sops/sop.repository';
import { SopService } from './modules/sops/sop.service';
import { createSopRouter } from './modules/sops/sop.routes';
import { AdminUserService } from './modules/admin/admin-user.service';
import { RbacService } from './modules/admin/rbac.service';
import { KeycloakProvisioningService } from './modules/admin/keycloak-provisioning.service';
import { createAdminRouter } from './modules/admin/admin.routes';
import { ConversationRepository } from './modules/chat/conversation.repository';
import { ChatService } from './modules/chat/chat.service';
import { LocalAgentGateway } from './modules/chat/agent-gateway';
import { createA2aRouter, createConversationsRouter } from './modules/chat/chat.routes';

export interface AppDependencies {
  readonly config: ApiConfig;
  readonly logger: Logger;
  readonly dataSource: DataSource;
}

function buildCorsOptions(config: ApiConfig): cors.CorsOptions {
  const allowlist = new Set(config.corsAllowedOrigins);
  return {
    origin: (origin, callback) => {
      // Allow non-browser clients (no Origin header) and explicitly listed origins.
      if (!origin || allowlist.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new ForbiddenError('Origin is not allowed by CORS policy.'));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
    maxAge: 600,
  };
}

/**
 * Compose the Express application: security headers, CORS, body limits, rate
 * limiting, request-scoped logging with correlation IDs, the centralized auth
 * pipeline, feature routers, and the single error handler.
 */
export function createApp(deps: AppDependencies): Express {
  const { config, logger, dataSource } = deps;
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors(buildCorsOptions(config)));
  app.use(express.json({ limit: config.bodyLimit }));

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const header = req.headers['x-request-id'];
        const id = typeof header === 'string' && header.length > 0 ? header : randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      // 4xx are expected client errors; keep them at info, reserve error for 5xx.
      customLogLevel: (_req, res, err) => {
        if (res.statusCode >= 500 || err) {
          return 'error';
        }
        if (res.statusCode >= 400) {
          return 'warn';
        }
        return 'info';
      },
    }),
  );

  app.use(
    rateLimit({
      windowMs: config.rateLimit.windowMs,
      limit: config.rateLimit.max,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
    }),
  );

  const verifier = new TokenVerifier(config.auth);
  const authenticate = createAuthenticate(verifier);

  // Repositories (data access).
  const userRepository = new UserRepository(dataSource);
  const customerRepository = new CustomerRepository(dataSource);
  const productRepository = new ProductRepository(dataSource);
  const saleRepository = new SaleRepository(dataSource);
  const issueRepository = new IssueRepository(dataSource);
  const actionRepository = new ActionRepository(dataSource);
  const sopRepository = new SopRepository(dataSource);
  const conversationRepository = new ConversationRepository(dataSource);

  // Keycloak Admin integration for backend-driven user provisioning.
  const keycloakAdminClient = config.keycloakAdmin
    ? new KeycloakAdminClient(config.keycloakAdmin)
    : null;
  const provisioning = new KeycloakProvisioningService(keycloakAdminClient);
  logger.info({ keycloakProvisioning: provisioning.isEnabled }, 'keycloak provisioning configured');

  // Services (business rules).
  const customerService = new CustomerService(customerRepository);
  const productService = new ProductService(productRepository);
  const saleService = new SaleService(saleRepository, productRepository, customerRepository);
  const issueService = new IssueService(issueRepository, saleRepository);
  const actionService = new ActionService(actionRepository, userRepository);
  const sopService = new SopService(sopRepository, userRepository);
  const adminUserService = new AdminUserService(userRepository, provisioning);
  const rbacService = new RbacService(dataSource);
  const chatService = new ChatService(conversationRepository, userRepository, new LocalAgentGateway());

  app.use('/health', createHealthRouter({ dataSource }));
  app.use('/api/v1/auth', createMeRouter({ authenticate, users: userRepository }));
  app.use('/api/v1/customers', createCustomerRouter({ authenticate, service: customerService }));
  app.use('/api/v1/products', createProductRouter({ authenticate, service: productService }));
  app.use('/api/v1/sales', createSaleRouter({ authenticate, service: saleService }));
  app.use('/api/v1/issues', createIssueRouter({ authenticate, service: issueService }));
  app.use('/api/v1/actions', createActionRouter({ authenticate, service: actionService }));
  app.use('/api/v1/sops', createSopRouter({ authenticate, service: sopService }));
  app.use('/api/v1/admin', createAdminRouter({ authenticate, userService: adminUserService, rbacService }));
  app.use('/api/v1/conversations', createConversationsRouter({ authenticate, service: chatService }));
  app.use('/api/v1/a2a', createA2aRouter({ authenticate, service: chatService }));

  app.use(notFoundHandler());
  app.use(createErrorHandler());

  return app;
}
