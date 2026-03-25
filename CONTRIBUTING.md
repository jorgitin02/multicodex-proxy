# Contributing

## Local validation

Run before opening a PR:

```bash
npm run validate
```

## Development flow

1. Keep changes scoped.
2. Add or update focused tests for routing, quota, or admin behavior.
3. Prefer configuration and operational changes that work in self-hosted environments.
4. Include rollback notes for behavior changes that affect request routing.
