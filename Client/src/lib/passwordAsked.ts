import type { Role, User } from '@mise/contracts';

/**
 * Whether saving someone on the staff screen asks for your own password
 * again, decided the way the server decides it, so the field is there before
 * the server has to say so:
 *
 * - "self": you are changing your own password or email, anywhere.
 * - "outside": you are outside the kitchen and adding someone, or changing
 *   how they sign in (password, email, PIN) or their role.
 * - null: nothing more is asked.
 */
export function passwordAsked({
  person,
  meId,
  outside,
  edit,
}: {
  /** Who is being edited; undefined while adding someone. */
  person: Pick<User, 'id' | 'email' | 'role'> | undefined;
  meId: string | undefined;
  /** Undefined until known: the server asks regardless. */
  outside: boolean | undefined;
  /** What the form will send. Empty password and PIN mean "keep it". */
  edit: { email: string | null; password: string; pin: string; role: Role };
}): 'self' | 'outside' | null {
  if (!person) return outside === true ? 'outside' : null;
  const changesEmail = edit.email !== person.email;
  if (person.id === meId && (edit.password !== '' || changesEmail)) return 'self';
  const changesSignInOrRights =
    edit.password !== '' || edit.pin !== '' || changesEmail || edit.role !== person.role;
  return outside === true && changesSignInOrRights ? 'outside' : null;
}
