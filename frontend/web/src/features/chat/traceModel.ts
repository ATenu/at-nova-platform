import type { AgentRunEventDto } from '@/api/types';

export type InvocationStatus = 'running' | 'completed' | 'failed';

/**
 * A single user-visibility run event rendered as a trackable activity item.
 * `input`/`output` are the bounded, secret-redacted payloads the backend
 * attaches to tool/agent calls; they are only present when the event carries
 * them and are rendered as plain text (never HTML). `status` is set for
 * agent-internal sub-steps (queries, writes, schema loads) once their
 * start/terminal events have been merged into a single operation.
 */
export interface TraceItem {
  readonly id: string;
  readonly line: string;
  readonly kind: 'tool' | 'agent' | 'lifecycle';
  readonly status?: InvocationStatus;
  readonly input?: unknown;
  readonly output?: unknown;
}

/**
 * One tool or agent invocation with merged input/output from its start and
 * terminal events. Agent invocations may include nested sub-steps (queries,
 * writes) emitted while the agent was running.
 */
export interface TraceInvocation {
  readonly id: string;
  readonly kind: 'tool' | 'agent';
  readonly label: string;
  readonly capability: string;
  readonly agent: string;
  readonly status: InvocationStatus;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly error?: string;
  readonly substeps: readonly TraceItem[];
}

/** Ordered lifecycle lines plus grouped tool/agent invocations. */
export interface TraceView {
  readonly lifecycle: readonly TraceItem[];
  readonly invocations: readonly TraceInvocation[];
}

/** Summary counts surfaced in the trace header for an at-a-glance view. */
export interface TraceSummary {
  readonly toolCount: number;
  readonly agentCount: number;
  readonly stepCount: number;
}

const AGENT_INTERNAL_PREFIXES = ['agent.schema.', 'agent.query.', 'agent.write.'] as const;

function payloadString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === 'string' ? value : '';
}

function isAgentInternalEvent(type: string): boolean {
  return AGENT_INTERNAL_PREFIXES.some((prefix) => type.startsWith(prefix));
}

function invocationStatusFromTerminal(type: string): InvocationStatus {
  return type.endsWith('.completed') ? 'completed' : 'failed';
}

/**
 * Operation family for an agent-internal event, used to pair a `*.started`
 * event with its terminal (`*.completed` / `*.failed` / `*.rejected` /
 * `*.denied`). e.g. `agent.query.started` -> `agent.query`.
 */
function operationFamily(type: string): string {
  const lastDot = type.lastIndexOf('.');
  return lastDot > 0 ? type.slice(0, lastDot) : type;
}

/** Map an agent-internal sub-step event to a running/completed/failed status. */
function substepStatus(type: string): InvocationStatus {
  if (type.endsWith('.started')) {
    return 'running';
  }
  if (type.endsWith('.completed') || type.endsWith('.loaded')) {
    return 'completed';
  }
  return 'failed';
}

function toolLabel(capability: string, status: InvocationStatus): string {
  if (capability) {
    return capability;
  }
  if (status === 'running') {
    return 'Tool';
  }
  return 'Tool step';
}

function agentLabel(agent: string, status: InvocationStatus): string {
  if (agent) {
    return agent;
  }
  if (status === 'running') {
    return 'Agent';
  }
  return 'Agent step';
}

/**
 * Build the optional `error` slice for a TraceInvocation. Returns an explicitly
 * typed `{ error?: string }` so that, under `exactOptionalPropertyTypes`, the
 * field is omitted (never set to `undefined`) when there is no error.
 */
function errorPatch(value: string | undefined): { error?: string } {
  return value === undefined ? {} : { error: value };
}

