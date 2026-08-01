import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import type { RestaurantSettings } from '../types';

export function PrivacyPage() {
  const { api } = useApp();
  const [settings, setSettings] = useState<RestaurantSettings | null>(null);

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => {});
  }, [api]);

  const storeName = settings?.name || 'this restaurant';

  return (
    <div className="legal-page">
      <h1>Privacy Policy</h1>
      <p className="muted">Last updated: {new Date().toLocaleDateString()}</p>

      <h2>1. Information We Collect</h2>
      <p>
        When you place an order or create an account with {storeName}, we collect your name, email address, phone
        number, and, for delivery orders, your delivery address. We do not collect or store your card number, expiry
        date, or CVV &mdash; those are entered directly with our payment provider and tokenized before reaching our
        servers.
      </p>

      <h2>2. How We Use Your Information</h2>
      <ul>
        <li>To process and fulfill your orders</li>
        <li>To send order confirmations and status updates</li>
        <li>To operate our loyalty program, if you participate</li>
        <li>To respond to support requests</li>
      </ul>

      <h2>3. Sharing Your Information</h2>
      <p>
        We share order and payment details with our payment processor solely to complete your transaction. We do not
        sell your personal information to third parties.
      </p>

      <h2>4. Data Retention</h2>
      <p>We retain order history and account information for as long as your account is active or as needed to comply with legal obligations.</p>

      <h2>5. Your Choices</h2>
      <p>
        You can update your account information at any time, or contact {storeName} to request that your account and
        associated data be deleted, subject to records we're required to keep for tax or legal purposes.
      </p>

      <h2>6. Security</h2>
      <p>
        We use industry-standard measures to protect your information, including hashed passwords and a PCI-compliant
        tokenized payment flow.
      </p>

      <h2>7. Changes to This Policy</h2>
      <p>This Privacy Policy may be updated from time to time. Continued use of this site after changes constitutes acceptance of the updated policy.</p>

      <h2>8. Contact</h2>
      <p>Questions about this Privacy Policy can be directed to {storeName} using the contact information on our site.</p>
    </div>
  );
}
