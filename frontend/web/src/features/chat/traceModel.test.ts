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

  it('nests agent-internal events under the open agent invocation', () => {
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
    expect(view.invocations[0]!.substeps).toHaveLength(3);
    expect(view.invocations[0]).toMatchObject({
      kind: 'agent',
      label: 'sql-analyst',
      status: 'completed',
      input: { goal: 'count sales' },
      output: { answer: 'Five sales.' },
    });
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
