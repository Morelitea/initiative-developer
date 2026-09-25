import { installationAccess, isResult, PUBLIC_READ, readFailure, type Read } from "./support.js";
import {
  COUNT_OUT,
  many,
  out,
  OWNER_OUT,
  READ_IDS,
  text,
  UNAVAILABLE,
  WORKSPACE,
} from "../vocabulary.js";

export const listRepositories: Read = {
  declaration: {
    id: READ_IDS.listRepositories,
    direction: "read",
    label: text("Repositories", "Repositories", "Repositorios", "Dépôts"),
    description: text(
      "The repositories the organization's installation covers.",
      "Die Repositories, die die Installation der Organisation umfasst.",
      "Los repositorios que cubre la instalación de la organización.",
      "Les dépôts couverts par l'installation de l'organisation."
    ),
    group: "repositories",
    ...PUBLIC_READ,
    cache_ttl_seconds: 300,
    returns: [
      many(out("names", "string", { label: text("Repositories", "Repositories", "Repositorios", "Dépôts") })),
      OWNER_OUT,
      COUNT_OUT,
      UNAVAILABLE,
    ],
    requires: { all_of: [WORKSPACE] },
  },

  async run(call) {
    const access = await installationAccess(call);
    if (isResult(access)) return { actor: "installation", result: access };
    const covered = await call.context.github.installationRepositories(call.installation, access);
    if ("failure" in covered) return { actor: "installation", result: readFailure(covered.failure) };
    return {
      actor: "installation",
      result: { names: covered.names, owner: access.owner, count: covered.names.length },
    };
  },
};
