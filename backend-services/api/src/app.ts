import { randomUUID } from 'node:crypto';
import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import pinoHttp from 'pino-http';
import type { Logger, RedisConnection } from '@nova/shared';
import { ForbiddenError, ServiceTokenClient } from '@nova/shared';
import type { DataSource } from 'typeorm';
import type { ApiConfig } from './config';
import { createRateLimiter } from './http/rate-limit';
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
import { RbacAdminService } from './modules/admin/rbac-admin.service';
import { KeycloakProvisioningService } from './modules/admin/keycloak-provisioning.service';
import { createAdminRouter } from './modules/admin/admin.routes';
import { createRbacRegistryRouter } from './modules/rbac/rbac-registry.routes';
import { createInternalRbacRegistryRouter } from './modules/rbac/internal-rbac-registry.routes';
import { ConversationRepository } from './modules/chat/conversation.repository';
import { ChatService } from './modules/chat/chat.service';
import { createConversationsRouter } from './modules/chat/chat.routes';
import { AgentRunRepository } from './modules/agent-runs/agent-run.repository';
import { AgentRunService } from './modules/agent-runs/agent-run.service';
import { OrchestratorClient } from './modules/agent-runs/orchestrator-client';
import { createA2aChatRouter, createAgentRunRouter } from './modules/agent-runs/agent-run.routes';
import { ToolGatewayService } from './modules/agent-runs/tool-gateway.service';
import { createToolGatewayRouter } from './modules/agent-runs/tool-gateway.routes';
import { ServiceTokenVerifier } from './auth/service-token-verifier';
import { createServiceAuthenticate } from './auth/service-authenticate';
import { RbacRegistryService } from './rbac/rbac-registry.service';

export interface AppDependencies {
  readonly config: ApiConfig;
  readonly logger: Logger;
  readonly dataSource: DataSource;
  /**
   * DB-driven RBAC registry service. Provides the in-memory policy snapshot used
   * by enforcement and is refreshed by the admin mutation surface. When omitted,
   * a self-contained instance is created (used in tests; not auto-started).
   */
  readonly rbacRegistryService?: RbacRegistryService;
  /**
   * Shared cache/rate-limit Redis. `null` (or omitted) falls back to an
   * in-memory rate-limit store that is not shared across replicas.
   */
  readonly cacheRedis?: RedisConnection | null;
  /**
   * Isolated orchestration-state DataSource (`postgres-agents`). `null` (or
   * omitted) means the agent-runs surface is not mounted.
   */
  readonly agentsDataSource?: DataSource | null;
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
    // Idempotency-Key: agent run submission. Last-Event-ID: resumable SSE stream.
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id', 'Idempotency-Key', 'Last-Event-ID'],
    maxAge: 600,
  };
}

/**
 * Compose the Express application: security headers, CORS, body limits, rate
 * limiting, request-scoped logging with correlation IDs, the centralized auth
 * pipeline, feature routers, and the single error handler.
 */
