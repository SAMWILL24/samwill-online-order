import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { formatCents } from '../lib/money';
import type { RestaurantSettings } from '../types';

export function CartPage() {
  const { storeSlug, api, cart, updateQuantity, removeFromCart, orderType } = useApp();
  const [settings, setSettings] = useState<RestaurantSettings | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => {});
  }, [api]);

  const subtotalCents = cart.reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0);
  const deliveryFeeCents = orderType === 'delivery' ? settings?.deliveryFeeCents || 0 : 0;
  const taxCents = settings ? Math.round(subtotalCents * (settings.taxRateBps / 10000)) : 0;
  const estimatedTotal = subtotalCents + deliveryFeeCents + taxCents;

  const belowMinimum = orderType === 'delivery' && settings && subtotalCents < settings.minDeliveryCents && cart.length > 0;

  if (cart.length === 0) {
    return (
      <div className="empty-state">
        <p>Your cart is empty.</p>
        <Link className="btn btn-primary" to={`/${storeSlug}/menu`}>
          Browse the menu
        </Link>
      </div>
    );
  }

  return (
    <div className="cart-page">
      <h1>Your Cart</h1>
      {cart.map((line) => (
        <div className="cart-line" key={line.key}>
          <div>
            <div className="name">
              {line.halfAndHalf
                ? `Half ${line.menuItemName} / Half ${line.halfAndHalf.secondMenuItemName}`
                : line.menuItemName}{' '}
              ({line.sizeLabel})
            </div>
            {line.halfAndHalf && line.halfAndHalf.extras.length > 0 && (
              <div className="muted">
                {line.halfAndHalf.extras.map((e) => `${e.name} (${e.half})`).join(', ')}
              </div>
            )}
            {!line.halfAndHalf && line.extras.length > 0 && (
              <div className="muted">{line.extras.map((e) => e.name).join(', ')}</div>
            )}
            {line.notes && <div className="muted">Note: {line.notes}</div>}
          </div>
          <div className="cart-line-actions">
            <div className="qty-row">
              <button onClick={() => updateQuantity(line.key, line.quantity - 1)}>-</button>
              <span>{line.quantity}</span>
              <button onClick={() => updateQuantity(line.key, line.quantity + 1)}>+</button>
            </div>
            <div className="price">{formatCents(line.unitPriceCents * line.quantity)}</div>
            <button className="link-btn danger" onClick={() => removeFromCart(line.key)}>
              Remove
            </button>
          </div>
        </div>
      ))}

      <div className="cart-summary">
        <div className="summary-row">
          <span>Subtotal</span>
          <span>{formatCents(subtotalCents)}</span>
        </div>
        {orderType === 'delivery' && (
          <div className="summary-row">
            <span>Delivery fee</span>
            <span>{formatCents(deliveryFeeCents)}</span>
          </div>
        )}
        <div className="summary-row">
          <span>Estimated tax</span>
          <span>{formatCents(taxCents)}</span>
        </div>
        <div className="summary-row total">
          <span>Estimated total</span>
          <span>{formatCents(estimatedTotal)}</span>
        </div>
        {belowMinimum && settings && (
          <p className="error">Delivery orders require a minimum of {formatCents(settings.minDeliveryCents)}.</p>
        )}
      </div>

      <button className="btn btn-primary btn-lg" disabled={Boolean(belowMinimum)} onClick={() => navigate(`/${storeSlug}/checkout`)}>
        Checkout
      </button>
    </div>
  );
}
