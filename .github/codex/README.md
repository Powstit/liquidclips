# Codex incident-repair foundation

This directory contains the first guarded layer of the Liquid Clips repair
pipeline.

Current boundary:

- accepts manual `workflow_dispatch` or authenticated `repository_dispatch`
  events of type `railway_incident`;
- redacts and bounds the incident before Codex reads it;
- treats incident text as untrusted data;
- checks out the exact release SHA;
- permits writes only for an explicitly authorized low-risk backend, desktop,
  or account incident;
- blocks authentication, authorization, billing, payment, Whop, Stripe,
  payout, migration, model, secret, dependency-lock, deployment, workflow, and
  release changes;
- limits patch size;
- stores the patch and structured diagnosis as artifacts;
- independently runs the declared surface regression suite without the OpenAI
  API key;
- opens a draft PR only when the trigger explicitly requests it.

It never merges, deploys, tags, or changes Railway production.

## Required GitHub secret

- `OPENAI_API_KEY`

Keep this secret only in the `generate_fix` job. The independent verification
and optional PR job do not receive it.

## Repository-dispatch payload

```json
{
  "event_type": "railway_incident",
  "client_payload": {
    "incident_id": "inc_123",
    "surface": "backend",
    "environment": "production",
    "release": "backend-2026-07-03",
    "release_sha": "0000000000000000000000000000000000000000",
    "fingerprint": "feature:error:stack",
    "route": "/example",
    "error_code": "stable_error_code",
    "summary": "Sanitized summary",
    "message": "Sanitized message",
    "expected_behavior": "Business-as-usual state",
    "occurrences": 5,
    "affected_users": 2,
    "first_seen": "2026-07-03T10:00:00Z",
    "last_seen": "2026-07-03T10:05:00Z",
    "sentry_url": "https://example.sentry.io/issues/123",
    "railway_deployment_id": "deployment-id",
    "allow_patch": false,
    "open_draft_pr": false
  }
}
```

`allow_patch` and `open_draft_pr` default to false. High-risk incident text
forces `allow_patch` back to false.

## Still required before backend automation

- authenticated Railway/Sentry incident ingestion;
- incident persistence and deduplication;
- thresholds, cooldown, owner, and daily cost cap;
- GitHub repository-dispatch credential storage;
- Admin HQ incident state machine;
- post-deployment verification and automatic reopen;
- production proof that no raw PII or secret enters a dispatch payload.

Until those land, invoke the workflow manually with sanitized data.
