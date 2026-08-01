import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { formatCents } from '../lib/money';
import { CardPointeTokenizer } from '../components/CardPointeTokenizer';
import type { RestaurantSettings } from '../types';

const TIP_PRESETS = [0, 10, 15, 20];

export function CheckoutPage() {
  const { storeSlug, api, cart, orderType, requestedTime, customer, clearCart } = useApp();
  const navigate = useNavigate();

  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [address, setAddress] = useState({ line1: '', line2: '', city: '', state: '', zip: '' });
  const [tipPercent, setTipPercent] = useState(15);
  const [notes, setNotes] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [redeemPoints, setRedeemPoints] = useState(0);
  const [settings, setSettings] = useState<RestaurantSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cardToken, setCardToken] = useState<string | null>(null);
  const [paymentNote, setPaymentNote] = useState<string | null>(null);

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => {});
  }, [api]);

  const subtotalCents = cart.reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0);
  const tipCents = Math.round((subtotalCents * tipPercent) / 100);
  const canRedeem = Boolean(customer && settings && customer.loyaltyPoints >= settings.loyaltyMinRedeemPoints);
  const redeemValueCents = settings ? Math.round(redeemPoints * settings.loyaltyRedeemValueCents) : 0;

  const cardRequired = Boolean(settings?.cardpointeConfigured);

  async function handlePlaceOrder(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload = {
        type: orderType,
        requestedTime,
        tipCents,
        notes,
        promoCode: promoCode.trim() || undefined,
        redeemPoints: redeemPoints > 0 ? redeemPoints : undefined,
        cart: cart.map((l) => ({
          menuItemId: l.menuItemId,
          sizeId: l.sizeId,
          quantity: l.quantity,
          extraIds: l.extras.map((e) => e.id),
          notes: l.notes,
          ...(l.halfAndHalf
            ? {
                halfAndHalf: {
                  secondMenuItemId: l.halfAndHalf.secondMenuItemId,
                  extras: l.halfAndHalf.extras.map((e) => ({ extraId: e.id, half: e.half })),
                },
              }
            : {}),
        })),
        ...(customer ? {} : { guest: { name: guestName, email: guestEmail, phone: guestPhone } }),
        ...(orderType === 'delivery' ? { address } : {}),
        ...(cardToken ? { cardToken } : {}),
      };
      const res = await api.createOrder(payload);
      setPaymentNote(res.payment.note || null);
      clearCart();
      navigate(`/${storeSlug}/order/${res.order.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to place order');
    } finally {
      setSubmitting(false);
    }
  }

  if (cart.length === 0) {
    return <p className="empty-state">Your cart is empty.</p>;
  }

  return (
    <form className="checkout-page" onSubmit={handlePlaceOrder}>
      <h1>Checkout</h1>

      {!customer && (
        <div className="option-group">
          <h4>Your info</h4>
          <input placeholder="Full name" value={guestName} onChange={(e) => setGuestName(e.target.value)} required />
          <input
            placeholder="Email"
            type="email"
            value={guestEmail}
            onChange={(e) => setGuestEmail(e.target.value)}
            required
          />
          <input placeholder="Phone" value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} required />
        </div>
      )}

      {orderType === 'delivery' && (
        <div className="option-group">
          <h4>Delivery address</h4>
          <input
            placeholder="Address line 1"
            value={address.line1}
            onChange={(e) => setAddress({ ...address, line1: e.target.value })}
            required
          />
          <input
            placeholder="Apt / suite (optional)"
            value={address.line2}
            onChange={(e) => setAddress({ ...address, line2: e.target.value })}
          />
          <input
            placeholder="City"
            value={address.city}
            onChange={(e) => setAddress({ ...address, city: e.target.value })}
            required
          />
          <input
            placeholder="State"
            value={address.state}
            onChange={(e) => setAddress({ ...address, state: e.target.value })}
            required
          />
          <input
            placeholder="ZIP"
            value={address.zip}
            onChange={(e) => setAddress({ ...address, zip: e.target.value })}
            required
          />
        </div>
      )}

      <div className="option-group">
        <h4>Tip</h4>
        <div className="segmented">
          {TIP_PRESETS.map((p) => (
            <button type="button" key={p} className={tipPercent === p ? 'active' : ''} onClick={() => setTipPercent(p)}>
              {p}%
            </button>
          ))}
        </div>
        <p className="muted">Tip: {formatCents(tipCents)}</p>
      </div>

      <div className="option-group">
        <h4>Promo code</h4>
        <input placeholder="Enter promo code (optional)" value={promoCode} onChange={(e) => setPromoCode(e.target.value.toUpperCase())} />
      </div>

      {canRedeem && settings && customer && (
        <div className="option-group">
          <h4>Redeem loyalty points</h4>
          <p className="muted">
            You have {customer.loyaltyPoints} points ({formatCents(Math.round(customer.loyaltyPoints * settings.loyaltyRedeemValueCents))} value).
          </p>
          <input
            type="number"
            min={0}
            max={customer.loyaltyPoints}
            step={1}
            value={redeemPoints}
            onChange={(e) => setRedeemPoints(Math.max(0, Math.min(customer.loyaltyPoints, parseInt(e.target.value, 10) || 0)))}
            placeholder={`Points to redeem (min ${settings.loyaltyMinRedeemPoints})`}
          />
          {redeemPoints > 0 && <p className="muted">Redeeming {redeemPoints} points = {formatCents(redeemValueCents)} off</p>}
        </div>
      )}

      <div className="option-group">
        <h4>Order notes</h4>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything we should know?" />
      </div>

      {cardRequired && settings?.cardpointeSite && (
        <div className="option-group">
          <h4>Card details</h4>
          <CardPointeTokenizer site={settings.cardpointeSite} testMode={settings.cardpointeTestMode} onToken={setCardToken} />
        </div>
      )}

      {error && <p className="error">{error}</p>}
      {paymentNote && <p className="muted">{paymentNote}</p>}

      <button className="btn btn-primary btn-lg" type="submit" disabled={submitting || (cardRequired && !cardToken)}>
        {submitting ? 'Placing order…' : 'Pay & Place Order'}
      </button>
    </form>
  );
}
