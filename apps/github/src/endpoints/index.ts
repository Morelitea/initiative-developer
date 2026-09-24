/**
 * Every endpoint the app declares. The manifest reads its declarations from
 * these lists and the invoke route its handlers, so the two cannot disagree.
 */

import type { Endpoint } from "initiative-app-kit";

import { EMIT_ENDPOINTS } from "./emissions.js";
import {
  closeIssue,
  comment,
  findIssues,
  getIssue,
  label,
  listLabels,
  openIssue,
  reopenIssue,
} from "./issues.js";
import {
  findProjectItem,
  listProjectFields,
  listProjectOptions,
  listProjects,
  moveProjectItem,
} from "./projects.js";
import { findPullRequests, getPullRequest, requestReview } from "./pulls.js";
import { listRepositories } from "./repositories.js";
import { listAlerts } from "./security.js";
import type { Read, Write } from "./support.js";

export const READS: readonly Read[] = [
  listRepositories,
  listLabels,
  getIssue,
  findIssues,
  getPullRequest,
  findPullRequests,
  listAlerts,
  listProjects,
  listProjectFields,
  listProjectOptions,
  findProjectItem,
];

export const WRITES: readonly Write[] = [
  openIssue,
  comment,
  closeIssue,
  reopenIssue,
  label,
  requestReview,
  moveProjectItem,
];

export const ENDPOINTS: readonly Endpoint[] = [
  ...READS.map((read) => read.declaration),
  ...WRITES.map((write) => write.declaration),
  ...EMIT_ENDPOINTS,
];

export const READ_HANDLERS = new Map(READS.map((read) => [read.declaration.id, read]));
export const WRITE_HANDLERS = new Map(WRITES.map((write) => [write.declaration.id, write]));
