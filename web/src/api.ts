import type { Announcement, Customer, MenuCategory, Order, Promotion, RestaurantSettings } from './types';

const API_URL = import.meta.env.VITE_API_URL as string;

// Every store gets its own client instance so requests are always scoped to
// the right slug and the auth token never leaks between stores in the same tab.
export function createApi(storeSlug: string) {
  function authHeaders(): Record<string, string> {
    const token = localStorage.getItem(`customerToken:${storeSlug}`);
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const res = await fetch(`${API_URL}/api/${storeSlug}${path}`, {
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

  return {
    getMenu: () => request<{ categories: MenuCategory[] }>('/menu'),
    getSettings: () => request<RestaurantSettings>('/settings'),
    getActivePromotions: () => request<{ promotions: Promotion[] }>('/promotions/active'),
    getActiveAnnouncements: () => request<{ announcements: Announcement[] }>('/announcements/active'),

    register: (email: string, password: string, name: string, phone?: string) =>
      request<{ token: string; customer: Customer }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, name, phone }),
      }),
    login: (email: string, password: string) =>
      request<{ token: string; customer: Customer }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),
    me: () => request<{ customer: Customer }>('/auth/me'),
    forgotPassword: (email: string) =>
      request<{ ok: boolean }>('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
    resetPassword: (token: string, password: string) =>
      request<{ ok: boolean }>('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) }),

    createOrder: (payload: unknown) =>
      request<{ order: Order; payment: { charged: boolean; note?: string } }>('/orders', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    getOrder: (id: number) => request<{ order: Order }>(`/orders/${id}`),
    myOrders: () => request<{ orders: Order[] }>('/orders/mine'),
  };
}

export { API_URL };
