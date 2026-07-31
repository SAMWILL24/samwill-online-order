import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { api } from '../api';
import type { RestaurantSettings } from '../types';
import { PromotionsBanner } from '../components/PromotionsBanner';
import { AnnouncementsBanner } from '../components/AnnouncementsBanner';

function firstEnabledType(s: RestaurantSettings): 'pickup' | 'delivery' | 'curbside' | null {
  if (s.pickupEnabled) return 'pickup';
  if (s.deliveryEnabled) return 'delivery';
  if (s.curbsideEnabled) return 'curbside';
  return null;
}

export function IntroPage() {
  const { orderType, setOrderType, requestedTime, setRequestedTime } = useApp();
  const [settings, setSettings] = useState<RestaurantSettings | null>(null);
  const [schedule, setSchedule] = useState<'asap' | 'future'>(requestedTime === 'ASAP' ? 'asap' : 'future');
  const [futureTime, setFutureTime] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api.getSettings().then((s) => {
      setSettings(s);
      const enabledMap = { pickup: s.pickupEnabled, delivery: s.deliveryEnabled, curbside: s.curbsideEnabled };
      if (!enabledMap[orderType]) {
        const fallback = firstEnabledType(s);
        if (fallback) setOrderType(fallback);
      }
      if (s.orderMode === 'asap_only') setSchedule('asap');
      if (s.orderMode === 'advance_only') setSchedule('future');
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleViewMenu() {
    setRequestedTime(schedule === 'asap' ? 'ASAP' : futureTime || 'ASAP');
    navigate('/menu');
  }

  const hoursToday = orderType === 'delivery' ? settings?.deliveryHoursToday : settings?.pickupHoursToday;

  if (settings && !settings.onlineOrderingEnabled) {
    return (
      <div className="intro">
        <h1>{settings.name}</h1>
        <p className="muted">Online ordering is currently paused. Please check back soon.</p>
      </div>
    );
  }

  return (
    <div className="intro">
      <h1>{settings?.name || 'SAMWILL Kitchen'}</h1>
      <p className="muted">{settings?.storeDescription || 'Order online for pickup or delivery.'}</p>

      <AnnouncementsBanner />
      <PromotionsBanner />

      <div className="segmented">
        {(!settings || settings.pickupEnabled) && (
          <button className={orderType === 'pickup' ? 'active' : ''} onClick={() => setOrderType('pickup')}>
            Pickup
          </button>
        )}
        {(!settings || settings.deliveryEnabled) && (
          <button className={orderType === 'delivery' ? 'active' : ''} onClick={() => setOrderType('delivery')}>
            Delivery
          </button>
        )}
        {settings?.curbsideEnabled && (
          <button className={orderType === 'curbside' ? 'active' : ''} onClick={() => setOrderType('curbside')}>
            Curbside
          </button>
        )}
      </div>

      {hoursToday && (
        <p className="muted">
          {orderType === 'delivery' ? 'Delivery' : orderType === 'curbside' ? 'Curbside' : 'Pickup'} hours today: {hoursToday}
        </p>
      )}
      {orderType === 'delivery' && settings && (
        <p className="muted">
          ${(settings.deliveryFeeCents / 100).toFixed(2)} delivery fee &middot; ${(settings.minDeliveryCents / 100).toFixed(2)} minimum
        </p>
      )}

      {settings?.orderMode !== 'advance_only' && settings?.orderMode !== 'asap_only' && (
        <div className="segmented">
          <button className={schedule === 'asap' ? 'active' : ''} onClick={() => setSchedule('asap')}>
            As soon as possible
          </button>
          <button className={schedule === 'future' ? 'active' : ''} onClick={() => setSchedule('future')}>
            Schedule for later
          </button>
        </div>
      )}

      {schedule === 'future' && (
        <input
          type="datetime-local"
          value={futureTime}
          onChange={(e) => setFutureTime(e.target.value)}
          className="time-input"
        />
      )}

      <button className="btn btn-primary btn-lg" onClick={handleViewMenu} disabled={schedule === 'future' && !futureTime}>
        View Menu
      </button>
    </div>
  );
}
