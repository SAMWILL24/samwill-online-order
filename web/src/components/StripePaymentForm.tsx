import { useState } from 'react';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { getStripe } from '../lib/stripe';

function InnerForm({ onPaid }: { onPaid: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError(null);
    const result = await stripe.confirmPayment({ elements, redirect: 'if_required' });
    setSubmitting(false);
    if (result.error) {
      setError(result.error.message || 'Payment failed');
    } else {
      onPaid();
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <PaymentElement />
      {error && <p className="error">{error}</p>}
      <button className="btn btn-primary btn-lg" type="submit" disabled={!stripe || submitting}>
        {submitting ? 'Processing…' : 'Pay & Place Order'}
      </button>
    </form>
  );
}

export function StripePaymentForm({ clientSecret, onPaid }: { clientSecret: string; onPaid: () => void }) {
  const stripePromise = getStripe();
  if (!stripePromise) return <p className="error">Stripe publishable key is not configured.</p>;

  return (
    <Elements stripe={stripePromise} options={{ clientSecret }}>
      <InnerForm onPaid={onPaid} />
    </Elements>
  );
}
