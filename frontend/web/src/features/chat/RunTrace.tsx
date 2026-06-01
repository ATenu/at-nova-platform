import { useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getAgentRunTrace } from '@/api/agentRuns.api';
import { queryKeys } from '@/api/queryClient';
import type { AgentRunEventDto, AgentRunTraceDto } from '@/api/types';
import { Icon } from '@/components/ui/Icon';
import { toUserMessage } from '@/lib/errors';
import {
  buildTraceView,
  formatIo,
  summarizeEvents,
  summaryLabel,
  type InvocationStatus,
  type TraceInvocation,
  type TraceItem,
} from './traceModel';

const PRE_STYLE: React.CSSProperties = {
  margin: 0,
  padding: 8,
  borderRadius: 6,
  background: 'var(--surface-2, rgba(127,127,127,0.12))',
  overflowX: 'auto',
  fontSize: 12,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

const STATUS_LABEL: Record<InvocationStatus, string> = {
  running: 'Running',
  completed: 'Done',
  failed: 'Failed',
};

function IoBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="stack" style={{ gap: 2, marginTop: 4 }}>
      <span className="subtle text-sm">{label}</span>
      <pre style={PRE_STYLE}>{formatIo(value)}</pre>
    </div>
  );
}

function StatusBadge({ status }: { status: InvocationStatus }) {
  return (
    <span className={`run-trace-status run-trace-status-${status}`}>{STATUS_LABEL[status]}</span>
  );
}

function SubstepRow({ item }: { item: TraceItem }) {
  const [open, setOpen] = useState(false);
  const hasIo = item.input !== undefined || item.output !== undefined;
  return (
    <li className="run-trace-substep">
      <button
        type="button"
        className="run-trace-substep-toggle"
        onClick={() => hasIo && setOpen((value) => !value)}
        aria-expanded={hasIo ? open : undefined}
        disabled={!hasIo}
      >
        {hasIo ? (
          <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} />
        ) : (
          <span className="run-trace-substep-dot" aria-hidden />
        )}
        <span
          className="run-trace-substep-line text-sm"
          style={item.technical ? { opacity: 0.75, fontStyle: 'italic' } : undefined}
        >
          {item.line}
        </span>
        {item.status ? <StatusBadge status={item.status} /> : null}
      </button>
      {hasIo && open ? (
        <div className="run-trace-substep-body">
          {item.input !== undefined ? <IoBlock label="Input" value={item.input} /> : null}
          {item.output !== undefined ? <IoBlock label="Output" value={item.output} /> : null}
        </div>
      ) : null}
    </li>
  );
}