export function createApp(deps: AppDependencies): Express {
  const { config, logger, dataSource, cacheRedis = null, agentsDataSource = null } = deps;
  const rbacRegistryService =
    deps.rbacRegistryService ?? new RbacRegistryService(dataSource, logger);
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
    createRateLimiter({
      windowMs: config.rateLimit.windowMs,
      max: config.rateLimit.max,
      failOpen: config.redis.rateLimitFailOpen,
      cacheRedis,
      logger,
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
  const rbacService = new RbacService();
  const rbacAdminService = new RbacAdminService(
    dataSource,
    rbacRegistryService,
    provisioning,
    logger,
  );
  const chatService = new ChatService(conversationRepository, userRepository);

  app.use('/health', createHealthRouter({ dataSource, cacheRedis }));
  app.use('/api/v1/auth', createMeRouter({ authenticate, users: userRepository }));
  app.use('/api/v1/customers', createCustomerRouter({ authenticate, service: customerService }));
  app.use('/api/v1/products', createProductRouter({ authenticate, service: productService }));
  app.use('/api/v1/sales', createSaleRouter({ authenticate, service: saleService }));
  app.use('/api/v1/issues', createIssueRouter({ authenticate, service: issueService }));
  app.use('/api/v1/actions', createActionRouter({ authenticate, service: actionService }));
  app.use('/api/v1/sops', createSopRouter({ authenticate, service: sopService }));
  app.use(
    '/api/v1/admin',
    createAdminRouter({ authenticate, userService: adminUserService, rbacService, rbacAdminService }),
  );
  app.use('/api/v1/rbac', createRbacRegistryRouter({ authenticate, registryService: rbacRegistryService }));
  app.use('/api/v1/conversations', createConversationsRouter({ authenticate, service: chatService }));

  // Asynchronous agent orchestration (control plane). Mounted only when the
  // isolated orchestration-state DB is configured. The orchestrator task gateway
  // is optional: without it, runs are persisted as `queued` but not dispatched.
  // The chat entrypoint (`/a2a/chat`) lives here too, since it creates runs.
  if (agentsDataSource) {
    const orchestratorClient =
      config.orchestrator.baseUrl && config.keycloakAdmin
        ? new OrchestratorClient(
            { baseUrl: config.orchestrator.baseUrl },
            new ServiceTokenClient({
              tokenUrl: config.orchestrator.tokenUrl,
              clientId: config.keycloakAdmin.clientId,
              clientSecret: config.keycloakAdmin.clientSecret,
            }),
          )
        : null;
    const agentRunRepository = new AgentRunRepository(agentsDataSource);
    const agentRunService = new AgentRunService(
      agentRunRepository,
      userRepository,
      conversationRepository,
      { runTtlSeconds: config.agents.runTtlSeconds },
      logger,
      orchestratorClient,
    );
    app.use('/api/v1/a2a', createA2aChatRouter({ authenticate, service: agentRunService }));
    app.use('/api/v1/agent-runs', createAgentRunRouter({ authenticate, service: agentRunService }));
    logger.info({ orchestratorDispatch: orchestratorClient !== null }, 'agent-runs surface mounted');

    // Internal MCP tool gateway (execution plane -> control plane). The worker
    // reaches it with an audience-restricted service token; authorization is
    // re-enforced from the entitlement snapshot inside the service.
    const toolGatewayService = new ToolGatewayService(
      agentRunRepository,
      conversationRepository,
      {
        customers: customerService,
        products: productService,
        sales: saleService,
        issues: issueService,
        actions: actionService,
        sops: sopService,
      },
      logger,
    );
    const serviceAuthenticate = createServiceAuthenticate(
      new ServiceTokenVerifier({
        issuerUrl: config.auth.issuerUrl,
        jwksUri: config.auth.jwksUri,
        audience: [config.toolGateway.audience],
        authorizedParties: config.toolGateway.authorizedParties,
      }),
    );
    // Narrower verifier for the read-only entitlement snapshot endpoint (D2):
    // its own audience + azp allowlist (the DB MCP server and the agent), kept
    // distinct from the capability-execution caller set.
    const entitlementAuthenticate = createServiceAuthenticate(
      new ServiceTokenVerifier({
        issuerUrl: config.auth.issuerUrl,
        jwksUri: config.auth.jwksUri,
        audience: [config.entitlementEndpoint.audience],
        authorizedParties: config.entitlementEndpoint.authorizedParties,
      }),
    );
    app.use(
      '/internal/agent-runs',
      createToolGatewayRouter({
        serviceAuthenticate,
        entitlementAuthenticate,
        service: toolGatewayService,
      }),
    );
    logger.info('internal MCP tool gateway mounted');

    // Internal RBAC registry: the dynamic, DB-driven policy source for the
    // execution plane (orchestrator worker + A2A agents). It accepts a service
    // token from either the tool-gateway or the entitlement caller set (azp
    // pinned), so both the worker and the agents can build their Layer B view
    // and capability catalog from the same authoritative policy.
    const registryAuthenticate = createServiceAuthenticate(
      new ServiceTokenVerifier({
        issuerUrl: config.auth.issuerUrl,
        jwksUri: config.auth.jwksUri,
        audience: [config.toolGateway.audience, config.entitlementEndpoint.audience],
        authorizedParties: [
          ...config.toolGateway.authorizedParties,
          ...config.entitlementEndpoint.authorizedParties,
        ],
      }),
    );
    app.use(
      '/internal/rbac',
      createInternalRbacRegistryRouter({
        serviceAuthenticate: registryAuthenticate,
        registryService: rbacRegistryService,
      }),
    );
    logger.info('internal RBAC registry mounted');
  } else {
    logger.info('agent-runs surface not mounted (AGENTS_DATABASE_URL not configured)');
  }

  app.use(notFoundHandler());
  app.use(createErrorHandler());

  return app;
}
