/** GitHub's recorded answers and deliveries, by their path under `fixtures/`. */

import { readFileSync } from "node:fs";

export function recorded<T = any>(name: string): T {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf-8")) as T;
}
