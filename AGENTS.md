# Repository workflow

- Start changes on a `codex/` branch based on current `main`.
- Open a pull request and pass the `Validate` check before merging to `main`.
- Production on `saipi` automatically deploys validated commits from `main`; never deploy uncommitted files or edit active release source.
- Keep secrets, customer exports, generated artifacts, and scratch files out of Git.
- Use Node 24. Run `npm test` and `npm run build` for release changes.
- Booking and manual AWB entry must not create Wix fulfillments (awaiting-pickup only). Fulfillment runs on operator Mark picked up or when carrier tracking reaches picked-up / later (Wix fulfill + Woo meta write-back when enabled).
- Follow `docs/DEPLOYMENT.md` for deployment checks, pauses, and rollback. Database migrations are not automatically applied during app deployment.
