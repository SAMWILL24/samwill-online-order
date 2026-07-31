export interface MenuExtra {
  id: number;
  name: string;
  priceCents: number;
}

export interface MenuExtraGroup {
  id: number;
  name: string;
  minSelect: number;
  maxSelect: number;
  extras: MenuExtra[];
}

export interface MenuSize {
  id: number;
  label: string;
  priceCents: number;
}

export interface MenuItem {
  id: number;
  name: string;
  description: string | null;
  imageUrl: string | null;
  sizes: MenuSize[];
  extraGroups: MenuExtraGroup[];
}

export interface MenuCategory {
  id: number;
  name: string;
  supportsHalfAndHalf: boolean;
  items: MenuItem[];
}

export interface RestaurantSettings {
  name: string;
  address: string;
  deliveryFeeCents: number;
  minDeliveryCents: number;
  taxRateBps: number;
  pickupHoursToday: string;
  deliveryHoursToday: string;
  deliveryRadiusMiles: number;
  isOpenOverride: 'auto' | 'open' | 'closed';
  loyaltyEarnRatePerDollar: number;
  loyaltyRedeemValueCents: number;
  loyaltyMinRedeemPoints: number;
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  curbsideEnabled: boolean;
  themeAccentColor: string;
  onlineOrderingEnabled: boolean;
  storeDescription: string;
  prepTimeMinutes: number;
  orderMode: 'asap_only' | 'advance_only' | 'both';
  adImageUrl: string | null;
  headerImageUrl: string | null;
  footerImageUrl: string | null;
  digitalMenuUrl: string | null;
}

export interface Announcement {
  id: number;
  message: string;
}

export interface Promotion {
  id: number;
  title: string;
  description: string | null;
  imageUrl: string | null;
  discountType: 'percent' | 'fixed';
  discountValue: number;
  minSubtotalCents: number;
  requiresCode: boolean;
  code: string | null;
}

export interface CartLineExtra {
  id: number;
  name: string;
  priceCents: number;
}

export type ExtraHalf = 'left' | 'right' | 'whole';

export interface HalfAndHalfSelection {
  secondMenuItemId: number;
  secondMenuItemName: string;
  extras: { id: number; name: string; priceCents: number; half: ExtraHalf }[];
}

export interface CartLine {
  key: string;
  menuItemId: number;
  menuItemName: string;
  sizeId: number;
  sizeLabel: string;
  quantity: number;
  extras: CartLineExtra[];
  notes: string;
  unitPriceCents: number;
  halfAndHalf?: HalfAndHalfSelection;
}

export interface DeliveryAddress {
  label?: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  zip: string;
}

export interface OrderItem {
  menuItemName: string;
  sizeLabel: string;
  quantity: number;
  unitPriceCents: number;
  notes: string | null;
  extras: { name: string; priceCents: number; half: ExtraHalf }[];
  isHalfAndHalf: boolean;
  secondMenuItemName: string | null;
}

export interface Order {
  id: number;
  storeId: number;
  type: 'pickup' | 'delivery' | 'curbside';
  status: string;
  requestedTime: string;
  subtotalCents: number;
  deliveryFeeCents: number;
  taxCents: number;
  tipCents: number;
  promotionDiscountCents: number;
  loyaltyRedeemCents: number;
  loyaltyPointsEarned: number;
  loyaltyPointsRedeemed: number;
  promotion: { title: string; code: string | null } | null;
  totalCents: number;
  paymentStatus: string;
  notes: string | null;
  createdAt: string;
  guest: { name: string; email: string; phone: string } | null;
  address: { line1: string; line2?: string; city: string; state: string; zip: string } | null;
  items: OrderItem[];
}

export interface Customer {
  id: number;
  email: string;
  name: string;
  phone?: string;
  loyaltyPoints: number;
}
