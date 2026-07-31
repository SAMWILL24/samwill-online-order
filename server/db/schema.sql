CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  loyalty_points INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  label TEXT,
  line1 TEXT NOT NULL,
  line2 TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  supports_half_and_half INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS menu_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS item_sizes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Extra groups (e.g. "Toppings", "Dressing") are shared, reusable entities: the same
-- group (and its extras) can be attached to many menu items via menu_item_extra_groups,
-- so editing a group's options updates every item that uses it instead of duplicating data.
CREATE TABLE IF NOT EXISTS extra_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  min_select INTEGER NOT NULL DEFAULT 0,
  max_select INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS menu_item_extra_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  extra_group_id INTEGER NOT NULL REFERENCES extra_groups(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (menu_item_id, extra_group_id)
);

CREATE TABLE IF NOT EXISTS extras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  extra_group_id INTEGER NOT NULL REFERENCES extra_groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS restaurant_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL DEFAULT 'SAMWILL Kitchen',
  address TEXT NOT NULL DEFAULT '',
  delivery_fee_cents INTEGER NOT NULL DEFAULT 350,
  min_delivery_cents INTEGER NOT NULL DEFAULT 1500,
  tax_rate_bps INTEGER NOT NULL DEFAULT 625,
  delivery_radius_miles REAL NOT NULL DEFAULT 5,
  is_open_override TEXT NOT NULL DEFAULT 'auto',
  loyalty_earn_rate_per_dollar REAL NOT NULL DEFAULT 1,
  loyalty_redeem_value_cents REAL NOT NULL DEFAULT 1,
  loyalty_min_redeem_points INTEGER NOT NULL DEFAULT 100,
  pickup_enabled INTEGER NOT NULL DEFAULT 1,
  delivery_enabled INTEGER NOT NULL DEFAULT 1,
  curbside_enabled INTEGER NOT NULL DEFAULT 0,
  theme_accent_color TEXT NOT NULL DEFAULT '#0d9488',
  online_ordering_enabled INTEGER NOT NULL DEFAULT 1,
  store_description TEXT NOT NULL DEFAULT '',
  prep_time_minutes INTEGER NOT NULL DEFAULT 15,
  order_mode TEXT NOT NULL DEFAULT 'both' CHECK (order_mode IN ('asap_only', 'advance_only', 'both')),
  ad_image_url TEXT,
  header_image_url TEXT,
  footer_image_url TEXT,
  digital_menu_url TEXT
);

INSERT OR IGNORE INTO restaurant_settings (id) VALUES (1);

-- Per-day-of-week hours for pickup and delivery (day_of_week: 0=Sunday..6=Saturday).
CREATE TABLE IF NOT EXISTS business_hours (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('pickup', 'delivery')),
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  is_open INTEGER NOT NULL DEFAULT 1,
  open_time TEXT NOT NULL DEFAULT '11:00',
  close_time TEXT NOT NULL DEFAULT '21:00',
  UNIQUE (type, day_of_week)
);

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS promotions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  discount_value INTEGER NOT NULL,
  min_subtotal_cents INTEGER NOT NULL DEFAULT 0,
  auto_apply INTEGER NOT NULL DEFAULT 0,
  starts_at TEXT,
  ends_at TEXT,
  days_of_week TEXT,
  start_time TEXT,
  end_time TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  guest_name TEXT,
  guest_email TEXT,
  guest_phone TEXT,
  type TEXT NOT NULL CHECK (type IN ('pickup', 'delivery', 'curbside')),
  requested_time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'placed',
  subtotal_cents INTEGER NOT NULL,
  delivery_fee_cents INTEGER NOT NULL DEFAULT 0,
  tax_cents INTEGER NOT NULL DEFAULT 0,
  tip_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL,
  address_id INTEGER REFERENCES addresses(id),
  payment_intent_id TEXT,
  payment_status TEXT NOT NULL DEFAULT 'pending',
  notes TEXT,
  promotion_id INTEGER REFERENCES promotions(id),
  promo_code_entered TEXT,
  promotion_discount_cents INTEGER NOT NULL DEFAULT 0,
  loyalty_redeem_cents INTEGER NOT NULL DEFAULT 0,
  loyalty_points_earned INTEGER NOT NULL DEFAULT 0,
  loyalty_points_redeemed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS loyalty_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  points_delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id INTEGER NOT NULL REFERENCES menu_items(id),
  menu_item_name TEXT NOT NULL,
  size_id INTEGER REFERENCES item_sizes(id),
  size_label TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL,
  notes TEXT,
  is_half_and_half INTEGER NOT NULL DEFAULT 0,
  second_menu_item_id INTEGER REFERENCES menu_items(id),
  second_menu_item_name TEXT
);

CREATE TABLE IF NOT EXISTS order_item_extras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_item_id INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  extra_id INTEGER REFERENCES extras(id),
  extra_name TEXT NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0,
  half TEXT NOT NULL DEFAULT 'whole' CHECK (half IN ('left', 'right', 'whole'))
);
