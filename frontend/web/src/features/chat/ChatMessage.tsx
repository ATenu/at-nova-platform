import { Link } from 'react-router-dom';
import type { AgentToolLink, MessageDto } from '@/api/types';
import { Icon, type IconName } from '@/components/ui/Icon';
import { resolveNovaLink } from '@/lib/novaLinks';
import { McpAppLinkCard } from './McpAppLinkCard';

const ROLE_ICON: Record<MessageDto['role'], IconName> = {
  system: 'shield',
  user: 'user',
  assistant: 'sparkles',
};

function ToolLink({ link }: { link: AgentToolLink }) {
  const internal = link.href.startsWith('nova://') ? resolveNovaLink(link.href) : null;
  if (internal) {
    return (
      <Link to={internal} className="btn btn-sm">
        <Icon name="link" size={14} /> {link.label}
      </Link>
    );
  }
  return <span className="badge badge-neutral">{link.label}</span>;
}

/**
 * A single chat message. Assistant/user/system text is rendered as plain text
 * (never as raw HTML) to avoid injection from model output.
 */
export function ChatMessage({
  message,
  toolLinks,
}: {
  message: MessageDto;
  toolLinks?: readonly AgentToolLink[] | undefined;
}) {
  return (
    <div className={`chat-msg ${message.role}`}>
      <span className="chat-role-ico" aria-hidden>
        <Icon name={ROLE_ICON[message.role]} size={16} />
      </span>
      <div className="stack" style={{ gap: 8, minWidth: 0 }}>
        <div className="chat-bubble">{message.text}</div>
        {message.isMCPApps && message.MCPAppLink ? (
          <McpAppLinkCard link={message.MCPAppLink} active={message.MCPActive} />
        ) : null}
        {toolLinks && toolLinks.length > 0 ? (
          <div className="row wrap" style={{ gap: 8 }}>
            {toolLinks.map((link) => (
              <ToolLink key={`${link.type}-${link.href}`} link={link} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
