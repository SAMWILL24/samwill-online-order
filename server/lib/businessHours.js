const db = require('../db');

function getWeekHours(storeId, type) {
  return db
    .prepare('SELECT * FROM business_hours WHERE store_id = ? AND type = ? ORDER BY day_of_week')
    .all(storeId, type)
    .map((r) => ({
      dayOfWeek: r.day_of_week,
      isOpen: Boolean(r.is_open),
      openTime: r.open_time,
      closeTime: r.close_time,
    }));
}

function setWeekHours(storeId, type, days) {
  const upsert = db.prepare(
    `INSERT INTO business_hours (store_id, type, day_of_week, is_open, open_time, close_time)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (store_id, type, day_of_week) DO UPDATE SET is_open = excluded.is_open, open_time = excluded.open_time, close_time = excluded.close_time`
  );
  const tx = db.transaction((rows) => {
    for (const row of rows) {
      upsert.run(storeId, type, row.dayOfWeek, row.isOpen ? 1 : 0, row.openTime, row.closeTime);
    }
  });
  tx(days);
}

function formatTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

// Returns a human string for today's hours, e.g. "11:00 AM - 9:00 PM" or "Closed today".
function getTodayHoursLabel(storeId, type, now = new Date()) {
  const row = db.prepare('SELECT * FROM business_hours WHERE store_id = ? AND type = ? AND day_of_week = ?').get(storeId, type, now.getDay());
  if (!row || !row.is_open) return 'Closed today';
  return `${formatTime(row.open_time)} - ${formatTime(row.close_time)}`;
}

module.exports = { getWeekHours, setWeekHours, getTodayHoursLabel };
