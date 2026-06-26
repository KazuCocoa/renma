---
id: context.domain.payment.idempotency
title: Payment Idempotency
version: 0.1.0
owner: payments-platform
status: stable
tags:
  - payment
  - reliability
---

# Payment Idempotency

Payment writes should be safe to retry. A request with the same idempotency key should produce one durable outcome, even if the client times out and sends the request again.

Review payment specs for key scope, duplicate handling, timeout behavior, and whether the response explains the original result.
