import { QueueBusyError } from '../errors.js';

/**
 * ADR 0027: Serial Automation Queue per Connection.
 *
 * Strictly 1 automated job processed at a time per messaging connection.
 * Guarantees that concurrent dispatch attempts on the same connection
 * are strictly serialized and cannot interleave.
 */
export class SerialAutomationQueue {
  private readonly queues = new Map<string, Promise<void>>();
  private readonly activeJobs = new Set<string>();

  /**
   * Checks if an automated job is currently being processed on the connection.
   */
  isProcessing(connectionId: string): boolean {
    return this.activeJobs.has(connectionId);
  }

  /**
   * Executes a task with exclusive serialization on the given connection (ADR 0027).
   * Ensures that exactly 1 automated message job executes at any given moment per connection.
   */
  async runExclusive<T>(connectionId: string, task: () => Promise<T>): Promise<T> {
    const currentQueue = this.queues.get(connectionId) ?? Promise.resolve();

    let releaseLock!: () => void;
    const nextPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    // Chain this operation onto the connection's serial queue
    this.queues.set(connectionId, nextPromise);

    await currentQueue;
    this.activeJobs.add(connectionId);

    try {
      return await task();
    } finally {
      this.activeJobs.delete(connectionId);
      releaseLock();
      if (this.queues.get(connectionId) === nextPromise) {
        this.queues.delete(connectionId);
      }
    }
  }

  /**
   * Clears the queue for a connection (e.g. on cancel or test reset).
   */
  clear(connectionId?: string): void {
    if (connectionId) {
      this.queues.delete(connectionId);
      this.activeJobs.delete(connectionId);
    } else {
      this.queues.clear();
      this.activeJobs.clear();
    }
  }
}
