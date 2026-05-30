import { Link } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { resolveNovaLink } from '@/lib/novaLinks';

/**
 * Renders an agent-provided MCP / deep link. Supported `nova://` links resolve
 * to in-app routes; anything else is shown as inert text (never auto-followed),
 * keeping navigation predictable and safe.
 */
export function McpAppLinkCard({ link, active }: { link: string; active?: boolean | null | undefined }) {
  const resolved = resolveNovaLink(link);

  return (
    <div className="mcp-card">
      <span className="mcp-ico">
        <Icon name="sparkles" size={18} />
      </span>
      <div className="stack grow" style={{ gap: 2, minWidth: 0 }}>
        <span className="text-sm" style={{ fontWeight: 600 }}>
          {active === false ? 'MCP app (inactive)' : 'Open in Nova'}
        </span>
        <span className="subtle mono truncate" title={link}>
          {link}
        </span>
      </div>
      {resolved ? (
        <Link to={resolved} className="btn btn-sm">
          <Icon name="link" size={14} /> Open
        </Link>
      ) : (
        <span className="badge badge-neutral">Unsupported link</span>
      )}
    </div>
  );
}
