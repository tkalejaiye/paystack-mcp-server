// Endpoints make_paystack_request (and every other tool) may call when
// PAYSTACK_MODE=live. Anything not listed here is rejected before it reaches
// Paystack. Edit this list to widen or narrow what a live key can do.
//
// `match: 'prefix'` covers the path itself and anything below it on a segment
// boundary, e.g. '/customer' matches '/customer' and '/customer/CUS_x' but not
// '/customers'. `match: 'exact'` only matches the path itself.
export interface LiveAllowlistEntry {
  methods: Array<'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'>;
  path: string;
  match: 'prefix' | 'exact';
}

export const LIVE_ALLOWLIST: LiveAllowlistEntry[] = [
  // Payment requests (invoices): create, list, fetch, update, verify, notify, finalize, archive, totals
  { methods: ['GET', 'POST', 'PUT'], path: '/paymentrequest', match: 'prefix' },
  // Customers. Note this includes /customer/set_risk_action and
  // /customer/authorization/deactivate; remove 'POST' or add exclusions if that's too broad.
  { methods: ['GET', 'POST', 'PUT'], path: '/customer', match: 'prefix' },
  // Read-only transaction lookups (list, fetch, verify, totals, export, timeline)
  { methods: ['GET'], path: '/transaction', match: 'prefix' },
  { methods: ['GET'], path: '/balance', match: 'exact' },
];
