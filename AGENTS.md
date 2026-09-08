# Repository workflow

- Start changes on a `codex/` branch based on current `main`.
- Open a pull request and pass the `Validate` check before merging to `main`.
- Production on `saipi` automatically deploys validated commits from `main`; never deploy uncommitted files or edit active release source.
- Keep secrets, customer exports, generated artifacts, and scratch files out of Git.
- Use Node 24. Run `npm test` and `npm run build` for release changes.
- Preserve the manual Wix fulfillment flow: booking, manual AWB entry, and carrier events must not send tracking or create Wix fulfillments. The operator selects a booked shipment and marks it fulfilled after pickup.
- Follow `docs/DEPLOYMENT.md` for deployment checks, pauses, and rollback. Database migrations are not automatically applied during app deployment.
