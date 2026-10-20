/**
 * Payment processing stand-in. Amazon Wallet network tokens are only issued to
 * onboarded partners, so this processor accepts the simulator's demo
 * credentials and declines everything else; a real deployment swaps in a PSP
 * client behind the same interface.
 */

export interface PaymentInstrument {
  id?: string;
  handler_id?: string;
  type?: string;
  credential?: { type?: string; encrypted_token?: string; payment_method_id?: string };
}

export type ChargeResult = { ok: true; orderId: string } | { ok: false; code: 'payment_failed'; content: string };

export interface PaymentProcessor {
  charge(input: { sessionId: string; amountCents: number; instrument: PaymentInstrument }, newId: (p: string) => string): Promise<ChargeResult>;
}

const DECLINED: ChargeResult = { ok: false, code: 'payment_failed', content: 'Payment was declined. Please try a different payment method.' };

export const demoProcessor: PaymentProcessor = {
  async charge({ instrument }, newId) {
    const cred = instrument.credential ?? {};
    const networkOk =
      instrument.handler_id === 'amazon_pay_network_token' &&
      cred.type === 'encrypted_network_token' &&
      typeof cred.encrypted_token === 'string' &&
      cred.encrypted_token.startsWith('tok_alibi_demo_');
    const storedOk =
      instrument.handler_id === 'partner_card_on_file' &&
      cred.type === 'payment_method_reference' &&
      typeof cred.payment_method_id === 'string' &&
      cred.payment_method_id.startsWith('pm_alibi_demo_');
    return networkOk || storedOk ? { ok: true, orderId: newId('ord') } : DECLINED;
  },
};
