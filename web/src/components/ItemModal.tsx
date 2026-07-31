import { useMemo, useState } from 'react';
import type { ExtraHalf, MenuItem } from '../types';
import { formatCents } from '../lib/money';
import { useApp } from '../context/AppContext';

interface Props {
  item: MenuItem;
  onClose: () => void;
  supportsHalfAndHalf?: boolean;
  otherItemsInCategory?: MenuItem[];
}

export function ItemModal({ item, onClose, supportsHalfAndHalf, otherItemsInCategory = [] }: Props) {
  const { addToCart } = useApp();
  const [sizeId, setSizeId] = useState<number>(item.sizes[0]?.id);
  const [selectedExtras, setSelectedExtras] = useState<Record<number, number[]>>({});
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');

  const [isHalfAndHalf, setIsHalfAndHalf] = useState(false);
  const [secondItemId, setSecondItemId] = useState<number | undefined>(otherItemsInCategory[0]?.id);
  const [placements, setPlacements] = useState<Record<number, ExtraHalf>>({});

  const secondItem = otherItemsInCategory.find((i) => i.id === secondItemId);
  const size = item.sizes.find((s) => s.id === sizeId)!;
  const secondSize = secondItem?.sizes.find((s) => s.label === size?.label);

  function toggleExtra(groupId: number, extraId: number, max: number) {
    setSelectedExtras((prev) => {
      const current = prev[groupId] || [];
      if (current.includes(extraId)) {
        return { ...prev, [groupId]: current.filter((id) => id !== extraId) };
      }
      if (max === 1) return { ...prev, [groupId]: [extraId] };
      if (current.length >= max) return prev;
      return { ...prev, [groupId]: [...current, extraId] };
    });
  }

  function setPlacement(extraId: number, half: ExtraHalf | null) {
    setPlacements((prev) => {
      const next = { ...prev };
      if (half === null) delete next[extraId];
      else next[extraId] = half;
      return next;
    });
  }

  const groupErrors = useMemo(() => {
    if (isHalfAndHalf) {
      return item.extraGroups.filter((g) => {
        const groupExtraIds = new Set(g.extras.map((e) => e.id));
        let leftCount = 0;
        let rightCount = 0;
        for (const [idStr, half] of Object.entries(placements)) {
          if (!groupExtraIds.has(Number(idStr))) continue;
          if (half === 'left' || half === 'whole') leftCount++;
          if (half === 'right' || half === 'whole') rightCount++;
        }
        return leftCount < g.minSelect || leftCount > g.maxSelect || rightCount < g.minSelect || rightCount > g.maxSelect;
      });
    }
    return item.extraGroups.filter((g) => {
      const count = (selectedExtras[g.id] || []).length;
      return count < g.minSelect || count > g.maxSelect;
    });
  }, [item.extraGroups, selectedExtras, placements, isHalfAndHalf]);

  const chosenExtras = item.extraGroups.flatMap((g) =>
    (selectedExtras[g.id] || []).map((id) => g.extras.find((e) => e.id === id)!)
  );

  const halfPlacementExtras = useMemo(() => {
    const allExtras = item.extraGroups.flatMap((g) => g.extras);
    return Object.entries(placements).map(([idStr, half]) => {
      const extra = allExtras.find((e) => e.id === Number(idStr))!;
      const priceCents = half === 'whole' ? extra.priceCents : Math.round(extra.priceCents / 2);
      return { id: extra.id, name: extra.name, half, priceCents };
    });
  }, [placements, item.extraGroups]);

  const basePriceCents = isHalfAndHalf ? Math.max(size?.priceCents || 0, secondSize?.priceCents || 0) : size?.priceCents || 0;
  const extrasTotalCents = isHalfAndHalf
    ? halfPlacementExtras.reduce((sum, e) => sum + e.priceCents, 0)
    : chosenExtras.reduce((sum, e) => sum + e.priceCents, 0);
  const unitPriceCents = basePriceCents + extrasTotalCents;

  const canSubmit =
    Boolean(size) && groupErrors.length === 0 && (!isHalfAndHalf || (Boolean(secondItem) && Boolean(secondSize)));

  function handleAdd() {
    if (!canSubmit) return;
    if (isHalfAndHalf && secondItem && secondSize) {
      addToCart({
        menuItemId: item.id,
        menuItemName: item.name,
        sizeId: size.id,
        sizeLabel: size.label,
        quantity,
        extras: [],
        notes,
        unitPriceCents,
        halfAndHalf: {
          secondMenuItemId: secondItem.id,
          secondMenuItemName: secondItem.name,
          extras: halfPlacementExtras,
        },
      });
    } else {
      addToCart({
        menuItemId: item.id,
        menuItemName: item.name,
        sizeId: size.id,
        sizeLabel: size.label,
        quantity,
        extras: chosenExtras.map((e) => ({ id: e.id, name: e.name, priceCents: e.priceCents })),
        notes,
        unitPriceCents,
      });
    }
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>
          &times;
        </button>
        {item.imageUrl && <img className="modal-hero-image" src={item.imageUrl} alt="" />}
        <h2>{item.name}</h2>
        {item.description && <p className="muted">{item.description}</p>}

        {item.sizes.length > 0 && (
          <div className="option-group">
            <h4>Size</h4>
            {item.sizes.map((s) => (
              <label key={s.id} className="option-row">
                <input type="radio" name="size" checked={sizeId === s.id} onChange={() => setSizeId(s.id)} />
                {s.label} &mdash; {formatCents(s.priceCents)}
              </label>
            ))}
          </div>
        )}

        {supportsHalfAndHalf && otherItemsInCategory.length > 0 && (
          <div className="option-group">
            <label className="option-row">
              <input
                type="checkbox"
                checked={isHalfAndHalf}
                onChange={(e) => setIsHalfAndHalf(e.target.checked)}
              />
              Make it Half &amp; Half
            </label>
            {isHalfAndHalf && (
              <>
                <h4>Other half</h4>
                <select value={secondItemId} onChange={(e) => setSecondItemId(Number(e.target.value))}>
                  {otherItemsInCategory.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </select>
                {secondItem && !secondSize && (
                  <p className="error">{secondItem.name} isn't available in size {size?.label}.</p>
                )}
              </>
            )}
          </div>
        )}

        {!isHalfAndHalf &&
          item.extraGroups.map((g) => (
            <div className="option-group" key={g.id}>
              <h4>
                {g.name}{' '}
                <span className="muted">
                  (choose {g.minSelect === g.maxSelect ? g.minSelect : `${g.minSelect}-${g.maxSelect}`})
                </span>
              </h4>
              {g.extras.map((e) => (
                <label key={e.id} className="option-row">
                  <input
                    type={g.maxSelect === 1 ? 'radio' : 'checkbox'}
                    name={`group-${g.id}`}
                    checked={(selectedExtras[g.id] || []).includes(e.id)}
                    onChange={() => toggleExtra(g.id, e.id, g.maxSelect)}
                  />
                  {e.name} {e.priceCents > 0 && `+${formatCents(e.priceCents)}`}
                </label>
              ))}
            </div>
          ))}

        {isHalfAndHalf &&
          item.extraGroups.map((g) => (
            <div className="option-group" key={g.id}>
              <h4>
                {g.name} <span className="muted">(pick {g.minSelect}-{g.maxSelect} per half)</span>
              </h4>
              {g.extras.map((e) => (
                <div key={e.id} className="half-extra-row">
                  <span>
                    {e.name} {e.priceCents > 0 && `+${formatCents(e.priceCents)}`}
                  </span>
                  <div className="segmented segmented-sm">
                    {(['left', 'whole', 'right'] as ExtraHalf[]).map((half) => (
                      <button
                        type="button"
                        key={half}
                        className={placements[e.id] === half ? 'active' : ''}
                        onClick={() => setPlacement(e.id, placements[e.id] === half ? null : half)}
                      >
                        {half === 'left' ? 'Left' : half === 'right' ? 'Right' : 'Whole'}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}

        <div className="option-group">
          <h4>Notes</h4>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Special instructions" />
        </div>

        <div className="qty-row">
          <button onClick={() => setQuantity((q) => Math.max(1, q - 1))}>-</button>
          <span>{quantity}</span>
          <button onClick={() => setQuantity((q) => q + 1)}>+</button>
        </div>

        <button className="btn btn-primary btn-lg" disabled={!canSubmit} onClick={handleAdd}>
          Add to Cart &middot; {formatCents(unitPriceCents * quantity)}
        </button>
      </div>
    </div>
  );
}
