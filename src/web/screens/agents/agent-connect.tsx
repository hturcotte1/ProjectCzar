import type { JoinView } from '../../../shared/app-types';
import { CopyButton } from '../../components/ui';
import { JoinMessagesPanel } from './join-panel';

function Address({ label, value }: { label: string; value: string }) {
  return (
    <div className="ag-address">
      <div className="ag-address-text">
        <span className="label">{label}</span>
        <code className="ag-address-url">{value}</code>
      </div>
      <CopyButton text={value} small />
    </div>
  );
}

/** "Connect your agent": the join message, the notes for the owner, and the addresses behind it. */
export function AgentConnect({ join }: { join: JoinView }) {
  const instinct = join.agent.type === 'instinct';
  return (
    <div className="stack">
      <JoinMessagesPanel messages={join.messages} />
      {!instinct && (
        <details className="ag-details">
          <summary>Connection addresses</summary>
          <p className="muted small ag-help">
            These are already inside the message above. They are here in case your agent asks for one directly.
          </p>
          <div className="stack-sm">
            <Address label="Tool connection (MCP)" value={join.mcp_url} />
            <Address label="Web service description (OpenAPI)" value={join.openapi_url} />
            <Address label="Guide written for agents" value={join.guide_url} />
          </div>
        </details>
      )}
    </div>
  );
}
