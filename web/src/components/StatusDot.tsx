import type { SessionStatus } from '@shared';

const LABEL: Record<SessionStatus, string> = {
  trabalhando: 'trabalhando',
  esperando: 'esperando você',
  parado: 'parado',
};

export function StatusDot({ status }: { status: SessionStatus }) {
  return <span className={`dot dot-${status}`} title={LABEL[status]} role="img" aria-label={LABEL[status]} />;
}
