/**
 * Simple offline queue using localStorage
 * More reliable than IndexedDB on mobile PWAs
 */

export interface QueueItem {
  id: string;
  type: "capture" | "note" | "task" | "reminder";
  operation: "create" | "update" | "delete";
  data: Record<string, unknown>;
  createdAt: string;
  retries: number;
}

const QUEUE_KEY = "offlineQueue";
const MAX_RETRIES = 3;

/**
 * Generate a simple unique ID
 */
export function generateId(): string {
  return `temp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Get all pending items from the queue
 */
export function getQueue(): QueueItem[] {
  try {
    const data = localStorage.getItem(QUEUE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

/**
 * Add an item to the queue
 */
export function addToQueue(item: Omit<QueueItem, "id" | "createdAt" | "retries">): QueueItem {
  const queue = getQueue();
  const newItem: QueueItem = {
    ...item,
    id: generateId(),
    createdAt: new Date().toISOString(),
    retries: 0,
  };
  queue.push(newItem);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  return newItem;
}

/**
 * Remove an item from the queue
 */
export function removeFromQueue(id: string): void {
  const queue = getQueue().filter((item) => item.id !== id);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

/**
 * Update retry count for an item
 */
export function incrementRetry(id: string): void {
  const queue = getQueue().map((item) =>
    item.id === id ? { ...item, retries: item.retries + 1 } : item
  );
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

/**
 * Get queue length
 */
export function getQueueLength(): number {
  return getQueue().length;
}

/**
 * Process a single queue item - send to server
 */
async function processItem(item: QueueItem): Promise<boolean> {
  const endpoints: Record<string, string> = {
    capture: "/api/captures",
    note: "/api/notes",
    task: "/api/tasks",
    reminder: "/api/reminders",
  };

  const endpoint = endpoints[item.type];
  if (!endpoint) return false;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    let response: Response;

    if (item.operation === "create") {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item.data),
        signal: controller.signal,
      });
    } else if (item.operation === "update") {
      response = await fetch(`${endpoint}/${item.data.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item.data),
        signal: controller.signal,
      });
    } else if (item.operation === "delete") {
      response = await fetch(`${endpoint}/${item.data.id}`, {
        method: "DELETE",
        signal: controller.signal,
      });
    } else {
      return false;
    }

    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    clearTimeout(timeoutId);
    return false;
  }
}

/**
 * Process all items in the queue
 * Returns number of successfully synced items
 */
export async function processQueue(): Promise<{ synced: number; failed: number }> {
  if (!navigator.onLine) {
    return { synced: 0, failed: 0 };
  }

  const queue = getQueue();
  let synced = 0;
  let failed = 0;

  for (const item of queue) {
    const success = await processItem(item);

    if (success) {
      removeFromQueue(item.id);
      synced++;
    } else {
      incrementRetry(item.id);
      if (item.retries >= MAX_RETRIES) {
        // Remove after max retries
        removeFromQueue(item.id);
      }
      failed++;
    }
  }

  return { synced, failed };
}

/**
 * Set up automatic sync when coming online
 */
export function setupAutoSync(onSync?: (result: { synced: number; failed: number }) => void): () => void {
  const handleOnline = async () => {
    const result = await processQueue();
    onSync?.(result);
  };

  window.addEventListener("online", handleOnline);

  // Also try to sync on initial load if online
  if (navigator.onLine && getQueueLength() > 0) {
    processQueue().then(onSync);
  }

  return () => {
    window.removeEventListener("online", handleOnline);
  };
}
