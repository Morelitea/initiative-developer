/**
 * What each community's installation holds, kept in memory.
 *
 * Nothing here is stored by this app. The organization's GitHub installation
 * lives in the installation's configuration (the `workspace` connection) and
 * each member's GitHub authorization lives in their `account` connection, both
 * in Initiative's custody. This is a short-lived copy of the last answer, so a
 * widget does not cost a configuration read, and so the tokens of a member who
 * disconnects, or of an install that goes away, are still known long enough to
 * end their authorization at GitHub.
 */

import type { InitiativeAuth, InstallationConfig } from "initiative-app-kit";

import { ACCOUNT, WORKSPACE } from "./vocabulary.js";

/** How long a configuration answer is reused before it is read again. */
export const CONFIG_TTL_MS = 60_000;

export interface Workspace {
  owner: string;
  installationId: number;
}

export interface MemberCredential {
  connectionRef: string;
  accessToken: string;
  refreshToken: string | null;
  /** Milliseconds since the epoch, or null when the token does not expire. */
  expiresAt: number | null;
  refreshExpiresAt: number | null;
}

export interface InstallSnapshot {
  installation: string;
  workspace: Workspace | null;
  members: Map<string, MemberCredential>;
  configState: string;
  configStateDetail: string | null;
  readAt: number;
}

export interface InstallRegistryOptions {
  auth: InitiativeAuth;
  now: () => number;
  /** A member credential Initiative no longer holds: its authorization should end. */
  onMemberGone: (installation: string, credential: MemberCredential) => void;
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
        const previous = this.snapshots.get(installation);
        this.snapshots.set(installation, next);
        if (previous) {
          for (const [ref, credential] of previous.members) {
            if (!next.members.has(ref)) this.options.onMemberGone(installation, credential);
          }
        }
        return next;
      } finally {
        this.reading.delete(installation);
      }
    })();
    this.reading.set(installation, request);
    return request;
  }

  /** Every installation this process has a snapshot of. */
  known(): string[] {
    return [...this.snapshots.keys()];
  }

  peek(installation: string): InstallSnapshot | undefined {
    return this.snapshots.get(installation);
  }

  /** The installations bound to one GitHub installation, as last read. */
  boundTo(githubInstallationId: number): string[] {
    return [...this.snapshots.values()]
      .filter((snapshot) => snapshot.workspace?.installationId === githubInstallationId)
      .map((snapshot) => snapshot.installation);
  }

  /** Replace one member's credential after this app renewed or wrote it. */
  setMember(installation: string, credential: MemberCredential): void {
    this.snapshots.get(installation)?.members.set(credential.connectionRef, credential);
  }

  /** Drop one member's credential without treating it as gone from Initiative. */
  dropMember(installation: string, connectionRef: string): void {
    this.snapshots.get(installation)?.members.delete(connectionRef);
  }

  /** Forget an installation entirely, handing back what was last known of it. */
  forget(installation: string): InstallSnapshot | undefined {
    const held = this.snapshots.get(installation);
    this.snapshots.delete(installation);
    return held;
  }
}

export function snapshotOf(
  installation: string,
  config: InstallationConfig,
  now: number
): InstallSnapshot {
  const members = new Map<string, MemberCredential>();
  for (const member of config.memberConnections) {
    if (member.connectionId !== ACCOUNT) continue;
    const credential = credentialOf(member.connectionRef, member.values);
    if (credential) members.set(member.connectionRef, credential);
  }
  return {
    installation,
    workspace: workspaceOf(config.connections[WORKSPACE]),
    members,
    configState: config.configState,
    configStateDetail: config.configStateDetail,
    readAt: now,
  };
}

function workspaceOf(values: Record<string, unknown> | undefined): Workspace | null {
  if (!values) return null;
  const owner = values.owner;
  const installationId = Number(values.installation_id);
  if (typeof owner !== "string" || !owner || !Number.isSafeInteger(installationId) || installationId <= 0) {
    return null;
  }
  return { owner, installationId };
}

/** The values the connect flow writes, read back. Times are stored as epoch seconds. */
export function credentialOf(
  connectionRef: string,
  values: Record<string, unknown>
): MemberCredential | null {
  const accessToken = values.access_token;
  if (typeof accessToken !== "string" || !accessToken) return null;
  const refreshToken = values.refresh_token;
  return {
    connectionRef,
    accessToken,
    refreshToken: typeof refreshToken === "string" && refreshToken ? refreshToken : null,
    expiresAt: millis(values.expires_at),
    refreshExpiresAt: millis(values.refresh_expires_at),
  };
}

/** What the connect flow writes for a credential: epoch seconds for the times. */
export function valuesOf(credential: Omit<MemberCredential, "connectionRef">): Record<string, unknown> {
  return {
    access_token: credential.accessToken,
    refresh_token: credential.refreshToken,
    expires_at: seconds(credential.expiresAt),
    refresh_expires_at: seconds(credential.refreshExpiresAt),
  };
}

/** Every value the connect flow writes, cleared. */
export const CLEARED_VALUES: Record<string, null> = {
  access_token: null,
  refresh_token: null,
  expires_at: null,
  refresh_expires_at: null,
};

function millis(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0 ? parsed * 1000 : null;
}

function seconds(value: number | null): number | null {
  return value === null ? null : Math.floor(value / 1000);
}
