import { describe, expect, it } from 'vitest';
import type { AgentRunEventDto } from '@/api/types';
import { buildTraceView, summarizeEvents, summaryLabel, toTraceItems } from './traceModel';

function event(partial: Partial<AgentRunEventDto> & { type: string; sequence: number }): AgentRunEventDto {
  return {
    id: `evt-${partial.sequence}`,
    payload: {},
    createdAt: '2026-05-31T00:00:00.000Z',
    ...partial,
  };
}

describe('traceModel.buildTraceView', () => {
  it('merges tool start and terminal events into one invocation with input and output', () => {
    const events: AgentRunEventDto[] = [
      event({ type: 'tool.call.started', sequence: 1, payload: { capability: 'sales.read', input: { id: 7 } } }),
      event({
        type: 'tool.call.completed',
        sequence: 2,
        payload: { capability: 'sales.read', input: { id: 7 }, output: { rows: 3 } },
      }),
    ];

    const view = buildTraceView(events);
    expect(view.invocations).toHaveLength(1);
    expect(view.invocations[0]).toMatchObject({
      kind: 'tool',
      label: 'sales.read',
      status: 'completed',
      input: { id: 7 },
      output: { rows: 3 },
    });
  });

  it('merges agent-internal start/terminal events into one sub-step per operation', () => {
    const events: AgentRunEventDto[] = [
      event({
        type: 'agent.call.started',
        sequence: 1,
        payload: { agent: 'sql-analyst', capability: 'sql.read', input: { goal: 'count sales' } },
      }),
      event({ type: 'agent.schema.loaded', sequence: 2, payload: { viewCount: 4 } }),
      event({ type: 'agent.query.started', sequence: 3, payload: { sqlHash: 'abc' } }),
      event({ type: 'agent.query.completed', sequence: 4, payload: { rowCount: 5, output: { rows: 5 } } }),
      event({
        type: 'agent.call.completed',
        sequence: 5,
        payload: { agent: 'sql-analyst', output: { answer: 'Five sales.' } },
      }),
    ];

    const view = buildTraceView(events);
    expect(view.invocations).toHaveLength(1);
    const invocation = view.invocations[0]!;
    expect(invocation).toMatchObject({
      kind: 'agent',
      label: 'sql-analyst',
      status: 'completed',
      input: { goal: 'count sales' },
      output: { answer: 'Five sales.' },
    });
    // schema load (singleton) + one merged query operation.
    expect(invocation.substeps).toHaveLength(2);
    expect(invocation.substeps[0]).toMatchObject({ status: 'completed', line: 'Inspecting available data…' });
    expect(invocation.substeps[1]).toMatchObject({
      status: 'completed',
      line: 'Read 5 row(s).',
      output: { rows: 5 },
    });
  });

  it('surfaces the tool name, SQL input, and row output on a merged query sub-step', () => {
    const events: AgentRunEventDto[] = [
      event({ type: 'agent.call.started', sequence: 1, payload: { agent: 'sql-analyst' } }),
      event({
        type: 'agent.query.started',
        sequence: 2,
        payload: {
          tool: 'run_select_query',
          sqlHash: 'abc',
          input: { sql: 'SELECT full_name FROM mcp_read.customers', params: [] },
        },
      }),
      event({
        type: 'agent.query.completed',
        sequence: 3,
        payload: {
          tool: 'run_select_query',
          rowCount: 1,
          output: { rows: [{ full_name: 'Jane Doe' }], rowCount: 1 },
        },
      }),
    ];

    const view = buildTraceView(events);
    const substep = view.invocations[0]!.substeps[0]!;
    expect(substep).toMatchObject({
      status: 'completed',
      line: 'run_select_query: read 1 row(s).',
      input: { sql: 'SELECT full_name FROM mcp_read.customers', params: [] },
      output: { rows: [{ full_name: 'Jane Doe' }], rowCount: 1 },
    });
  });

  it('keeps the capability id on a merged structured-read sub-step', () => {
    const events: AgentRunEventDto[] = [
      event({ type: 'agent.call.started', sequence: 1, payload: { agent: 'at-sql-analyser' } }),
      event({
        type: 'agent.read.started',
        sequence: 2,
        payload: {
          capability: 'customers.search',
          tool: 'customers.search',
          input: {},
        },
      }),
      event({
        type: 'agent.read.completed',
        sequence: 3,
        payload: {
          capability: 'customers.search',
          tool: 'customers.search',
          rowCount: 12,
          output: { rows: [], rowCount: 12 },
        },
      }),
      event({ type: 'agent.call.completed', sequence: 4, payload: { agent: 'at-sql-analyser' } }),
    ];

    const view = buildTraceView(events);
    expect(view.invocations[0]!.substeps).toHaveLength(1);
    expect(view.invocations[0]!.substeps[0]).toMatchObject({
      status: 'completed',
      line: 'customers.search: found 12 record(s).',
    });
  });

  it('merges agent.mcp start/terminal events like agent.query', () => {
    const events: AgentRunEventDto[] = [
      event({ type: 'agent.call.started', sequence: 1, payload: { agent: 'at-sql-analyser' } }),
      event({
        type: 'agent.mcp.started',
        sequence: 2,
        payload: {
          tool: 'run_select_query',
          input: { sql: 'SELECT id FROM mcp_read.customers LIMIT 50', params: [] },
        },
      }),
      event({
        type: 'agent.mcp.completed',
        sequence: 3,
        payload: {
          tool: 'run_select_query',
          rowCount: 3,
          output: { rows: [{ id: '1' }, { id: '2' }, { id: '3' }], rowCount: 3 },
        },
      }),
    ];

    const view = buildTraceView(events);
    expect(view.invocations[0]!.substeps[0]).toMatchObject({
      status: 'completed',
      line: 'run_select_query: read 3 row(s).',
    });
  });

  it('labels a running query sub-step with the tool name when present', () => {
    const events: AgentRunEventDto[] = [
      event({ type: 'agent.call.started', sequence: 1, payload: { agent: 'sql-analyst' } }),
      event({
        type: 'agent.query.started',
        sequence: 2,
        payload: { tool: 'run_select_query', sqlHash: 'abc', input: { sql: 'SELECT 1', params: [] } },
      }),
    ];

    const view = buildTraceView(events);
    expect(view.invocations[0]!.substeps[0]).toMatchObject({
      status: 'running',
      line: 'Running run_select_query…',
      input: { sql: 'SELECT 1', params: [] },
    });
  });

  it('keeps a still-running agent operation as a running sub-step', () => {
    const events: AgentRunEventDto[] = [
      event({ type: 'agent.call.started', sequence: 1, payload: { agent: 'sql-analyst' } }),
      event({ type: 'agent.query.started', sequence: 2, payload: { sqlHash: 'abc' } }),
    ];

    const view = buildTraceView(events);
    expect(view.invocations[0]!.substeps).toHaveLength(1);
    expect(view.invocations[0]!.substeps[0]).toMatchObject({
      status: 'running',
      line: 'Querying data…',
    });
  });

  it('records a failed agent operation when its terminal is a rejection', () => {
    const events: AgentRunEventDto[] = [
      event({ type: 'agent.call.started', sequence: 1, payload: { agent: 'sql-analyst' } }),
      event({ type: 'agent.query.started', sequence: 2, payload: { sqlHash: 'abc' } }),
      event({ type: 'agent.query.rejected', sequence: 3, payload: { reason: 'unsafe' } }),
    ];

    const view = buildTraceView(events);
    expect(view.invocations[0]!.substeps).toHaveLength(1);
    expect(view.invocations[0]!.substeps[0]!.status).toBe('failed');
  });

  it('treats an errored agent.query.completed as failed, not a 0-row read', () => {
    const events: AgentRunEventDto[] = [
      event({ type: 'agent.call.started', sequence: 1, payload: { agent: 'sql-analyst' } }),
      event({ type: 'agent.query.started', sequence: 2, payload: { sqlHash: 'abc' } }),
      event({
        type: 'agent.query.completed',
        sequence: 3,
        payload: {
          sqlHash: 'abc',
          rowCount: 0,
          truncated: false,
          error: true,
          reason: 'sql_rejected: Relation "mcp_read.orders" is not in the mcp_read allowlist.',
        },
      }),
    ];

    const view = buildTraceView(events);
    const substep = view.invocations[0]!.substeps[0]!;
    expect(substep.status).toBe('failed');
    expect(substep.line).toContain('Query failed');
    expect(substep.line).toContain('mcp_read.orders');
  });

  it('hides technical (node/authz) sub-steps in the default view, shows them when detailed', () => {
    const events: AgentRunEventDto[] = [
      event({ type: 'agent.call.started', sequence: 1, payload: { agent: 'sql-analyst' } }),
      event({ type: 'agent.node.started', sequence: 2, payload: { node: 'plan_read', iteration: 0 } }),
      event({
        type: 'agent.node.completed',
        sequence: 3,
        payload: { node: 'plan_read', ms: 12, outcome: 'ok' },
      }),
      event({
        type: 'agent.authz.allowed',
        sequence: 4,
        payload: { capability: 'data.analyse.read', decision: 'allow', reasonCode: 'allowed' },
      }),
      event({ type: 'agent.query.started', sequence: 5, payload: { sqlHash: 'abc' } }),
      event({ type: 'agent.query.completed', sequence: 6, payload: { rowCount: 1 } }),
      event({ type: 'agent.call.completed', sequence: 7, payload: { agent: 'sql-analyst' } }),
    ];

    // Default: only the user-facing query sub-step is shown.
    const plain = buildTraceView(events);
    expect(plain.invocations[0]!.substeps).toHaveLength(1);
    expect(plain.invocations[0]!.substeps[0]!.line).toBe('Read 1 row(s).'); // no tool in payload

    // Detailed: node execution + authz decision are surfaced too, marked technical.
    const full = buildTraceView(events, true);
    const substeps = full.invocations[0]!.substeps;
    expect(substeps.length).toBeGreaterThan(1);
    const nodeStep = substeps.find((step) => step.line.includes('plan_read'));
    expect(nodeStep?.technical).toBe(true);
    const authzStep = substeps.find((step) => step.line.startsWith('Authorized'));
    expect(authzStep?.technical).toBe(true);
  });
});

