import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import type { RestaurantSettings } from '../types';

export function TermsPage() {
  const { api } = useApp();
  const [settings, setSettings] = useState<RestaurantSettings | null>(null);

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => {});
  }, [api]);

  const storeName = settings?.name || 'this restaurant';

  return (
    <div className="legal-page">
      <h1>Terms of Service</h1>
      <p className="muted">Last updated: {new Date().toLocaleDateString()}</p>

      <h2>1. Acceptance of Terms</h2>
      <p>
        By placing an order through {storeName}'s online ordering site, you agree to these Terms of Service. If you do
        not agree, please do not use this ordering site.
      </p>

      <h2>2. Orders and Payment</h2>
      <p>
        All orders are subject to acceptance and availability. Prices, menu items, and promotions may change without
        notice. Payment is processed at the time of ordering via our payment provider; card details are entered
        directly with that provider and are never stored on our servers.
      </p>

      <h2>3. Pickup, Delivery, and Curbside</h2>
      <p>
        Estimated preparation and delivery times are approximate and may vary due to order volume, weather, or other
        factors outside our control. It is your responsibility to arrive for pickup or be available at the delivery
        address around the requested time.
      </p>

      <h2>4. Cancellations and Refunds</h2>
      <p>
        Once an order has been placed, cancellation may not be possible if preparation has already begun. Contact{' '}
        {storeName} directly as soon as possible if you need to cancel or report an issue with your order. Refunds, if
        applicable, are issued to the original payment method.
      </p>

      <h2>5. Loyalty Program</h2>
      <p>
        Loyalty points, where offered, have no cash value, are non-transferable, and may be adjusted or discontinued
        at any time.
      </p>

      <h2>6. Accounts</h2>
      <p>
        You are responsible for maintaining the confidentiality of your account credentials and for all activity
        under your account.
      </p>

      <h2>7. Limitation of Liability</h2>
      <p>
        {storeName} is not liable for indirect, incidental, or consequential damages arising from use of this
        ordering site, to the fullest extent permitted by law.
      </p>

      <h2>8. Changes to These Terms</h2>
      <p>These Terms may be updated from time to time. Continued use of this site after changes constitutes acceptance of the updated Terms.</p>

      <h2>9. Contact</h2>
      <p>Questions about these Terms can be directed to {storeName} using the contact information on our site.</p>
    </div>
  );
}
