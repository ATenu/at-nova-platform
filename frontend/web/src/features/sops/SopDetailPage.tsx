import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getSop } from '@/api/sops.api';
import { queryKeys } from '@/api/queryClient';
import { useAuth } from '@/auth/AuthProvider';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Badge } from '@/components/ui/Badge';
import { ActiveBadge } from '@/components/ui/StatusBadge';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { formatDate } from '@/lib/dates';
import { toUserMessage } from '@/lib/errors';

export function SopDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();

  const query = useQuery({ queryKey: queryKeys.sop(id), queryFn: () => getSop(id), enabled: Boolean(id) });
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);

  if (query.isLoading) return <LoadingState label="Loading SOP…" />;
  if (query.isError || !query.data) {
    return <ErrorState description={toUserMessage(query.error)} onRetry={() => query.refetch()} />;
  }

  const sop = query.data;
  const details = [...(sop.details ?? [])].sort((a, b) => b.version - a.version);
  const active = details.find((detail) => detail.version === selectedVersion) ?? details[0];

  return (
    <>
      <PageHeader
        title={sop.name}
        description={sop.description}
        actions={
          <>
            <Button variant="ghost" onClick={() => navigate('/app/sops')}>
              <Icon name="arrowLeft" size={16} /> Back
            </Button>
            {can('write-sop') ? (
              <Link to={`/app/sops/${sop.id}/edit`} className="btn btn-primary">
                <Icon name="edit" size={16} /> New version
              </Link>
            ) : null}
          </>
        }
      />

      <div className="detail-grid">
        <Card>
          <CardHeader
            title={active ? `Version ${active.version}` : 'Content'}
            actions={<ActiveBadge active={sop.active} />}
          />
          <CardBody>
            {active ? (
              <>
                <div className="text-sm subtle" style={{ marginBottom: 12 }}>
                  Created {formatDate(active.dateOfCreation)}
                  {active.createdBy ? ` by ${active.createdBy.firstName} ${active.createdBy.lastName}` : ''}
                </div>
                <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.65, margin: 0 }}>{active.fullText}</p>
              </>
            ) : (
              <p className="muted">No version content available.</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Version history" />
          <CardBody>
            <div className="timeline">
              {details.map((detail, index) => (
                <div
                  key={detail.version}
                  className={`timeline-item ${index === 0 ? 'active' : 'done'}`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setSelectedVersion(detail.version)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') setSelectedVersion(detail.version);
                  }}
                >
                  <div className="row" style={{ gap: 8 }}>
                    <Badge tone={active?.version === detail.version ? 'brand' : 'neutral'}>
                      v{detail.version}
                    </Badge>
                    {index === 0 ? <span className="text-sm" style={{ fontWeight: 600 }}>Latest</span> : null}
                  </div>
                  <div className="text-sm subtle" style={{ marginTop: 2 }}>
                    {formatDate(detail.dateOfCreation)}
                    {detail.createdBy ? ` · ${detail.createdBy.firstName} ${detail.createdBy.lastName}` : ''}
                  </div>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
