import { useT, type MessageKey } from '../i18n/index.js';

/** Said next to allergens or a dish card still showing what Mise last said. */
export function AwaitingNote({
  what,
  className = '',
}: {
  what: 'allergens' | 'card' | 'menu';
  className?: string;
}) {
  const { t } = useT();
  const key: MessageKey =
    what === 'allergens'
      ? 'offline.allergensOnceSent'
      : what === 'card'
        ? 'offline.cardOnceSent'
        : 'offline.menuOnceSent';
  return (
    <p role="status" className={`no-print text-accent text-sm ${className}`}>
      {t(key)}
    </p>
  );
}
