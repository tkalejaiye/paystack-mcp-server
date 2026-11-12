---
name: create-dedicated-virtual-account
title: Create a dedicated virtual account
description: Validate a customer's identity and create a dedicated virtual account (a bank account number assigned to them) so they can pay by bank transfer.
arguments:
  - name: customer_email
    description: Email address of the customer
    required: true
  - name: first_name
    description: Customer's first name, as on their bank account
  - name: last_name
    description: Customer's last name, as on their bank account
  - name: phone
    description: Customer's phone number
operations:
  - customer_fetch
  - customer_create
  - customer_update
  - dedicatedAccount_list
  - bank_list
  - customer_validate
  - dedicatedAccount_availableProviders
  - dedicatedAccount_create
  - dedicatedAccount_assign
sensitive:
  - bvn
  - account_number
events:
  - customeridentification.success
  - customeridentification.failed
  - dedicatedaccount.assign.success
  - dedicatedaccount.assign.failed
---

## Before you start

- Dedicated virtual accounts have to be enabled for the Paystack business and are only
  offered in some countries. If an API call says the feature isn't available, stop and
  tell the user to check https://paystack.com/docs/payments/dedicated-virtual-accounts/
  or contact Paystack support.
- The customer needs a first name, last name and phone number on their Paystack record.
- Validation needs the customer's BVN and a bank account in their name (bank and account
  number). Only ask for these when you reach step 4.

## Steps

1. Look up the customer with `customer_fetch` via `read_paystack_data`, using their email
   as the code. If they don't exist, create them with `customer_create` via
   `make_paystack_request` (email, first_name, last_name, phone). If they exist but are
   missing a name or phone, add it with `customer_update`.
2. Check for an existing account with `dedicatedAccount_list` via `read_paystack_data`,
   passing the customer's numeric `id` as `customer`. If they already have an active one,
   report it and stop.
3. If the customer record shows `identified: true`, skip to step 6.
4. Ask for the customer's BVN, their bank and their account number. Find the bank's code
   with `bank_list` via `read_paystack_data` (`country`: `nigeria`).
5. Validate the customer with `customer_validate` via `make_paystack_request`, at
   `/customer/{customer_code}/identification`, with `country` `NG`, `type`
   `bank_account`, `bvn`, `bank_code`, `account_number`, `first_name` and `last_name`.
   The response only means the request was accepted; the result comes later (see Waiting).
6. Get the available banks with `dedicatedAccount_availableProviders` via
   `read_paystack_data`. If there's more than one, ask the user which to use. In test mode,
   use the test provider it returns.
7. Confirm with the user (see Confirm), then create the account with
   `dedicatedAccount_create` via `make_paystack_request`, with `customer` (the customer
   code) and `preferred_bank` (the provider's `provider_slug`).

Alternative: when the customer doesn't exist yet and the user has every detail up front,
`dedicatedAccount_assign` creates the customer, validates them and assigns an account in
one call. Its result also arrives later (`dedicatedaccount.assign.success`), so check for
the account with `dedicatedAccount_list` as in step 2.

## Waiting

Validation is asynchronous. Paystack reports the result with the
`customeridentification.success` or `customeridentification.failed` webhook. If you can't
receive webhook events, poll instead: call `customer_fetch` again and check `identified`.
Check up to 5 times. If it's still not identified, stop and tell the user validation is
pending and they can ask you to check again later. Don't create the account until the
customer is identified.

## Confirm

Before step 7, confirm the customer (name and email) and the bank.

## If something goes wrong

- Validation fails when the BVN, account and name don't match. Tell the user which
  details to check, without repeating the BVN or account number in full.
- An error that the customer isn't identified means step 7 ran before validation
  finished; go back to Waiting.

## Report back

The account number, account name and bank, and that payments to it are credited to the
business and linked to this customer.
