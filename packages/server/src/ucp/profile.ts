export const UCP_VERSION = '2026-04-08';

export const NETWORK_TOKEN_HANDLER = {
  id: 'amazon_pay_network_token',
  version: UCP_VERSION,
  available_instruments: [{ type: 'card', constraints: { brands: ['visa', 'mastercard', 'amex', 'discover'] } }],
};

export const STORED_METHOD_HANDLER = {
  id: 'partner_card_on_file',
  version: UCP_VERSION,
  available_instruments: [{ type: 'card' }],
};

export const CHECKOUT_CAPABILITY = {
  version: UCP_VERSION,
  spec: `https://ucp.dev/${UCP_VERSION}/specification/checkout/`,
  schema: `https://ucp.dev/${UCP_VERSION}/schemas/shopping/checkout.json`,
};

/** Payment handlers a session offers: stored cards only exist for a linked household. */
export function sessionHandlers(linked: boolean) {
  return {
    'com.amazon.payments.network_token': [NETWORK_TOKEN_HANDLER],
    ...(linked ? { 'com.amazon.payments.stored_payment_method': [STORED_METHOD_HANDLER] } : {}),
  };
}

/** The /.well-known/ucp discovery profile. */
export function ucpProfile(endpoint: string) {
  return {
    ucp: {
      version: UCP_VERSION,
      capabilities: { 'dev.ucp.shopping.checkout': [CHECKOUT_CAPABILITY] },
      services: { 'dev.ucp.shopping': [{ version: UCP_VERSION, transport: 'rest', endpoint }] },
      payment_handlers: {
        'com.amazon.payments.network_token': [NETWORK_TOKEN_HANDLER],
        'com.amazon.payments.stored_payment_method': [STORED_METHOD_HANDLER],
      },
    },
  };
}
