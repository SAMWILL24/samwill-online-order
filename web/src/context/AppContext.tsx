import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CartLine, Customer, DeliveryAddress } from '../types';
import { createApi } from '../api';

type OrderType = 'pickup' | 'delivery' | 'curbside';

interface AppState {
  storeSlug: string;
  api: ReturnType<typeof createApi>;
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

// Every key is namespaced by store slug: two different restaurants opened in the same
// browser must never share a cart, login session, or order-type preference.
function storageKey(storeSlug: string, key: string) {
  return `${key}:${storeSlug}`;
}

function loadJSON<T>(storeSlug: string, key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(storageKey(storeSlug, key));
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function AppProvider({ storeSlug, children }: { storeSlug: string; children: ReactNode }) {
  const api = useMemo(() => createApi(storeSlug), [storeSlug]);

  const [orderType, setOrderTypeState] = useState<OrderType>(() => loadJSON(storeSlug, 'orderType', 'pickup'));
  const [requestedTime, setRequestedTimeState] = useState<string>(() => loadJSON(storeSlug, 'requestedTime', 'ASAP'));
  const [cart, setCart] = useState<CartLine[]>(() => loadJSON(storeSlug, 'cart', []));
  const [deliveryAddress, setDeliveryAddressState] = useState<DeliveryAddress | null>(() =>
    loadJSON(storeSlug, 'deliveryAddress', null)
  );
  const [customer, setCustomer] = useState<Customer | null>(() => loadJSON(storeSlug, 'customer', null));
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(storageKey(storeSlug, 'customerToken')));

  useEffect(() => localStorage.setItem(storageKey(storeSlug, 'orderType'), JSON.stringify(orderType)), [storeSlug, orderType]);
  useEffect(
    () => localStorage.setItem(storageKey(storeSlug, 'requestedTime'), JSON.stringify(requestedTime)),
    [storeSlug, requestedTime]
  );
  useEffect(() => localStorage.setItem(storageKey(storeSlug, 'cart'), JSON.stringify(cart)), [storeSlug, cart]);
  useEffect(
    () => localStorage.setItem(storageKey(storeSlug, 'deliveryAddress'), JSON.stringify(deliveryAddress)),
    [storeSlug, deliveryAddress]
  );
  useEffect(() => {
    if (customer) localStorage.setItem(storageKey(storeSlug, 'customer'), JSON.stringify(customer));
    else localStorage.removeItem(storageKey(storeSlug, 'customer'));
  }, [storeSlug, customer]);

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
    localStorage.setItem(storageKey(storeSlug, 'customerToken'), res.token);
  };
  const register = async (email: string, password: string, name: string, phone?: string) => {
    const res = await api.register(email, password, name, phone);
    setToken(res.token);
    setCustomer(res.customer);
    localStorage.setItem(storageKey(storeSlug, 'customerToken'), res.token);
  };
  const logout = () => {
    setToken(null);
    setCustomer(null);
    localStorage.removeItem(storageKey(storeSlug, 'customerToken'));
  };

  const value = useMemo<AppState>(
    () => ({
      storeSlug,
      api,
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
    [storeSlug, api, orderType, requestedTime, cart, deliveryAddress, customer, token]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
