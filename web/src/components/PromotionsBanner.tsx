import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import type { Promotion } from '../types';

export function PromotionsBanner() {
  const { api } = useApp();
  const [promotions, setPromotions] = useState<Promotion[]>([]);

  useEffect(() => {
    api.getActivePromotions().then((res) => setPromotions(res.promotions)).catch(() => {});
  }, [api]);

  if (promotions.length === 0) return null;

  return (
    <div className="promotions-banner">
      {promotions.map((p) => (
        <div className="promotion-card" key={p.id}>
          <div className="promotion-title">{p.title}</div>
          {p.description && <div className="promotion-desc">{p.description}</div>}
          {p.requiresCode && p.code && <div className="promotion-code">Use code: {p.code}</div>}
        </div>
      ))}
    </div>
  );
}
