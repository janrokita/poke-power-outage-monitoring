const API_URL = "https://power-outage.gkpge.pl/api/power-outage";

/**
 * Returns the current time in Warsaw timezone.
 * @returns The current time in Warsaw timezone.
 */
function getTimezoneTime(): Date {
  const now = new Date();
  const warsawTime = new Date(
    now.toLocaleString("en-US", { timeZone: "Europe/Warsaw" })
  );
  return warsawTime;
}

interface Teryt {
  voivodeshipName: string | null;
  countyName: string | null;
  communeName: string | null;
  cityName: string | null;
  streetName: string | null;
}

interface Address {
  numbers: string | null;
  teryt: Teryt | null;
}

interface Outage {
  id: number;
  uuid: string;
  type: number;
  regionName: string;
  description: string;
  startAt: string;
  stopAt: string;
  revoked: boolean;
  addresses: Address[];
}

/**
 * Formats the relative time between two dates.
 * @param date - The date to format.
 * @param now - The current time.
 * @returns The relative time in days, hours, or minutes.
 */
function formatRelativeTime(date: Date, now: Date): string {
  const diffMs = date.getTime() - now.getTime();
  const absDiffMs = Math.abs(diffMs);
  const isPast = diffMs < 0;

  const minutes = Math.floor(absDiffMs / (1000 * 60));
  const hours = Math.floor(absDiffMs / (1000 * 60 * 60));
  const days = Math.floor(absDiffMs / (1000 * 60 * 60 * 24));

  let relative: string;
  if (days > 0) {
    const remainingHours = hours % 24;
    relative = remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
  } else if (hours > 0) {
    const remainingMinutes = minutes % 60;
    relative =
      remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  } else {
    relative = `${minutes}m`;
  }

  return isPast ? `${relative} ago` : `in ${relative}`;
}

/**
 * Formats the duration between two dates.
 * @param startDate - The start date.
 * @param stopDate - The stop date.
 * @returns The duration in days, hours, or minutes.
 */
function formatDuration(startDate: Date, stopDate: Date): string {
  const diffMs = stopDate.getTime() - startDate.getTime();
  const minutes = Math.floor(diffMs / (1000 * 60));
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (days > 0) {
    const remainingHours = hours % 24;
    return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
  } else if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0
      ? `${hours}h ${remainingMinutes}m`
      : `${hours}h`;
  } else {
    return `${minutes}m`;
  }
}

interface OutageStatus {
  hasOutage: boolean;
  outages: {
    id: number;
    region: string;
    description: string;
    startAt: string;
    startAtRelative: string;
    stopAt: string;
    stopAtRelative: string;
    totalDuration: string;
    revoked: boolean;
    affectedAddresses: string[];
  }[];
  checkedAt: string;
}

function formatDate(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds()
  )}`;
}

/**
 * Fetches all the outages from the PGE API for the current day.
 * @returns An array of outages.
 */
async function fetchOutages(): Promise<Outage[]> {
  const now = getTimezoneTime();
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  // startAtTo: get outages that started before end of day
  // stopAtFrom: get outages that end after now (still active)
  const params = new URLSearchParams({
    startAtTo: formatDate(endOfDay),
    stopAtFrom: formatDate(now),
  });

  const res = await fetch(`${API_URL}?${params}`);
  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }
  return res.json() as Promise<Outage[]>;
}

/**
 * Finds the outage status for a specific place.
 * @param place - The name of the place to check for outages.
 * @param outages - The list of outages to search through.
 * @returns The outage status for the specified place.
 */
function findOutageStatus(place: string, outages: Outage[]): OutageStatus {
  const now = getTimezoneTime();
  const outagesForPlace = outages.filter((outage) => {
    // Check regionName
    if (outage.regionName?.toLowerCase().includes(place)) {
      return true;
    }

    // Check description
    if (outage.description?.toLowerCase().includes(place)) {
      return true;
    }
    // Check addresses cityName
    return outage.addresses?.some(
      (addr) => addr.teryt?.cityName?.toLowerCase() === place
    );
  });

  return {
    hasOutage: outagesForPlace.length > 0,
    outages: outagesForPlace.map((o) => {
      const startDate = new Date(o.startAt);
      const stopDate = new Date(o.stopAt);
      return {
        id: o.id,
        region: o.regionName,
        description: o.description,
        startAt: o.startAt,
        startAtRelative: formatRelativeTime(startDate, now),
        stopAt: o.stopAt,
        stopAtRelative: formatRelativeTime(stopDate, now),
        totalDuration: formatDuration(startDate, stopDate),
        revoked: o.revoked,
        affectedAddresses: o.addresses
          .filter((a) => a.teryt?.cityName?.toLowerCase() === place)
          .map((a) => a.numbers || "unknown")
          .filter(Boolean),
      };
    }),
    checkedAt: getTimezoneTime().toISOString(),
  };
}

/**
 * Fetches the current outage status for a specific place.
 * @param place - The name of the place to check for outages.
 * @returns The outage status for the specified place.
 */
export async function getOutageStatus(place: string): Promise<OutageStatus> {
  const outages = await fetchOutages();
  return findOutageStatus(place, outages);
}
