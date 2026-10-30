# Recoverable share-link tokens and verifier configuration

## Status

Accepted on 2026-10-30 in [issue #20](https://github.com/tjorim/travel/issues/20).
This clarifies the recoverable-token exception in
[ADR 36](36-privacy-sharing-offline-policy.md): the owner must be able to copy an
existing share URL again through authenticated link management.

## Decision

Keep the raw capability token in `ShareLink.token` alongside its keyed
HMAC-SHA256 verifier. Anonymous delivery queries use the verifier; the raw token
is retained for owner recovery. The verifier does not protect against database
or backup readers: they can recover stored tokens and use any still-active
links. Travel provides access control, not end-to-end encryption.

The public default `share_link_secret` (`development-only-change-me`) is allowed
only when `TRAVEL_ENVIRONMENT=development`. Startup rejects it in every other
mode, including the default production mode. Production must set
`TRAVEL_SHARE_LINK_SECRET` to a separately managed secret, shared by all API
processes and preserved across restarts. Replacing the key without updating
stored verifiers makes existing tokens fail verification; key rotation is not
part of this change. Tests and local Compose explicitly use development mode.

## Consequences and backups

There is no migration or show-once URL flow. Delivery behavior, headers, rate
limits, and the existing link activation, rotation and revocation behavior are
unchanged. Owner recovery deliberately trades resistance to database disclosure
for the ability to copy an existing URL.

The `tjorim/apps` database backup contains recoverable bearer credentials, not
merely one-way verifiers. Treat both database and backup access as credential
access: retain ADR 36's encryption at rest, restricted operator access, separate
secret management and backup expiry within 90 days. Keeping the HMAC key out of
a backup does not make its raw tokens safe to disclose. The apps restore
procedure must reapply current deletion, publication and revocation state before
serving restored data, so a restore cannot reactivate old capabilities. Existing
object-storage write, purge and locking rules remain unchanged. VPS deployment
configuration and backup/restore operations belong to `tjorim/apps`.
