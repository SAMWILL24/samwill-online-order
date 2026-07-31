import type { Announcement, Customer, MenuCategory, Order, Promotion, RestaurantSettings } from './types';

const API_URL = import.meta.env.VITE_API_URL as string;

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('customerToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(options.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return body as T;
}

export const api = {
  getMenu: () => request<{ categories: MenuCategory[] }>('/api/menu'),
  getSettings: () => request<RestaurantSettings>('/api/settings'),
  getActivePromotions: () => request<{ promotions: Promotion[] }>('/api/promotions/active'),
  getActiveAnnouncements: () => request<{ announcements: Announcement[] }>('/api/announcements/active'),

  register: (email: string, password: string, name: string, phone?: string) =>
    request<{ token: string; customer: Customer }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name, phone }),
    }),
  login: (email: string, password: string) =>
    request<{ token: string; customer: Customer }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  me: () => request<{ customer: Customer }>('/api/auth/me'),

  createOrder: (payload: unknown) =>
    request<{ order: Order; payment: { clientSecret: string | null; note?: string } }>('/api/orders', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getOrder: (id: number) => request<{ order: Order }>(`/api/orders/${id}`),
  myOrders: () => request<{ orders: Order[] }>('/api/orders/mine'),
};

export { API_URL };