function InvocationRow({
  invocation,
  defaultOpen,
}: {
  invocation: TraceInvocation;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const hasIo =
    invocation.input !== undefined ||
    invocation.output !== undefined ||
    invocation.error !== undefined;
  const hasSubsteps = invocation.substeps.length > 0;

  return (
    <li className={`run-trace-invocation run-trace-invocation-${invocation.kind}`}>
      <button
        type="button"
        className="run-trace-invocation-toggle"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} />
        <span className={`run-trace-dot run-trace-dot-${invocation.kind}`} aria-hidden />
        <span className="run-trace-invocation-label text-sm">{invocation.label}</span>
        <StatusBadge status={invocation.status} />
        {hasSubsteps ? (
          <span className="run-trace-substep-count subtle text-sm">
            {invocation.substeps.length} sub-step{invocation.substeps.length === 1 ? '' : 's'}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="run-trace-invocation-body">
          {hasIo ? (
            <div className="stack" style={{ gap: 0 }}>
              {invocation.input !== undefined ? (
                <IoBlock label="Input" value={invocation.input} />
              ) : null}
              {invocation.output !== undefined ? (
                <IoBlock label="Output" value={invocation.output} />
              ) : null}
              {invocation.error ? (
                <IoBlock label="Error" value={invocation.error} />
              ) : null}
            </div>
          ) : (
            <span className="subtle text-sm">No input or output recorded.</span>
          )}
          {hasSubsteps ? (
            <div className="run-trace-substeps">
              <span className="subtle text-sm" style={{ display: 'block', marginBottom: 4 }}>
                Agent activity
              </span>
              <ol className="run-trace-substep-list">
                {invocation.substeps.map((item) => (
                  <SubstepRow key={item.id} item={item} />
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function LifecycleSteps({ items }: { items: readonly TraceItem[] }) {
  if (items.length === 0) {
    return null;
  }
  return (
    <ol className="run-trace-lifecycle">
      {items.map((item) => (
        <li key={item.id} className="run-trace-lifecycle-item subtle text-sm">
          {item.line}
        </li>
      ))}
    </ol>
  );
}

function DetailToggle({ detailed, onToggle }: { detailed: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="run-trace-detail-toggle subtle text-sm"
      onClick={onToggle}
      aria-pressed={detailed}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        padding: 0,
      }}
    >
      <Icon name="filter" size={12} />
      {detailed ? 'Hide technical details' : 'Show technical details'}
    </button>
  );
}

function TraceViewBody({
  events,
  live,
  detailed = false,
}: {
  events: readonly AgentRunEventDto[];
  live?: boolean;
  detailed?: boolean;
}) {
  const view = useMemo(() => buildTraceView(events, detailed), [events, detailed]);
  const hasContent = view.lifecycle.length > 0 || view.invocations.length > 0;

  if (!hasContent) {
    return live ? (
      <span className="typing" aria-label="Nova is working">
        <span /> <span /> <span />
      </span>
    ) : (
      <span className="subtle text-sm">No activity was recorded.</span>
    );
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <LifecycleSteps items={view.lifecycle.filter((item) => item.line !== 'Done.')} />
      {view.invocations.length > 0 ? (
        <ol className="run-trace-invocations">
          {view.invocations.map((invocation) => (
            <InvocationRow
              key={invocation.id}
              invocation={invocation}
              defaultOpen={
                invocation.substeps.length > 0 ||
                (live === true && invocation.status === 'running')
              }
            />
          ))}
        </ol>
      ) : null}
      <LifecycleSteps items={view.lifecycle.filter((item) => item.line === 'Done.')} />
    </div>
  );
}

function CollapsibleHeader({
  open,
  onToggle,
  label,
  summary,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  summary: ReturnType<typeof summarizeEvents>;
}) {
  return (
    <button
      type="button"
      className="run-trace-toggle"
      onClick={onToggle}
      aria-expanded={open}
    >
      <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} />
      <span className="subtle text-sm">{label}</span>
      {summary.toolCount > 0 || summary.agentCount > 0 ? (
        <span className="run-trace-summary-badge text-sm">{summaryLabel(summary)}</span>
      ) : null}
    </button>
  );
}

function RunTraceBody({
  events,
  live,
  detailed,
}: {
  events: readonly AgentRunEventDto[];
  live?: boolean;
  detailed?: boolean;
}) {
  return <TraceViewBody events={events} live={live ?? false} detailed={detailed ?? false} />;
}

export function LiveRunTrace({
  events,
  detailed = false,
  onToggleDetailed,
  children,
}: {
  events: readonly AgentRunEventDto[];
  /** Whether the live stream is currently delivering the full technical timeline. */
  detailed?: boolean;
  /** Toggle the technical detail level (re-subscribes the SSE stream). */
  onToggleDetailed?: () => void;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const summary = useMemo(() => summarizeEvents(events, detailed), [events, detailed]);
  const label = events.length > 0 ? 'Activity' : 'Working…';
  return (
    <div className="run-trace">
      <CollapsibleHeader
        open={open}
        onToggle={() => setOpen((value) => !value)}
        label={label}
        summary={summary}
      />
      {open ? (
        <div className="run-trace-body">
          {onToggleDetailed ? (
            <DetailToggle detailed={detailed} onToggle={onToggleDetailed} />
          ) : null}
          <RunTraceBody events={events} live detailed={detailed} />
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function RunTracePanel({ runId }: { runId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [detailed, setDetailed] = useState(false);
  const trace = useQuery({
    queryKey: queryKeys.runTrace(runId, detailed),
    queryFn: () => getAgentRunTrace(runId, detailed),
    enabled: open,
  });

  const events = useMemo<readonly AgentRunEventDto[]>(() => {
    if (trace.data?.events) {
      return trace.data.events;
    }
    const cached = queryClient.getQueryData<AgentRunTraceDto>(queryKeys.runTrace(runId, detailed));
    return cached?.events ?? [];
  }, [trace.data, queryClient, runId, detailed]);

  const summary = useMemo(() => summarizeEvents(events, detailed), [events, detailed]);
  const label = events.length > 0 ? 'Activity' : 'View tool & agent activity';

  return (
    <div className="run-trace">
      <CollapsibleHeader
        open={open}
        onToggle={() => setOpen((value) => !value)}
        label={label}
        summary={summary}
      />
      {open ? (
        <div className="run-trace-body">
          <DetailToggle detailed={detailed} onToggle={() => setDetailed((value) => !value)} />
          {trace.isLoading && events.length === 0 ? (
            <span className="subtle text-sm">Loading activity…</span>
          ) : trace.isError && events.length === 0 ? (
            <span className="text-sm" style={{ color: 'var(--danger)' }}>
              {toUserMessage(trace.error)}
            </span>
          ) : (
            <RunTraceBody events={events} detailed={detailed} />
          )}
        </div>
      ) : null}
    </div>
  );
}