/** Map a `user`-visibility run event to a renderable item (or skip it). */
export function describeEvent(event: AgentRunEventDto): Omit<TraceItem, 'id'> | null {
  const payload = event.payload;
  const capability = payloadString(payload, 'capability');
  const agent = payloadString(payload, 'agent');
  const summary = payloadString(payload, 'summary');
  const rowCount = typeof payload.rowCount === 'number' ? payload.rowCount : null;
  switch (event.type) {
    case 'run.accepted':
    case 'run.started':
      return { line: 'Starting…', kind: 'lifecycle' };
    case 'planner.started':
      return { line: 'Planning your request…', kind: 'lifecycle' };
    case 'tool.call.started':
      return {
        line: capability ? `Running ${capability}…` : 'Running a step…',
        kind: 'tool',
        input: payload.input,
      };
    case 'tool.call.completed':
      return {
        line: summary || `Finished ${capability}.`,
        kind: 'tool',
        input: payload.input,
        output: payload.output,
      };
    case 'tool.call.failed':
      return {
        line: `A step did not complete${capability ? ` (${capability})` : ''}.`,
        kind: 'tool',
        input: payload.input,
      };
    case 'agent.call.started':
      return {
        line: agent ? `Asking ${agent}…` : 'Consulting an agent…',
        kind: 'agent',
        input: payload.input,
      };
    case 'agent.call.completed':
      return { line: `${agent || 'Agent'} finished.`, kind: 'agent', output: payload.output };
    case 'agent.call.failed':
      return {
        line: `${agent || 'Agent'} did not complete${capability ? ` (${capability})` : ''}.`,
        kind: 'agent',
      };
    case 'agent.schema.loaded':
      return { line: 'Inspecting available data…', kind: 'agent' };
    case 'agent.query.started':
      return { line: 'Querying data…', kind: 'agent' };
    case 'agent.query.completed':
      return {
        line: rowCount !== null ? `Read ${rowCount} row(s).` : 'Query complete.',
        kind: 'agent',
        output: payload.output,
      };
    case 'agent.query.rejected':
      return { line: 'A query was rejected before running.', kind: 'agent' };
    case 'agent.write.started':
      return {
        line: capability ? `Applying ${capability}…` : 'Applying a change…',
        kind: 'tool',
        input: payload.input,
      };
    case 'agent.write.completed':
      return {
        line: summary || (capability ? `Applied ${capability}.` : 'Change applied.'),
        kind: 'tool',
        input: payload.input,
        output: payload.output,
      };
    case 'agent.write.failed':
    case 'agent.write.denied':
      return {
        line: `A change did not complete${capability ? ` (${capability})` : ''}.`,
        kind: 'tool',
        input: payload.input,
      };
    case 'run.failed':
      return { line: 'The run failed.', kind: 'lifecycle' };
    case 'run.canceled':
      return { line: 'Run canceled.', kind: 'lifecycle' };
    case 'run.completed':
      return { line: 'Done.', kind: 'lifecycle' };
    default:
      return null;
  }
}

/** Build the ordered, renderable item list from a run's events. */
export function toTraceItems(events: readonly AgentRunEventDto[]): readonly TraceItem[] {
  const items: TraceItem[] = [];
  for (const event of events) {
    const described = describeEvent(event);
    if (described) {
      items.push({ id: event.id, ...described });
    }
  }
  return items;
}

/**
 * Group raw SSE/webhook events into lifecycle lines and merged tool/agent
 * invocations so each call appears once with its input, output, and status.
 */
