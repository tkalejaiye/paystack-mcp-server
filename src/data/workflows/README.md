# Workflows

A workflow is a step-by-step recipe for a Paystack task that takes more than one API
call. Workflows add capabilities as content, not code: every step runs through the
generic tools (`get_paystack_operation`, `read_paystack_data`, `make_paystack_request`).
Adding a workflow means adding one markdown file here.

Each workflow is exposed three ways:

- as a **prompt** named after the workflow, so users can start it from their client
- as a **resource** at `paystack://workflows/{name}`
- through the **`get_paystack_workflow`** tool, so the model can find and follow it unprompted

## File format

`<name>.md`, with YAML frontmatter:

```yaml
---
name: create-invoice # kebab-case, must match the file name
title: Create and send an invoice
description: One or two sentences: what it does and when to use it
arguments: # optional; become prompt arguments, all optional when prompting
  - name: customer_email # snake_case
    description: Email address of the customer to invoice
    required: true # the workflow asks for it if it wasn't provided
operations: # every operation ID the steps use
  - customer_fetch
  - paymentRequest_create
sensitive: # optional; personal or financial inputs, never prompt arguments
  - bvn
events: # optional; webhook events the workflow waits for
  - customeridentification.success
---
```

The body is markdown for the model. Use these sections where they apply:

- `## Before you start`: prerequisites and what to check first
- `## Steps`: numbered steps. Name the operation ID and tool for every API call
- `## Confirm`: what to confirm with the user before any write
- `## Waiting`: for asynchronous results. Name the event, then the polling fallback:
  which operation to check, how many times, and what to tell the user if it's still pending
- `## If something goes wrong`: common errors and what they mean
- `## Report back`: what to tell the user at the end

`npm test` checks every workflow: required fields, naming, and that each listed
operation exists in the OpenAPI spec and is used in the steps. If the spec changes
under a workflow, CI fails.
