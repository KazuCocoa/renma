---
id: context.domain.payment.idempotency
title: Payment Idempotency
version: 0.1.0
owner: payments-platform
status: stable
tags:
  - payment
  - reliability
when_to_use:
  - Reviewing payment write retry behavior or duplicate request handling
when_not_to_use:
  - Reviewing non-payment retries or read-only request behavior
allowed_data:
  - repo-local-files
  - disclosed-user-provided-data
network_allowed: false
external_upload_allowed: false
secrets_allowed: false
requires_human_approval: true
---

# Payment Idempotency

Payment writes should be safe to retry. A request with the same idempotency key should produce one durable outcome, even if the client times out and sends the request again.

Review payment specs for key scope, duplicate handling, timeout behavior, and whether the response explains the original result.
