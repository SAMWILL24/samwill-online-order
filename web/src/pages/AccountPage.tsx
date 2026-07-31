import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import type { Order } from '../types';
import { formatCents } from '../lib/money';

export function AccountPage() {
  const { storeSlug, api, customer } = useApp();
  const [orders, setOrders] = useState<Order[]>([]);

  useEffect(() => {
    if (customer) api.myOrders().then((res) => setOrders(res.orders));
  }, [customer, api]);

  if (!customer) {
    return (
      <p className="empty-state">
        <Link to={`/${storeSlug}/login`}>Log in</Link> to see your order history.
      </p>
    );
  }

  return (
    <div className="account-page">
      <h1>Hi, {customer.name}</h1>
      <div className="loyalty-badge">⭐ {customer.loyaltyPoints} loyalty points</div>
      <h2>Order history</h2>
      {orders.length === 0 && <p className="muted">No past orders yet.</p>}
      {orders.map((o) => (
        <Link className="order-history-row" to={`/${storeSlug}/order/${o.id}`} key={o.id}>
          <span>
            Order #{o.id} &middot; {new Date(o.createdAt).toLocaleDateString()}
          </span>
          <span>{formatCents(o.totalCents)}</span>
          <span className="status-pill">{o.status}</span>
        </Link>
      ))}
    </div>
  );
}
