/**
 * The periodic installations sync.
 *
 * Each pass lists the communities that have the app installed and reads each
 * one's configuration, which also notices members whose connection Initiative
 * no longer holds (their authorization at GitHub is ended as their snapshot is
 * replaced). It checks that each community's GitHub installation still exists
 * and reports the verdict to its admins.
 *
 * An installation Initiative stops listing, on two passes in a row, is gone:
 * every member's GitHub authorization under it is ended (the grant, so the
 * refresh token goes too) and everything cached for it is dropped. Only what
 * this process saw can be ended, so an installation removed while the app was
 * not running is not.
 */

import { track, type AppContext } from "./context.js";
import { revokeMember } from "./credentials.js";
import type { InstallSnapshot } from "./installs.js";

/** Passes an installation must be missing from before it is treated as gone. */
export const MISSING_PASSES = 2;

export interface SyncReport {
  listed: number;
  removed: string[];
  revoked: number;
}

export class InstallationSync {
  private readonly missing = new Map<string, number>();
  /** Whether a pass has completed, for readiness. */
  ready = false;

  constructor(private readonly context: AppContext) {}

  async run(): Promise<SyncReport | null> {
    const { context } = this;
    let listed;
    try {
      listed = await context.auth.listInstallations();
    } catch (error) {
      // Not an answer about any installation, so nothing is treated as gone.
      context.log.error("could not list installations", error);
      return null;
    }

    const live = new Set(listed.map((entry) => entry.installation));
    for (const installation of live) {
      this.missing.delete(installation);
      try {
        const snapshot = await context.installs.refresh(installation);
        await this.check(snapshot);
      } catch (error) {
        context.log.error(`could not sync ${installation}`, error);
      }
    }

    const removed: string[] = [];
    let revoked = 0;
    for (const installation of context.installs.known()) {
      if (live.has(installation)) continue;
      const passes = (this.missing.get(installation) ?? 0) + 1;
      if (passes < MISSING_PASSES) {
        this.missing.set(installation, passes);
        continue;
      }
      this.missing.delete(installation);
      revoked += await this.teardown(installation);
      removed.push(installation);
    }

    this.ready = true;
    return { listed: live.size, removed, revoked };
  }

  /** End every member's authorization under an installation that is gone, and forget it. */
  private async teardown(installation: string): Promise<number> {
    const { context } = this;
    const snapshot = context.installs.forget(installation);
    if (!snapshot) return 0;
    const results = await Promise.all(
      [...snapshot.members.values()].map((credential) => revokeMember(context, credential))
    );
    const githubInstallation = snapshot.workspace?.installationId;
    if (githubInstallation !== undefined && !context.installs.boundTo(githubInstallation).length) {
      context.github.forget(githubInstallation);
    }
    context.log.info(
      `installation ${installation} is gone: ended ${results.filter(Boolean).length} of ${results.length} member authorization(s)`
    );
    return results.filter(Boolean).length;
  }

  /** Whether the community's GitHub installation still exists, reported when the verdict changes. */
  private async check(snapshot: InstallSnapshot): Promise<void> {
    const { context } = this;
    if (!snapshot.workspace) return;
    const lookup = await context.github.installation(snapshot.workspace.installationId);
    if (lookup.state === "unknown") return;

    const verdict =
      lookup.state === "gone"
        ? { state: "invalid" as const, detail: "github_installation_removed" }
        : lookup.state === "suspended"
          ? { state: "invalid" as const, detail: "github_installation_suspended" }
          : { state: "ok" as const };
    if (lookup.state !== "present") context.github.forget(snapshot.workspace.installationId);

    const detail = "detail" in verdict ? verdict.detail : null;
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
