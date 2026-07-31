import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import type { MenuCategory, MenuItem } from '../types';
import { ItemModal } from '../components/ItemModal';
import { formatCents } from '../lib/money';

export function MenuPage() {
  const { api } = useApp();
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [activeCategory, setActiveCategory] = useState<number | null>(null);
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getMenu()
      .then((data) => {
        setCategories(data.categories);
        setActiveCategory(data.categories[0]?.id ?? null);
      })
      .finally(() => setLoading(false));
  }, [api]);

  if (loading) return <div className="loading">Loading menu…</div>;

  return (
    <div className="menu-layout">
      <aside className="menu-sidebar">
        {categories.map((cat) => (
          <button
            key={cat.id}
            className={activeCategory === cat.id ? 'active' : ''}
            onClick={() => setActiveCategory(cat.id)}
          >
            {cat.name}
          </button>
        ))}
      </aside>

      <div className="menu-items">
        {categories
          .filter((cat) => cat.id === activeCategory)
          .map((cat) => (
            <div key={cat.id}>
              <h2>{cat.name}</h2>
              {cat.items.map((item) => (
                <button className="menu-item-card" key={item.id} onClick={() => setSelectedItem(item)}>
                  {item.imageUrl && <img className="menu-item-thumb" src={item.imageUrl} alt="" />}
                  <div style={{ flex: 1 }}>
                    <div className="name">{item.name}</div>
                    {item.description && <div className="muted">{item.description}</div>}
                  </div>
                  <div className="sizes">
                    {item.sizes.map((s) => (
                      <span key={s.id} className="size-chip">
                        {s.label} {formatCents(s.priceCents)}
                      </span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          ))}
      </div>

      {selectedItem &&
        (() => {
          const activeCat = categories.find((c) => c.id === activeCategory);
          return (
            <ItemModal
              item={selectedItem}
              onClose={() => setSelectedItem(null)}
              supportsHalfAndHalf={activeCat?.supportsHalfAndHalf}
              otherItemsInCategory={activeCat?.items.filter((i) => i.id !== selectedItem.id)}
            />
          );
        })()}
    </div>
  );
}
