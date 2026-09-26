/**
 * What each community's installation holds, kept in memory.
 *
 * Nothing here is stored by this app. The organization's GitHub installation
 * lives in the installation's configuration in Initiative (the `workspace`
 * connection), and Initiative holds every token. This is a short-lived copy
 * of the last configuration answer, so a widget does not cost a
 * configuration read.
 */

import type { InitiativeAuth, InstallationConfig } from "initiative-app-kit";

import { WORKSPACE } from "./vocabulary.js";

/** How long a configuration answer is reused before it is read again. */
export const CONFIG_TTL_MS = 60_000;

export interface Workspace {
  owner: string;
  installationId: number;
  /** The community connection's handle, which its installation token is asked for by. */
  ref: string;
}

export interface InstallSnapshot {
  installation: string;
  workspace: Workspace | null;
  configState: string;
  configStateDetail: string | null;
  readAt: number;
}

export interface InstallRegistryOptions {
  auth: InitiativeAuth;
  now: () => number;
}

export class InstallRegistry {
  private readonly snapshots = new Map<string, InstallSnapshot>();
  private readonly reading = new Map<string, Promise<InstallSnapshot>>();

  constructor(private readonly options: InstallRegistryOptions) {}

  /** The installation's configuration, from memory when it is fresh enough. */
  async snapshot(installation: string): Promise<InstallSnapshot> {
    const held = this.snapshots.get(installation);
    if (held && held.readAt > this.options.now() - CONFIG_TTL_MS) return held;
    return this.refresh(installation);
  }

  /** Read the installation's configuration again, whatever is in memory. */
  refresh(installation: string): Promise<InstallSnapshot> {
    const pending = this.reading.get(installation);
    if (pending) return pending;
    const request = (async () => {
      try {
        const config = await this.options.auth.installationConfig(installation);
        const next = snapshotOf(installation, config, this.options.now());
        this.snapshots.set(installation, next);
        return next;
      } finally {
        this.reading.delete(installation);
      }
    })();
    this.reading.set(installation, request);
    return request;
  }
}

export function snapshotOf(
  installation: string,
  config: InstallationConfig,
  now: number
): InstallSnapshot {
  return {
    installation,
    workspace: workspaceOf(config.connections[WORKSPACE], config.connectionRefs[WORKSPACE]),
    configState: config.configState,
    configStateDetail: config.configStateDetail,
    readAt: now,
  };
}

function workspaceOf(values: Record<string, unknown> | undefined, ref: string | undefined): Workspace | null {
  if (!values || !ref) return null;
  const owner = values.owner;
  const installationId = Number(values.installation_id);
  if (typeof owner !== "string" || !owner || !Number.isSafeInteger(installationId) || installationId <= 0) {
    return null;
  }
  return { owner, installationId, ref };
}
