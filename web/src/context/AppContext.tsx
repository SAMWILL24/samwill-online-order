import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CartLine, Customer, DeliveryAddress } from '../types';
import { api } from '../api';

type OrderType = 'pickup' | 'delivery' | 'curbside';

interface AppState {
  orderType: OrderType;
  setOrderType: (t: OrderType) => void;
  requestedTime: string; // 'ASAP' or a formatted future time
  setRequestedTime: (t: string) => void;
  cart: CartLine[];
  addToCart: (line: Omit<CartLine, 'key'>) => void;
  updateQuantity: (key: string, quantity: number) => void;
  removeFromCart: (key: string) => void;
  clearCart: () => void;
  deliveryAddress: DeliveryAddress | null;
  setDeliveryAddress: (a: DeliveryAddress | null) => void;
  customer: Customer | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string, phone?: string) => Promise<void>;
  logout: () => void;
}

const AppContext = createContext<AppState | null>(null);

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [orderType, setOrderTypeState] = useState<OrderType>(() => loadJSON('orderType', 'pickup'));
  const [requestedTime, setRequestedTimeState] = useState<string>(() => loadJSON('requestedTime', 'ASAP'));
  const [cart, setCart] = useState<CartLine[]>(() => loadJSON('cart', []));
  const [deliveryAddress, setDeliveryAddressState] = useState<DeliveryAddress | null>(() => loadJSON('deliveryAddress', null));
  const [customer, setCustomer] = useState<Customer | null>(() => loadJSON('customer', null));
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('customerToken'));

  useEffect(() => localStorage.setItem('orderType', JSON.stringify(orderType)), [orderType]);
  useEffect(() => localStorage.setItem('requestedTime', JSON.stringify(requestedTime)), [requestedTime]);
  useEffect(() => localStorage.setItem('cart', JSON.stringify(cart)), [cart]);
  useEffect(() => localStorage.setItem('deliveryAddress', JSON.stringify(deliveryAddress)), [deliveryAddress]);
  useEffect(() => {
    if (customer) localStorage.setItem('customer', JSON.stringify(customer));
    else localStorage.removeItem('customer');
  }, [customer]);

  const setOrderType = (t: OrderType) => setOrderTypeState(t);
  const setRequestedTime = (t: string) => setRequestedTimeState(t);
  const setDeliveryAddress = (a: DeliveryAddress | null) => setDeliveryAddressState(a);

  const addToCart: AppState['addToCart'] = (line) => {
    const key = `${line.menuItemId}-${line.sizeId}-${line.extras.map((e) => e.id).sort().join('.')}-${line.notes}-${Date.now()}`;
    setCart((prev) => [...prev, { ...line, key }]);
  };
  const updateQuantity = (key: string, quantity: number) => {
    setCart((prev) => (quantity <= 0 ? prev.filter((l) => l.key !== key) : prev.map((l) => (l.key === key ? { ...l, quantity } : l))));
  };
  const removeFromCart = (key: string) => setCart((prev) => prev.filter((l) => l.key !== key));
  const clearCart = () => setCart([]);

  const login = async (email: string, password: string) => {
    const res = await api.login(email, password);
    setToken(res.token);
    setCustomer(res.customer);
    localStorage.setItem('customerToken', res.token);
  };
  const register = async (email: string, password: string, name: string, phone?: string) => {
    const res = await api.register(email, password, name, phone);
    setToken(res.token);
    setCustomer(res.customer);
    localStorage.setItem('customerToken', res.token);
  };
  const logout = () => {
    setToken(null);
    setCustomer(null);
    localStorage.removeItem('customerToken');
  };

  const value = useMemo<AppState>(
    () => ({
      orderType,
      setOrderType,
      requestedTime,
      setRequestedTime,
      cart,
      addToCart,
      updateQuantity,
      removeFromCart,
      clearCart,
      deliveryAddress,
      setDeliveryAddress,
      customer,
      token,
      login,
      register,
      logout,
    }),
    [orderType, requestedTime, cart, deliveryAddress, customer, token]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
