/**
 * Browser trips this app started and expects back, held in memory.
 *
 * A trip to GitHub carries only a random `state`; what it was started for
 * (which installation, which connection, where to send the person back) stays
 * here, and is spent when the trip returns. A process restart forgets trips in
 * flight, and the person starts again from Initiative.
 *
 * The same store remembers the connect returns already used, so each is taken
 * once.
 */

/** How long a trip may take. Long enough to read GitHub's pages. */
export const FLOW_TTL_MS = 10 * 60_000;

export type FlowKind = "connect" | "install" | "verify";

export interface Flow {
  kind: FlowKind;
  /** The installation reference (the community, as this app's install knows it). */
  installation: string;
  connectionRef: string;
  /** Initiative's page to send the person back to, with an outcome added. */
  returnUrl: string;
  /** The PKCE verifier sent with an authorization, when one went out. */
  verifier?: string;
  /** The GitHub installation the admin came back with, until it is confirmed. */
  claimedInstallation?: number;
  expiresAt: number;
}

export class FlowStore {
  private readonly flows = new Map<string, Flow>();
  private readonly used = new Map<string, number>();

  constructor(private readonly now: () => number) {}

  begin(state: string, flow: Omit<Flow, "expiresAt">): void {
    this.sweep();
    this.flows.set(state, { ...flow, expiresAt: this.now() + FLOW_TTL_MS });
  }

  /** Spend the trip this state names, or null when there is none of that kind. */
  take(state: string | null, kind: FlowKind): Flow | null {
    if (!state) return null;
    const flow = this.flows.get(state);
    this.flows.delete(state);
    if (!flow || flow.kind !== kind || flow.expiresAt <= this.now()) return null;
    return flow;
  }

  /**
   * Record a token id until past its expiry and the verifier's leeway; false
   * when it was already recorded.
   */
  burn(jti: string, expiresAtSeconds: number): boolean {
    this.sweep();
    if (this.used.has(jti)) return false;
    this.used.set(jti, expiresAtSeconds * 1000 + 60_000);
    return true;
  }

  private sweep(): void {
    const now = this.now();
    for (const [state, flow] of this.flows) if (flow.expiresAt <= now) this.flows.delete(state);
    for (const [jti, until] of this.used) if (until <= now) this.used.delete(jti);
  }
}