export function buildTraceView(events: readonly AgentRunEventDto[]): TraceView {
  const lifecycle: TraceItem[] = [];
  const invocations: TraceInvocation[] = [];
  let openTool: TraceInvocation | null = null;
  let openAgent: TraceInvocation | null = null;
  // Sub-steps for the currently open agent. `openSubsteps` is the live array
  // referenced by `openAgent.substeps`; `runningOps` maps an operation family
  // to its index so a terminal event merges into its `*.started` sub-step.
  let openSubsteps: TraceItem[] = [];
  let runningOps = new Map<string, number>();

  const pushLifecycle = (event: AgentRunEventDto): void => {
    const described = describeEvent(event);
    if (described) {
      lifecycle.push({ id: event.id, ...described });
    }
  };

  const addAgentSubstep = (event: AgentRunEventDto): void => {
    const described = describeEvent(event);
    if (!described) {
      return;
    }
    const status = substepStatus(event.type);
    const family = operationFamily(event.type);
    const runningIndex = runningOps.get(family);
    if (status === 'running') {
      runningOps.set(family, openSubsteps.length);
      openSubsteps.push({ id: event.id, ...described, status });
      return;
    }
    if (runningIndex !== undefined) {
      const prev = openSubsteps[runningIndex]!;
      openSubsteps[runningIndex] = {
        ...prev,
        line: described.line,
        status,
        input: prev.input ?? described.input,
        output: described.output ?? prev.output,
      };
      runningOps.delete(family);
      return;
    }
    openSubsteps.push({ id: event.id, ...described, status });
  };

  for (const event of events) {
    const payload = event.payload;
    const capability = payloadString(payload, 'capability');
    const agent = payloadString(payload, 'agent');

    switch (event.type) {
      case 'tool.call.started': {
        openTool = {
          id: event.id,
          kind: 'tool',
          label: toolLabel(capability, 'running'),
          capability,
          agent: '',
          status: 'running',
          input: payload.input,
          substeps: [],
        };
        invocations.push(openTool);
        break;
      }
      case 'tool.call.completed':
      case 'tool.call.failed': {
        const status = invocationStatusFromTerminal(event.type);
        const errorText = typeof payload.error === 'string' ? payload.error : undefined;
        if (openTool) {
          openTool = {
            ...openTool,
            status,
            label: toolLabel(openTool.capability || capability, status),
            input: openTool.input ?? payload.input,
            output: payload.output,
            ...errorPatch(errorText),
          };
          invocations[invocations.length - 1] = openTool;
        } else {
          invocations.push({
            id: event.id,
            kind: 'tool',
            label: toolLabel(capability, status),
            capability,
            agent: '',
            status,
            input: payload.input,
            output: payload.output,
            substeps: [],
            ...errorPatch(errorText),
          });
        }
        openTool = null;
        break;
      }
      case 'agent.call.started': {
        openSubsteps = [];
        runningOps = new Map<string, number>();
        openAgent = {
          id: event.id,
          kind: 'agent',
          label: agentLabel(agent, 'running'),
          capability,
          agent,
          status: 'running',
          input: payload.input,
          substeps: openSubsteps,
        };
        invocations.push(openAgent);
        break;
      }
      case 'agent.call.completed':
      case 'agent.call.failed': {
        const status = invocationStatusFromTerminal(event.type);
        if (openAgent) {
          const errorText =
            typeof payload.reason === 'string'
              ? payload.reason
              : typeof payload.error === 'string'
                ? payload.error
                : openAgent.error;
          openAgent = {
            ...openAgent,
            status,
            label: agentLabel(openAgent.agent || agent, status),
            input: openAgent.input ?? payload.input,
            output: payload.output ?? openAgent.output,
            ...errorPatch(errorText),
          };
          invocations[invocations.length - 1] = openAgent;
        } else {
          const errorText = typeof payload.reason === 'string' ? payload.reason : undefined;
          invocations.push({
            id: event.id,
            kind: 'agent',
            label: agentLabel(agent, status),
            capability,
            agent,
            status,
            output: payload.output,
            substeps: [],
            ...errorPatch(errorText),
          });
        }
        openAgent = null;
        break;
      }
      default: {
        if (openAgent && isAgentInternalEvent(event.type)) {
          addAgentSubstep(event);
        } else {
          pushLifecycle(event);
        }
      }
    }
  }

  return { lifecycle, invocations };
}

/**
 * Count tool and agent activity for the header badge. A "tool" is any direct
 * gateway tool call (`tool.call.*`) plus every agent-internal operation
 * (each merged MCP query, schema load, or capability write sub-step) — these
 * are the real tool invocations the agent performed on the user's behalf.
 * Agents are counted once per `agent.call.*` invocation.
 */
export function summarizeEvents(events: readonly AgentRunEventDto[]): TraceSummary {
  const view = buildTraceView(events);
  let toolCount = 0;
  let agentCount = 0;
  let substepCount = 0;
  for (const inv of view.invocations) {
    if (inv.kind === 'tool') {
      toolCount += 1;
    } else {
      agentCount += 1;
    }
    substepCount += inv.substeps.length;
  }
  return {
    toolCount: toolCount + substepCount,
    agentCount,
    stepCount: view.lifecycle.length + view.invocations.length + substepCount,
  };
}

/** Stable, human-readable summary label (e.g. "2 tools · 1 agent"). */
export function summaryLabel(summary: TraceSummary): string {
  const parts: string[] = [];
  parts.push(`${summary.toolCount} ${summary.toolCount === 1 ? 'tool' : 'tools'}`);
  parts.push(`${summary.agentCount} ${summary.agentCount === 1 ? 'agent' : 'agents'}`);
  return parts.join(' · ');
}

/** Pretty-print a redacted IO payload for display (plain text, never HTML). */
export function formatIo(value: unknown): string {
  if (value === undefined) {
    return '—';
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    // Non-serializable payloads (e.g. circular references) are never expected
    // from the redacted backend IO, but fail safe rather than throw in render.
    return typeof value === 'string' ? value : '[unserializable value]';
  }
}