describe('traceModel.summarizeEvents', () => {
  it('counts each tool and agent invocation exactly once', () => {
    const events: AgentRunEventDto[] = [
      event({ type: 'planner.started', sequence: 1 }),
      event({ type: 'tool.call.started', sequence: 2, payload: { capability: 'sales.read' } }),
      event({ type: 'tool.call.completed', sequence: 3, payload: { capability: 'sales.read' } }),
      event({ type: 'tool.call.started', sequence: 4, payload: { capability: 'issues.read' } }),
      event({ type: 'tool.call.failed', sequence: 5, payload: { capability: 'issues.read' } }),
      event({ type: 'agent.call.started', sequence: 6, payload: { agent: 'sql-analyst' } }),
      event({ type: 'agent.call.completed', sequence: 7, payload: { agent: 'sql-analyst' } }),
      event({ type: 'run.completed', sequence: 8 }),
    ];

    const summary = summarizeEvents(events);
    expect(summary.toolCount).toBe(2);
    expect(summary.agentCount).toBe(1);
    expect(summaryLabel(summary)).toBe('2 tools · 1 agent');
  });

  it('counts each agent-internal operation (MCP query, schema load, write) as a tool', () => {
    const events: AgentRunEventDto[] = [
      event({ type: 'planner.started', sequence: 1 }),
      event({ type: 'agent.call.started', sequence: 2, payload: { agent: 'sql-analyst' } }),
      event({ type: 'agent.schema.loaded', sequence: 3, payload: { viewCount: 10 } }),
      event({ type: 'agent.query.started', sequence: 4, payload: { sqlHash: 'abc' } }),
      event({ type: 'agent.query.completed', sequence: 5, payload: { rowCount: 1 } }),
      event({ type: 'agent.call.completed', sequence: 6, payload: { agent: 'sql-analyst' } }),
      event({ type: 'run.completed', sequence: 7 }),
    ];

    const summary = summarizeEvents(events);
    // schema load + one query operation = 2 tools, under a single agent.
    expect(summary.toolCount).toBe(2);
    expect(summary.agentCount).toBe(1);
    expect(summaryLabel(summary)).toBe('2 tools · 1 agent');
  });

  it('does not count technical (node/authz) sub-steps as tools in the detailed view', () => {
    const events: AgentRunEventDto[] = [
      event({ type: 'agent.call.started', sequence: 1, payload: { agent: 'sql-analyst' } }),
      event({ type: 'agent.node.started', sequence: 2, payload: { node: 'plan_read' } }),
      event({ type: 'agent.node.completed', sequence: 3, payload: { node: 'plan_read', ms: 5 } }),
      event({
        type: 'agent.authz.allowed',
        sequence: 4,
        payload: { capability: 'data.analyse.read', reasonCode: 'allowed' },
      }),
      event({ type: 'agent.query.started', sequence: 5, payload: { sqlHash: 'abc' } }),
      event({ type: 'agent.query.completed', sequence: 6, payload: { rowCount: 1 } }),
      event({ type: 'agent.call.completed', sequence: 7, payload: { agent: 'sql-analyst' } }),
    ];

    const summary = summarizeEvents(events, true);
    // Only the real MCP query counts as a tool; node + authz steps do not.
    expect(summary.toolCount).toBe(1);
    expect(summary.agentCount).toBe(1);
  });

  it('counts a terminal-only trace (e.g. SSE resumed past the started frame)', () => {
    const events: AgentRunEventDto[] = [
      event({ type: 'tool.call.completed', sequence: 10, payload: { capability: 'sales.read' } }),
      event({ type: 'agent.call.completed', sequence: 11, payload: { agent: 'sql-analyst' } }),
    ];
    const summary = summarizeEvents(events);
    expect(summary.toolCount).toBe(1);
    expect(summary.agentCount).toBe(1);
  });

  it('uses singular labels for a single tool/agent and zero for none', () => {
    expect(summaryLabel(summarizeEvents([]))).toBe('0 tools · 0 agents');
    expect(
      summaryLabel(
        summarizeEvents([
          event({ type: 'tool.call.started', sequence: 1, payload: { capability: 'x' } }),
          event({ type: 'tool.call.completed', sequence: 2, payload: { capability: 'x' } }),
          event({ type: 'agent.call.started', sequence: 3, payload: { agent: 'a' } }),
          event({ type: 'agent.call.completed', sequence: 4, payload: { agent: 'a' } }),
        ]),
      ),
    ).toBe('1 tool · 1 agent');
  });

  it('exposes tool/agent inputs and outputs as renderable items', () => {
    const items = toTraceItems([
      event({
        type: 'tool.call.completed',
        sequence: 1,
        payload: { capability: 'sales.read', input: { id: 7 }, output: { rows: 3 } },
      }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe('tool');
    expect(items[0]!.input).toEqual({ id: 7 });
    expect(items[0]!.output).toEqual({ rows: 3 });
  });
});
