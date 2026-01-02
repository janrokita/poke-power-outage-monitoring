import Redis from "ioredis";
import { getOutageStatus } from "./lib/pge-api";

if (!process.env.REDIS_URL) {
  throw new Error("REDIS_URL is not defined");
}

if (!process.env.POKE_API_KEY) {
  throw new Error("POKE_API_KEY is not defined");
}

if (!process.env.POWER_OUTAGE_LOCATION) {
  throw new Error("POWER_OUTAGE_LOCATION is not defined");
}

const REDIS_KEY = "power-outage:last-status";
const LOCATION = process.env.POWER_OUTAGE_LOCATION;

interface StoredOutage {
  id: number;
  startAt: string;
  stopAt: string;
}

interface StoredStatus {
  hasOutage: boolean;
  outages: StoredOutage[];
  lastChecked: string;
}

const redis = new Redis(process.env.REDIS_URL);

async function getLastStatus(): Promise<StoredStatus | null> {
  const data = await redis.get(REDIS_KEY);
  if (!data) return null;
  return JSON.parse(data) as StoredStatus;
}

async function saveStatus(status: StoredStatus): Promise<void> {
  await redis.set(REDIS_KEY, JSON.stringify(status));
}

async function callWebhook(): Promise<void> {
  try {
    const response = await fetch(
      `https://poke.com/api/v1/inbound-sms/webhook`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + process.env.POKE_API_KEY,
        },
        body: JSON.stringify({
          message: `[AUTOMATED] The power outage monitor has detected an outage or a change in the power outage status, please call the MCP to get the lastest information and notify the user.`,
        }),
      }
    );
    if (!response.ok) {
      console.error(
        `Webhook failed: ${response.status} ${response.statusText}`
      );
    } else {
      console.log("Webhook called successfully!");
    }
  } catch (error) {
    console.error("Webhook error:", error);
  }
}

function hasStatusChanged(
  current: Awaited<ReturnType<typeof getOutageStatus>>,
  previous: StoredStatus | null
): boolean {
  if (!previous) return true; // First run, consider it changed

  // Check if hasOutage changed
  if (current.hasOutage !== previous.hasOutage) return true;

  // Check if number of outages changed
  if (current.outages.length !== previous.outages.length) return true;

  // Check each outage for changes (id, startAt, stopAt)
  for (const currentOutage of current.outages) {
    const previousOutage = previous.outages.find(
      (o) => o.id === currentOutage.id
    );

    // New outage appeared
    if (!previousOutage) return true;

    // Check if times changed
    if (currentOutage.startAt !== previousOutage.startAt) return true;
    if (currentOutage.stopAt !== previousOutage.stopAt) return true;
  }

  // Check if any previous outage was removed
  for (const previousOutage of previous.outages) {
    const stillExists = current.outages.find((o) => o.id === previousOutage.id);
    if (!stillExists) return true;
  }

  return false;
}

async function checkPowerOutage(): Promise<{
  statusChanged: boolean;
  currentStatus: Awaited<ReturnType<typeof getOutageStatus>>;
  previousStatus: StoredStatus | null;
}> {
  console.log("Checking power outage status...");

  // Fetch current status
  const currentStatus = await getOutageStatus(LOCATION);
  console.log("Current status:", JSON.stringify(currentStatus, null, 2));

  // Get previous status from Redis
  const previousStatus = await getLastStatus();
  console.log("Previous status:", JSON.stringify(previousStatus, null, 2));

  // Check if status changed
  const statusChanged = hasStatusChanged(currentStatus, previousStatus);
  console.log("Status changed:", statusChanged);

  if (statusChanged) {
    // Call webhook
    await callWebhook();
  }

  // Save current status to Redis
  const newStoredStatus: StoredStatus = {
    hasOutage: currentStatus.hasOutage,
    outages: currentStatus.outages.map((o) => ({
      id: o.id,
      startAt: o.startAt,
      stopAt: o.stopAt,
    })),
    lastChecked: new Date().toISOString(),
  };
  await saveStatus(newStoredStatus);

  return { statusChanged, currentStatus, previousStatus };
}

try {
  const result = await checkPowerOutage();

  console.log("Check complete:", {
    statusChanged: result.statusChanged,
    hasOutage: result.currentStatus.hasOutage,
    outageCount: result.currentStatus.outages.length,
  });

  await redis.quit();
  process.exit(0);
} catch (error) {
  console.error("Error checking power outage:", error);
  await redis.quit();
  process.exit(1);
}
