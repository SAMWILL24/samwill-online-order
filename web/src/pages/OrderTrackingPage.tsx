import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import { useApp } from '../context/AppContext';
import { API_URL } from '../api';
import type { Order } from '../types';
import { formatCents } from '../lib/money';

const STATUS_STEPS = ['placed', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'completed'];

export function OrderTrackingPage() {
  const { api } = useApp();
  const { id } = useParams();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let socket: ReturnType<typeof io> | null = null;

    api
      .getOrder(Number(id))
      .then((res) => {
        setOrder(res.order);
        socket = API_URL ? io(API_URL) : io();
        socket.on('connect', () => socket!.emit('join-order', { storeId: res.order.storeId, orderId: Number(id) }));
        socket.on('order:update', (updated: Order) => {
          if (String(updated.id) === id) setOrder(updated);
        });
      })
      .catch((err) => setError(err.message));

    return () => {
      socket?.disconnect();
    };
  }, [id, api]);

  if (error) return <p className="error">{error}</p>;
  if (!order) return <div className="loading">Loading order…</div>;

  const activeIndex = STATUS_STEPS.indexOf(order.status);
  const relevantSteps =
    order.type === 'delivery' ? STATUS_STEPS : STATUS_STEPS.filter((s) => s !== 'out_for_delivery');

  return (
    <div className="tracking-page">
      <h1>Order #{order.id}</h1>
      <p className="muted">
        {order.type === 'delivery' ? 'Delivery' : order.type === 'curbside' ? 'Curbside' : 'Pickup'} &middot; requested {order.requestedTime}
      </p>

      {order.status === 'cancelled' ? (
        <p className="error">This order was cancelled.</p>
      ) : (
        <div className="status-timeline">
          {relevantSteps.map((step, i) => (
            <div key={step} className={`step ${i <= activeIndex ? 'done' : ''}`}>
              {step.replaceAll('_', ' ')}
            </div>
          ))}
        </div>
      )}

      <div className="cart-summary">
        {order.items.map((item, i) => (
          <div className="summary-row" key={i}>
            <span>
              {item.quantity}x{' '}
              {item.isHalfAndHalf ? `Half ${item.menuItemName} / Half ${item.secondMenuItemName}` : item.menuItemName} (
              {item.sizeLabel})
              {item.extras.length > 0 && (
                <span className="muted">
                  {' '}
                  + {item.extras.map((e) => (item.isHalfAndHalf ? `${e.name} (${e.half})` : e.name)).join(', ')}
                </span>
              )}
            </span>
            <span>{formatCents(item.unitPriceCents * item.quantity)}</span>
          </div>
        ))}
        <div className="summary-row">
          <span>Subtotal</span>
          <span>{formatCents(order.subtotalCents)}</span>
        </div>
        {order.promotionDiscountCents > 0 && (
          <div className="summary-row">
            <span>Discount{order.promotion ? ` (${order.promotion.title})` : ''}</span>
            <span>-{formatCents(order.promotionDiscountCents)}</span>
          </div>
        )}
        {order.loyaltyRedeemCents > 0 && (
          <div className="summary-row">
            <span>Loyalty points redeemed ({order.loyaltyPointsRedeemed})</span>
            <span>-{formatCents(order.loyaltyRedeemCents)}</span>
          </div>
        )}
        {order.deliveryFeeCents > 0 && (
          <div className="summary-row">
            <span>Delivery fee</span>
            <span>{formatCents(order.deliveryFeeCents)}</span>
          </div>
        )}
        <div className="summary-row">
          <span>Tax</span>
          <span>{formatCents(order.taxCents)}</span>
        </div>
        {order.tipCents > 0 && (
          <div className="summary-row">
            <span>Tip</span>
            <span>{formatCents(order.tipCents)}</span>
          </div>
        )}
        <div className="summary-row total">
          <span>Total</span>
          <span>{formatCents(order.totalCents)}</span>
        </div>
        {order.loyaltyPointsEarned > 0 && (
          <p className="muted" style={{ marginTop: '0.5rem' }}>
            You earned {order.loyaltyPointsEarned} loyalty points on this order.
          </p>
        )}
      </div>
    </div>
  );
}
