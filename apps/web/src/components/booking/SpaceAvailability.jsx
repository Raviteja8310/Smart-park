import { CalendarClock, CircleAlert, Clock3, LoaderCircle } from 'lucide-react';
import './booking.css';

/** Format an instant in the facility's time zone, e.g. "Fri 14 Nov, 9:00 am". */
export function formatInZone(iso, timeZone, withDate = true) {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone, ...(withDate ? { weekday: 'short', day: 'numeric', month: 'short' } : {}), hour: 'numeric', minute: '2-digit'
    }).format(new Date(iso));
  } catch { return new Date(iso).toLocaleString(); }
}

function windowLabel(window, timeZone) {
  const sameDay = formatInZone(window.startAt, timeZone).split(',')[0] === formatInZone(window.endAt, timeZone).split(',')[0];
  return `${formatInZone(window.startAt, timeZone)} – ${formatInZone(window.endAt, timeZone, !sameDay)}`;
}

const KIND_LABEL = { in_use: 'In use', reserved: 'Reserved', held: 'On hold' };

/**
 * When the chosen space is free: occupancy right now, upcoming reserved windows, and the next
 * start time that can actually be booked for the selected duration (computed by the API with the
 * same rules as booking). `conflict` is the reservation that overlaps the time the driver picked.
 */
export default function SpaceAvailability({ schedule, timeZone, durationHours, conflict, occupiedTooSoon, onUseTime, autoNote }) {
  if (!schedule || schedule.loading && !schedule.data) {
    return <div className="sp-space-availability is-loading"><LoaderCircle className="sp-spin" size={15} /> Checking when this space is free…</div>;
  }
  if (schedule.error) return <div className="sp-space-availability"><span className="sp-muted">{schedule.error}</span></div>;
  const data = schedule.data;
  const booked = data.booked ?? [];
  const next = data.nextAvailable;
  const hours = Number(durationHours);
  const durationText = hours === 1 ? '1 hour' : `${hours} hours`;

  return (
    <div className="sp-space-availability" aria-live="polite">
      <div className="sp-space-availability-head">
        <strong><Clock3 size={15} /> Availability for {data.slot.code}</strong>
        <span className={`sp-space-now ${data.occupiedNow ? 'is-occupied' : booked.some((w) => new Date(w.startAt) <= new Date()) ? 'is-reserved' : 'is-free'}`}>
          {data.occupiedNow ? 'Occupied right now' : booked.some((w) => new Date(w.startAt) <= new Date()) ? 'Reserved right now' : 'Free right now'}
        </span>
      </div>

      {booked.length ? (
        <ul className="sp-space-booked">
          {booked.slice(0, 5).map((window) => (
            <li key={`${window.startAt}-${window.endAt}`}><span>{windowLabel(window, timeZone)}</span><em>{KIND_LABEL[window.kind] ?? 'Reserved'}</em></li>
          ))}
          {booked.length > 5 && <li className="sp-muted">{`+${booked.length - 5} more reservations in the next 14 days`}</li>}
        </ul>
      ) : <p className="sp-muted sp-space-none">No reservations for this space in the next 14 days.</p>}

      {next ? (
        <div className="sp-space-next">
          <span><CalendarClock size={15} /> {`Next available for ${durationText}: ${formatInZone(next.startAt, timeZone)} – ${formatInZone(next.endAt, timeZone, false)}`}</span>
          <button type="button" className="sp-button ghost" onClick={() => onUseTime(next.startAt)}>Use this time</button>
        </div>
      ) : <p className="sp-space-none sp-muted">{`No free ${durationText} window in the next 14 days. Try a shorter duration or another space.`}</p>}

      {autoNote && <p className="sp-space-note">{autoNote}</p>}
      {conflict && (
        <p className="sp-space-conflict" role="alert"><CircleAlert size={15} /> {`Your selected time overlaps a reservation (${windowLabel(conflict, timeZone)}). Choose another time or use the next available time.`}</p>
      )}
      {!conflict && occupiedTooSoon && (
        <p className="sp-space-conflict" role="alert"><CircleAlert size={15} /> This space is occupied right now, so it can only be booked from 30 minutes from now. Choose a later time or use the next available time.</p>
      )}
    </div>
  );
}
