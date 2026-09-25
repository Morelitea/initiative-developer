/**
 * The periodic installations sync.
 *
 * Each pass lists the communities that have the app installed, reads each
 * one's configuration, checks that its GitHub installation still exists, and
 * reports the verdict to its admins when it changes.
 *
 * An installation listed as inactive is paused (the app switched off, or its
 * community on hold): it is left as it is and not read until it is active
 * again. An installation Initiative stops listing is forgotten. Ending the
 * members' GitHub authorizations is Initiative's: it holds them, and asks the
 * app's revoke hook to end each one.
 */

import { track, type AppContext } from "./context.js";
import type { InstallSnapshot } from "./installs.js";

/**
 * Passes in a row on which Initiative could get no token for an installation
 * before it is reported as unavailable. One such pass may be GitHub having a
 * bad minute.
 */
export const UNAVAILABLE_PASSES = 2;

/** The details this app reports an installation as invalid with. */
export const DETAILS = {
  removed: "github_installation_removed",
  suspended: "github_installation_suspended",
  unavailable: "github_installation_unavailable",
} as const;

export interface SyncReport {
  listed: number;
  removed: string[];
}

type Verdict = { state: "ok" } | { state: "invalid"; detail: string };

export class InstallationSync {
  private readonly unavailable = new Map<string, number>();
  /** Whether a pass has completed, for readiness. */
  ready = false;

  constructor(private readonly context: AppContext) {}

  async run(): Promise<SyncReport | null> {
    const { context } = this;
    let listed;
    try {
      listed = await context.auth.listInstallations();
    } catch (error) {
      // Not an answer about any installation, so nothing is forgotten.
      context.log.error("could not list installations", error);
      return null;
    }

    const live = new Set(listed.map((entry) => entry.installation));
    for (const { installation, active } of listed) {
      if (!active) continue;
      try {
        const snapshot = await context.installs.refresh(installation);
        await this.check(snapshot);
      } catch (error) {
        context.log.error(`could not sync ${installation}`, error);
      }
    }

    const removed: string[] = [];
    for (const installation of context.installs.known()) {
      if (live.has(installation)) continue;
      context.installs.forget(installation);
      context.github.forgetInstallation(installation);
      this.unavailable.delete(installation);
      removed.push(installation);
    }

    this.ready = true;
    return { listed: live.size, removed };
  }

  /** Whether the community's GitHub installation still exists, reported when the verdict changes. */
  private async check(snapshot: InstallSnapshot): Promise<void> {
    const { context } = this;
    if (!snapshot.workspace) return;
    const lookup = await context.github.check(snapshot.installation, snapshot.workspace);
    if (lookup.state === "unknown") return;

    let verdict: Verdict;
    if (lookup.state === "unavailable") {
      const passes = (this.unavailable.get(snapshot.installation) ?? 0) + 1;
      this.unavailable.set(snapshot.installation, passes);
      // A removal or suspension already reported says more than this does.
      const known = Object.values(DETAILS) as string[];
      if (passes < UNAVAILABLE_PASSES || known.includes(snapshot.configStateDetail ?? "")) return;
      verdict = { state: "invalid", detail: DETAILS.unavailable };
    } else {
      this.unavailable.delete(snapshot.installation);
      verdict =
        lookup.state === "gone"
          ? { state: "invalid", detail: DETAILS.removed }
          : lookup.state === "suspended"
            ? { state: "invalid", detail: DETAILS.suspended }
            : { state: "ok" };
    }

    const detail = verdict.state === "invalid" ? verdict.detail : null;
    if (snapshot.configState === verdict.state && (snapshot.configStateDetail ?? null) === detail) return;
    track(
      context,
      context.auth.reportConfigStatus(snapshot.installation, verdict),
      `report the configuration of ${snapshot.installation}`
    );
  }
}

/** Run the sync now and then every interval, one pass at a time. */
export function schedule(sync: InstallationSync, intervalSeconds: number): () => void {
  let running = false;
  const pass = async () => {
    if (running) return;
    running = true;
    try {
      await sync.run();
    } finally {
      running = false;
    }
  };
  void pass();
  const timer = setInterval(() => void pass(), intervalSeconds * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
