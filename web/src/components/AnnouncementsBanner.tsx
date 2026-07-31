import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Announcement } from '../types';

export function AnnouncementsBanner() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);

  useEffect(() => {
    api.getActiveAnnouncements().then((res) => setAnnouncements(res.announcements)).catch(() => {});
  }, []);

  if (announcements.length === 0) return null;

  return (
    <div className="announcements-banner">
      {announcements.map((a) => (
        <div className="announcement-strip" key={a.id}>
          {a.message}
        </div>
      ))}
    </div>
  );
}
