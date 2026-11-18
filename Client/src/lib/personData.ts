import type { PersonData } from '@mise/contracts';
import { LANGUAGE_NAMES, roleName, type Translator } from '../i18n/index.js';

/**
 * One person's data as a page they can read, in the kitchen's language. The
 * JSON next to it holds exactly the same, for a computer.
 */
export function readablePersonData(translator: Translator, data: PersonData): string {
  const { t, locale } = translator;
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(locale) : '—');
  const yes = (value: boolean) => (value ? t('personData.yes') : t('personData.no'));
  const person = data.person;
  const out: string[] = [];

  const heading = (text: string) => out.push('', text, '-'.repeat(text.length));
  const field = (label: string, value: string | null) => out.push(`${label}: ${value ?? '—'}`);
  const none = (list: unknown[]) => {
    if (list.length === 0) out.push(t('personData.none'));
  };

  const title = t('personData.title', { name: person.displayName });
  out.push(title, '='.repeat(title.length));
  out.push(t('personData.made', { date: when(data.exportedAt), kitchen: data.kitchen }));

  heading(t('personData.account'));
  field(t('common.name'), person.displayName);
  field(t('common.email'), person.email);
  field(t('staff.role'), roleName(t, person.role));
  field(t('staff.station'), person.station);
  field(t('personData.active'), yes(person.active));
  field(t('personData.language'), person.language ? LANGUAGE_NAMES[person.language] : null);
  field(t('personData.hasPassword'), yes(person.hasPassword));
  field(t('personData.hasPin'), yes(person.hasPin));
  field(t('personData.pinSetAt'), when(person.pinSetAt));
  field(t('personData.tourSeenAt'), when(person.tourSeenAt));
  field(t('personData.lockedUntil'), when(person.lockedUntil));
  field(t('personData.createdAt'), when(person.createdAt));
  field(t('personData.updatedAt'), when(person.updatedAt));
  out.push(t('personData.secrets'));

  heading(t('personData.lines'));
  none(data.prepLines);
  for (const line of data.prepLines) {
    const parts = [
      line.added ? t('personData.lineAdded') : null,
      line.onIt ? t('personData.lineOnIt') : null,
      line.ticked ? t('personData.lineTicked') : null,
    ].filter(Boolean);
    out.push(
      `• ${line.description}${line.station ? ` (${line.station})` : ''}`,
      `  ${t('personData.lineTimes', { added: when(line.addedAt), ticked: when(line.completedAt) })}`,
      `  ${parts.join(' · ')}`,
    );
  }

  heading(t('personData.recipes'));
  none(data.recipes);
  for (const recipe of data.recipes) out.push(`• ${recipe.name} (${when(recipe.createdAt)})`);

  heading(t('personData.note'));
  if (data.handoverNote) {
    out.push(when(data.handoverNote.at), data.handoverNote.text ?? '');
  } else {
    out.push(t('personData.none'));
  }

  heading(t('personData.sessions'));
  none(data.sessions);
  for (const session of data.sessions) {
    out.push(
      `• ${t('personData.session', {
        started: when(session.startedAt),
        seen: when(session.lastSeenAt),
        ends: when(session.endsAt),
      })}`,
    );
    if (session.tablet) out.push(`  ${t('personData.tablet')}: ${session.tablet}`);
    if (session.browser) out.push(`  ${t('personData.browser')}: ${session.browser}`);
  }

  heading(t('personData.devices'));
  none(data.approvedDevices);
  for (const device of data.approvedDevices) {
    out.push(
      `• ${device.name}: ${t('personData.device', {
        approved: when(device.approvedAt),
        seen: when(device.lastSeenAt),
      })}`,
    );
  }

  return `${out.join('\n')}\n`;
}
