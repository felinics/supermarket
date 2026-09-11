---
name: stripe-development
description: Test Stripe integrations and webhooks using the Stripe CLI.
---

# Stripe Development

## Establish the environment
Run `stripe --version` and inspect the project integration. Guide `stripe login` if the CLI has no session. Connector authentication and CLI authentication are independent. Use test mode for development and keep live-mode operations explicit.

## Webhook debugging
Start the local application, then use `stripe listen --forward-to <local-endpoint>`. Treat its webhook signing secret as a secret: configure it locally, do not echo it in the final answer. Use `stripe trigger <event>` to exercise the requested event in test mode. Inspect the application logs and verify both successful processing and duplicate-event handling where relevant.

## API requests
Discover commands with `stripe --help`. Confirm account and mode before any requested mutation. Do not pass `--live` or issue real charges to make a test pass. Stop the listener when the test is complete.

Reference: https://docs.stripe.com/stripe-cli
