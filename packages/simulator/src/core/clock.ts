const HOUR = 3_600_000;

/** Hours from the device's "now" to 8:00 tomorrow, in the visitor's own time zone. */
export function hoursUntilMorning(deviceNow: number, hour = 8): number {
  const target = new Date(deviceNow);
  target.setDate(target.getDate() + 1);
  target.setHours(hour, 0, 0, 0);
  return (target.getTime() - deviceNow) / HOUR;
}

/** A lab ticket as the lab card reported it: `readyAt` is real time at the moment it was requested. */
export interface LabTicket {
  evidenceId: string;
  name: string;
  readyAt: number;
  /** How far the demo clock had been skipped when the ticket was issued. */
  skippedAtRequest: number;
}

/** Tickets whose results are in, given real time and how far the demo clock has been skipped since. */
export function labsReady(tickets: LabTicket[], realNow: number, skippedNow: number): LabTicket[] {
  return tickets.filter((t) => realNow + (skippedNow - t.skippedAtRequest) >= t.readyAt);
}

const QUARTER = 15 * 60_000;

/**
 * Where "skip to tomorrow morning" lands, in device time: 8:00 tomorrow, or
 * later if a lab ticket would still be out then (overnight tests can take
 * longer than the night), rounded up to the quarter hour.
 */
export function morningTarget(deviceNow: number, tickets: LabTicket[]): number {
  const eight = deviceNow + hoursUntilMorning(deviceNow) * HOUR;
  const lastReady = Math.max(0, ...tickets.map((t) => t.readyAt + t.skippedAtRequest));
  return lastReady > eight ? Math.ceil(lastReady / QUARTER) * QUARTER : eight;
}
