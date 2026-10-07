# Owner passkeys

The owner signs in to `/admin/` through the Keycloak `travel` realm. Passkeys
and security keys are Keycloak credentials: Travel implements no WebAuthn. The
PWA only starts the standard OIDC authorization-code flow (`frontend/src/auth.ts`)
and links to Keycloak's account console, so no Travel API change is needed.
Realm policy (relying-party identity, discoverable credentials, user
verification, the required actions and the login theme) is owned by
[tjorim/apps#265](https://github.com/tjorim/apps/issues/265).

## How the owner uses it

- **Enroll or manage:** sign in, open **Settings → Sign-in and passkeys → Manage
  passkeys and sign-in**. This opens `https://auth.tjor.im/realms/travel/account/`
  with a back link to `/admin/`; add, rename and remove credentials under
  *Signing in*.
- **Sign in:** `/admin/` redirects to Keycloak, which offers the passkey
  (conditional UI or its explicit button, as the realm theme provides) or the
  password.
- **Same owner:** a passkey is another credential on the same Keycloak user, so
  the token `sub` that the API uses as ownership is unchanged. Enrolling or
  removing a credential never creates a user or moves data.

## Recovery

- Keep the **password** as the deliberate fallback; do not remove it until a
  tested recovery path exists.
- Enroll at least two independent credentials (for example a synced device
  passkey and a hardware security key).
- **Lost device or key:** sign in with the password or another credential, open
  *Signing in* in the account console and remove the lost credential, then enrol
  a replacement.
- **Everything lost:** a Keycloak realm administrator resets the credentials of
  the same user in the `travel` realm (never delete and recreate the user: the
  new `sub` would not own the existing data). Recovery codes, if the realm
  enables them, are kept outside this repository.

## Pilot verification (#337)

Static realm configuration and synthetic password-token tests do not complete
the pilot; record browser-level evidence (screenshots or a short recording)
against each row when the realm policy from apps#265 is deployed.

| Check | Evidence |
|---|---|
| Enroll a passkey from the account console on a real browser/device | |
| Sign in with the passkey (conditional UI and/or explicit button) | |
| Existing trips load under the same `sub`; no second user in the realm | |
| Password fallback works | |
| Cancelling the browser passkey prompt returns to a usable login page | |
| Remove the credential; sign in with the password afterwards | |
| Sign out clears private caches and the next sign-in starts clean | |
| Synced / cross-device passkey | Not yet tested |
| Hardware security key | Not yet tested |
