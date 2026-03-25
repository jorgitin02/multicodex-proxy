# Security Policy

## Reporting

If you discover a security issue, do not open a public issue with exploit details.
Report it privately to the repository owner first, including:

- affected route or feature
- reproduction details
- impact assessment
- suggested mitigation if known

## Security baseline

This repository enforces:

- dependency audits in CI
- secret scanning in CI
- CodeQL analysis on push and pull requests
- DAST against a locally started self-hosted instance
