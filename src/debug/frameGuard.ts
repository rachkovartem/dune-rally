// src/debug/frameGuard.ts

export type SubsystemErrorReport = (subsystem: string, message: string) => void;

export interface FrameGuard {
  /** Runs one subsystem's frame work; a throw is reported and the rest of the frame goes on. */
  run(subsystem: string, work: () => void): void;
}

export function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * One broken subsystem must not stop the render loop. The same error repeats every frame, so it is
 * reported once, and again only when the message changes or it comes back after a clean frame.
 */
export function createFrameGuard(report: SubsystemErrorReport): FrameGuard {
  const lastMessage = new Map<string, string>();
  return {
    run(subsystem, work) {
      try {
        work();
        lastMessage.delete(subsystem);
      } catch (error) {
        const message = errorMessageOf(error);
        if (lastMessage.get(subsystem) === message) return;
        lastMessage.set(subsystem, message);
        report(subsystem, message);
      }
    },
  };
}
