# Security

Mise holds a kitchen's recipes and its staff's sign-in details, and often runs on a restaurant's
own network. Problems that put either at risk are taken seriously.

## Reporting a problem

Please don't open a public issue for a security problem. Use **Report a vulnerability** on the
repository's Security tab instead, which only the maintainer can read. Say what you found, how to
reproduce it, and which version you were running (shown at the bottom of Settings, and at
`/api/health`).

You'll get a reply within a week. Once a fix is released, the changelog says what was fixed and
credits you, unless you'd rather not be named.

## Supported versions

Fixes go into the newest release only. The installer and `docker compose pull` both move a kitchen
onto it, and migrations run by themselves when the server starts.
