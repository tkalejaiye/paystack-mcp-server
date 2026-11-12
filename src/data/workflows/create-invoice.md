---
name: create-invoice
title: Create and send an invoice
description: Create a Paystack payment request (invoice) for a customer, creating the customer first if they don't exist yet, and optionally email it to them.
arguments:
  - name: customer_email
    description: Email address of the customer to invoice
    required: true
  - name: amount
    description: Total in major units, e.g. 1500.50 for NGN 1,500.50. Leave out when using line items
  - name: currency
    description: NGN, GHS, ZAR or USD. Defaults to NGN
  - name: description
    description: What the invoice is for
  - name: due_date
    description: When payment is due, e.g. 2026-12-01
operations:
  - customer_fetch
  - customer_create
  - paymentRequest_create
  - paymentRequest_notify
  - paymentRequest_verify
---

## Before you start

- You need the customer's email, and either a total amount or line items (name, unit
  price and quantity for each). Ask for anything missing.
- Amounts are sent in the smallest currency unit: multiply by 100 and round to an integer
  (NGN 1,500.50 → 150050). Amounts with more than 2 decimal places are a mistake; ask.
- Use either `amount` or `line_items`, not both. Optional `tax` entries have a name and amount.

## Steps

1. Look up the customer with `customer_fetch` via `read_paystack_data`, using the email
   as the code (`/customer/{email}`, URL-encoded). It accepts an email or a customer code.
2. If the customer isn't found, create them with `customer_create` via
   `make_paystack_request`, passing the email and any first or last name the user gave.
3. Confirm the details with the user (see Confirm), then create the invoice with
   `paymentRequest_create` via `make_paystack_request`:
   - `customer`: the `customer_code` from step 1 or 2
   - `amount` (or `line_items`), in the smallest unit
   - `currency`, `description` and `due_date` (ISO 8601) if given
   - `send_notification`: `true` to email the invoice now, `false` to send it later
4. Check the result with `paymentRequest_verify` via `read_paystack_data`, using the
   `request_code` (`PRQ_...`) from step 3.
5. To send or resend the email later, use `paymentRequest_notify` via
   `make_paystack_request` with the `request_code`.

## Confirm

Before step 3, confirm the customer email, the total in major units with its currency
(e.g. "NGN 1,500.50"), the due date, and whether to email the invoice now.

## If something goes wrong

- "Customer not found" on step 1 is expected for new customers; continue to step 2.
- A validation error about amount usually means a decimal or major-unit value was sent.

## Report back

The request code (`PRQ_...`), status, total in major units, due date, and whether the
customer was emailed. Mention if a new customer was created.
