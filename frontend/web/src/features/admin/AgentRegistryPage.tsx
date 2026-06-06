import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listAgents, onboardAgent, removeAgent, setAgentEnabled } from '@/api/agents.api';
import { queryKeys } from '@/api/queryClient';
import type { AgentRegistrationDto, AgentStatus } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { PageHeader } from '@/components/layout/PageHeader';
import { PermissionGate } from '@/components/layout/PermissionGate';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { DataTable, type Column } from '@/components/ui/Table';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { toUserMessage } from '@/lib/errors';
import { OnboardAgentModal } from './OnboardAgentModal';

const STATUS_TONE: Record<AgentStatus, BadgeTone> = {
  onboarded: 'success',
  unreachable: 'danger',
  disabled: 'neutral',
  failed: 'danger',
};

const STATUS_LABEL: Record<AgentStatus, string> = {
  onboarded: 'Onboarded',
  unreachable: 'Unreachable',
  disabled: 'Disabled',
  failed: 'Failed',
};

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

export function AgentRegistryPage() {
  const { can } = useAuth();
  const canWrite = can('write-agents');
  const toast = useToast();
  const queryClient = useQueryClient();

  const [onboardOpen, setOnboardOpen] = useState(false);
  const [detail, setDetail] = useState<AgentRegistrationDto | null>(null);

  const query = useQuery({
    queryKey: queryKeys.agents,
    queryFn: () => listAgents(),
  });

  const agents = useMemo(() => query.data ?? [], [query.data]);
  const summary = useMemo(
    () => ({
      total: agents.length,
      admin: agents.filter((a) => a.source === 'admin').length,
      unreachable: agents.filter((a) => a.status === 'unreachable').length,
    }),
    [agents],
  );

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.agents });

  const toggleEnabled = useMutation({
    mutationFn: (agent: AgentRegistrationDto) => setAgentEnabled(agent.name, !agent.enabled),
    onSuccess: (agent) => {
      toast.success(`${agent.enabled ? 'Enabled' : 'Disabled'} ${agent.name}`);
      void invalidate();
    },
    onError: (error) => toast.error(toUserMessage(error)),
  });

  const revalidate = useMutation({
    mutationFn: (agent: AgentRegistrationDto) =>
      onboardAgent({ hostUrl: agent.baseUrl, audience: agent.audience, name: agent.name }),
    onSuccess: (agent) => {
      toast.success(`Re-validated ${agent.name}`);
      void invalidate();
    },
    onError: (error) => toast.error(toUserMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (name: string) => removeAgent(name),
    onSuccess: () => {
      toast.success('Agent removed');
      void invalidate();
    },
    onError: (error) => toast.error(toUserMessage(error)),
  });

  const columns: ReadonlyArray<Column<AgentRegistrationDto>> = [
    {
      key: 'agent',
      header: 'Agent',
      render: (agent) => (
        <div className="stack" style={{ gap: 2 }}>
          <span style={{ fontWeight: 600 }}>{agent.displayName ?? agent.name}</span>
          <span className="subtle text-sm">{agent.name}</span>
        </div>
      ),
    },
    {
      key: 'source',
      header: 'Source',
      render: (agent) => (
        <Badge tone={agent.source === 'admin' ? 'brand' : 'info'}>
          {agent.source === 'admin' ? 'Admin' : 'Self'}
        </Badge>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (agent) => (
        <Badge tone={agent.enabled ? STATUS_TONE[agent.status] : 'neutral'} dot>
          {agent.enabled ? STATUS_LABEL[agent.status] : 'Disabled'}
        </Badge>
      ),
    },
    {
      key: 'skills',
      header: 'Skills',
      render: (agent) => (
        <div className="row wrap" style={{ gap: 4 }}>
          {agent.skills.length === 0 ? (
            <span className="subtle text-sm">—</span>
          ) : (
            agent.skills.map((skill) => (
              <Badge key={skill.id} tone="neutral">
                {skill.id}
              </Badge>
            ))
          )}
        </div>
      ),
    },
    {
      key: 'lastSeen',
      header: 'Last seen',
      render: (agent) => <span className="text-sm">{formatTimestamp(agent.lastSeenAt)}</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (agent) =>
        canWrite && agent.source === 'admin' ? (
          <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }} onClick={(e) => e.stopPropagation()}>
            <Button
              size="sm"
              variant="ghost"
              loading={revalidate.isPending && revalidate.variables?.name === agent.name}
              onClick={() => revalidate.mutate(agent)}
            >
              <Icon name="refresh" size={14} /> Re-validate
            </Button>
            <Button
              size="sm"
              loading={toggleEnabled.isPending && toggleEnabled.variables?.name === agent.name}
              onClick={() => toggleEnabled.mutate(agent)}
            >
              {agent.enabled ? 'Disable' : 'Enable'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              loading={remove.isPending && remove.variables === agent.name}
              onClick={() => {
                if (window.confirm(`Remove agent "${agent.name}" from the registry?`)) {
                  remove.mutate(agent.name);
                }
              }}
              aria-label={`Remove agent ${agent.name}`}
            >
              <Icon name="close" size={14} />
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="Agent Registry"
        description="Every A2A agent the orchestrator can route to. Onboard new agents by host URL — the platform fetches the Agent Card over native A2A."
        actions={
          <PermissionGate anyOf={['write-agents']}>
            <Button variant="primary" onClick={() => setOnboardOpen(true)}>
              <Icon name="plus" size={16} /> Onboard agent
            </Button>
          </PermissionGate>
        }
      />

      <div className="row wrap" style={{ gap: 12, marginBottom: 16 }}>
        <Badge tone="neutral" dot>
          {summary.total} agents
        </Badge>
        <Badge tone="brand">{summary.admin} admin-onboarded</Badge>
        {summary.unreachable > 0 && <Badge tone="danger">{summary.unreachable} unreachable</Badge>}
      </div>

      <Card>
        {query.isLoading ? (
          <TableSkeleton columns={6} />
        ) : query.isError ? (
          <ErrorState description={toUserMessage(query.error)} onRetry={() => query.refetch()} />
        ) : agents.length === 0 ? (
          <EmptyState
            icon="sparkles"
            title="No agents registered"
            description="Agents appear here when they self-register, or after you onboard one by host URL."
          />
        ) : (
          <DataTable columns={columns} rows={agents} rowKey={(agent) => agent.name} onRowClick={setDetail} />
        )}
      </Card>

      <OnboardAgentModal open={onboardOpen} onClose={() => setOnboardOpen(false)} />
      <AgentDetailModal agent={detail} onClose={() => setDetail(null)} />
    </>
  );
}

function AgentDetailModal({
  agent,
  onClose,
}: {
  agent: AgentRegistrationDto | null;
  onClose: () => void;
}) {
  if (!agent) {
    return null;
  }
  return (
    <Modal open={Boolean(agent)} onClose={onClose} title={agent.displayName ?? agent.name} size="lg">
      <div className="stack" style={{ gap: 14 }}>
        <div className="row wrap" style={{ gap: 8 }}>
          <Badge tone={agent.source === 'admin' ? 'brand' : 'info'}>{agent.source}</Badge>
          <Badge tone={agent.enabled ? STATUS_TONE[agent.status] : 'neutral'} dot>
            {agent.enabled ? STATUS_LABEL[agent.status] : 'Disabled'}
          </Badge>
          {agent.version && <Badge tone="neutral">v{agent.version}</Badge>}
        </div>
        {agent.description && <p className="text-sm" style={{ margin: 0 }}>{agent.description}</p>}
        <dl className="stack" style={{ gap: 6, margin: 0 }}>
          <DetailRow label="Base URL" value={agent.baseUrl} />
          <DetailRow label="Audience" value={agent.audience} />
          <DetailRow label="Onboarded by" value={agent.onboardedBy ?? '—'} />
          <DetailRow label="Last seen" value={formatTimestamp(agent.lastSeenAt)} />
          {agent.lastError && <DetailRow label="Last error" value={agent.lastError} />}
        </dl>
        <div className="stack" style={{ gap: 8 }}>
          <span className="section-title">Skills</span>
          {agent.skills.length === 0 ? (
            <span className="subtle text-sm">This card advertises no skills.</span>
          ) : (
            agent.skills.map((skill) => (
              <div key={skill.id} className="stack" style={{ gap: 2 }}>
                <span style={{ fontWeight: 600 }}>
                  {skill.name} <span className="subtle text-sm">({skill.id})</span>
                </span>
                {skill.description && <span className="text-sm muted">{skill.description}</span>}
              </div>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="row-between" style={{ gap: 16 }}>
      <dt className="subtle text-sm">{label}</dt>
      <dd className="text-sm" style={{ margin: 0, wordBreak: 'break-all', textAlign: 'right' }}>
        {value}
      </dd>
    </div>
  );
}
