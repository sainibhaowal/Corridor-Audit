# Release versioning

CorridorAudit uses Semantic Versioning for named releases. The version in `package.json` is the app release version; ordinary commits do not change it. A release is made only after the release scope is reviewed, the changelog is updated, and the production build succeeds.

## Version decisions

- `0.x.y` means the product is a preview and its interfaces or audit behavior can still change.
- While below `1.0.0`, increase the minor number for a feature release (`0.1.0` to `0.2.0`) and the patch number for a fix-only release (`0.1.0` to `0.1.1`).
- `1.0.0` is reserved for the first release the project is ready to support as stable.
- After `1.0.0`, use major for incompatible changes, minor for backward-compatible features, and patch for backward-compatible fixes.

## Release checklist

1. Agree that the changes are ready to release and choose the version from the rules above.
2. Update `package.json`, the root package entry in `package-lock.json`, and `CHANGELOG.md` together.
3. Change `auditRulesVersion` in `src/core/build-info.ts` only when reconciliation methodology or risk classifications change. A UI-only release does not change the audit rules version.
4. Run `npm run typecheck` and `npm run build`.
5. Commit the release and create an annotated Git tag with the exact matching name, such as `v0.1.0`.
6. Push the release commit and tag. Do not move or reuse a published version tag; make a new patch release to correct a released build.

## Provenance

The app displays its release version and source revision. `/api/health` and each audit verdict record the app version, source revision, whether tracked source changes were present when Next.js loaded its config, and the audit rules version. Reports generated from a modified working tree are identified as local changes; they are not represented as a clean tagged build.

