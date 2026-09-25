import { graphql } from "../github/http.js";
import {
  ACCOUNT,
  BOARD,
  COUNT_OUT,
  FIELDS_OF,
  many,
  NUMBER,
  NUMBER_OUT,
  out,
  OWNER_OUT,
  param,
  READ_IDS,
  REPO,
  REPO_OUT,
  text,
  TOTAL_OUT,
  UNAVAILABLE,
  WORKSPACE,
  WRITE_IDS,
} from "../vocabulary.js";
import {
  bad,
  installationAccess,
  int,
  isResult,
  nodes,
  PAGE,
  readFailure,
  repoAccess,
  text as textParam,
  unavailable,
  writeFailure,
  type Call,
  type Connection,
  type Read,
  type Unavailable,
  type Write,
} from "./support.js";

const CARD = text("Card", "Karte", "Tarjeta", "Carte");

interface Board {
  id?: string;
  title?: string;
  number?: number;
  url?: string;
}

export const listProjects: Read = {
  declaration: {
    id: READ_IDS.listProjects,
    direction: "read",
    label: text("Project boards", "Projektboards", "Tableros de proyecto", "Tableaux de projet"),
    description: text(
      "The Projects boards on the installation's account.",
      "Die Projects-Boards des Kontos der Installation.",
      "Los tableros de Projects de la cuenta de la instalación.",
      "Les tableaux Projects du compte de l'installation."
    ),
    group: "projects",
    actors: ["installation"],
    cache_ttl_seconds: 300,
    returns: [
      many(out("ids", "string", { label: text("Boards", "Boards", "Tableros", "Tableaux") })),
      many(out("titles", "string")),
      many(out("numbers", "int")),
      many(out("urls", "url")),
      COUNT_OUT,
      TOTAL_OUT,
      UNAVAILABLE,
    ],
    requires: { all_of: [WORKSPACE] },
  },

  async run(call) {
    const access = await installationAccess(call);
    if (isResult(access)) return { actor: "installation", result: access };
    const answer = await graphql<{ repositoryOwner: { projectsV2: Connection<Board> | null } | null }>(
      call.context.github.http,
      access.token,
      `query Boards($login: String!, $first: Int!) {
         repositoryOwner(login: $login) {
           ... on Organization { projectsV2(first: $first) { totalCount nodes { id title number url } } }
           ... on User { projectsV2(first: $first) { totalCount nodes { id title number url } } }
         }
       }`,
      { login: access.owner, first: PAGE }
    );
    if (!answer.ok) return { actor: "installation", result: readFailure(answer.failure) };
    const found = answer.body.repositoryOwner?.projectsV2;
    if (!found) return { actor: "installation", result: unavailable("not-found") };
    const boards = nodes(found).filter((board): board is Board & { id: string } => typeof board.id === "string");
    return {
      actor: "installation",
      result: {
        ids: boards.map((board) => board.id),
        titles: boards.map((board) => board.title ?? ""),
        numbers: boards.map((board) => board.number ?? 0),
        urls: boards.map((board) => board.url ?? ""),
        count: boards.length,
        total: found.totalCount ?? boards.length,
      },
    };
  },
};

interface Field {
  id: string;
  name?: string;
  options?: Array<{ id?: string; name?: string }>;
}

/**
 * One board's single-select fields. A board id names a board anywhere on
 * GitHub, so it must belong to the installation's own account.
 */
async function singleSelectFields(call: Call): Promise<{ fields: Field[] } | Unavailable> {
  const access = await installationAccess(call);
  if (isResult(access)) return access;
  const board = textParam(call.params, "project_id");
  if (!board) return unavailable("project-required");

  const answer = await graphql<{
    node: { owner?: { login?: string } | null; fields?: Connection<Partial<Field>> } | null;
  }>(
    call.context.github.http,
    access.token,
    `query Fields($project: ID!, $first: Int!) {
       node(id: $project) {
         ... on ProjectV2 {
           owner { ... on Organization { login } ... on User { login } }
           fields(first: $first) { nodes { ... on ProjectV2SingleSelectField { id name options { id name } } } }
         }
       }
     }`,
    { project: board, first: PAGE }
  );
  if (!answer.ok) return readFailure(answer.failure);
  const node = answer.body.node;
  if (!node?.fields) return unavailable("no-such-project");
  const owner = node.owner?.login;
  if (typeof owner !== "string" || owner.toLowerCase() !== access.owner.toLowerCase()) {
    return unavailable("project-not-listed");
  }
  return { fields: nodes(node.fields).filter((field): field is Field => typeof field.id === "string") };
}

export const listProjectFields: Read = {
  declaration: {
    id: READ_IDS.listProjectFields,
    direction: "read",
    label: text("Project fields", "Projektfelder", "Campos de proyecto", "Champs de projet"),
    description: text(
      "The single-select fields one board has: its columns, and anything else set that way.",
      "Die Einfachauswahl-Felder eines Boards: seine Spalten und alles andere dieser Art.",
      "Los campos de selección única de un tablero: sus columnas y cualquier otro similar.",
      "Les champs à choix unique d'un tableau : ses colonnes, et tout autre du même type."
    ),
    group: "projects",
    actors: ["installation"],
    cache_ttl_seconds: 300,
    params: [BOARD],
    returns: [
      many(out("ids", "string", { label: text("Fields", "Felder", "Campos", "Champs") })),
      many(out("names", "string", { label: text("Field names", "Feldnamen", "Nombres de campos", "Noms des champs") })),
      COUNT_OUT,
      UNAVAILABLE,
    ],
    requires: { all_of: [WORKSPACE] },
  },

  async run(call) {
    const found = await singleSelectFields(call);
    if (isResult(found)) return { actor: "installation", result: found };
    return {
      actor: "installation",
      result: {
        ids: found.fields.map((field) => field.id),
        names: found.fields.map((field) => field.name ?? ""),
        count: found.fields.length,
      },
    };
  },
};

export const listProjectOptions: Read = {
  declaration: {
    id: READ_IDS.listProjectOptions,
    direction: "read",
    label: text(
      "Project field values",
      "Werte eines Projektfelds",
      "Valores de un campo de proyecto",
      "Valeurs d'un champ de projet"
    ),
    description: text(
      "What one single-select field on a board can be set to.",
      "Worauf ein Einfachauswahl-Feld eines Boards gesetzt werden kann.",
      "A qué se puede establecer un campo de selección única de un tablero.",
      "Ce à quoi un champ à choix unique d'un tableau peut être défini."
    ),
    group: "projects",
    actors: ["installation"],
    cache_ttl_seconds: 300,
    params: [BOARD, param("field", "string", text("Field", "Feld", "Campo", "Champ"), { options_from: FIELDS_OF })],
    returns: [
      out("field_id", "string"),
      out("field_name", "string"),
      many(out("option_ids", "string", { label: text("Values", "Werte", "Valores", "Valeurs") })),
      many(out("option_names", "string", { label: text("Value names", "Wertnamen", "Nombres de valores", "Noms des valeurs") })),
      UNAVAILABLE,
    ],
    requires: { all_of: [WORKSPACE] },
  },

  async run(call) {
    const wanted = textParam(call.params, "field");
    if (!wanted) return { actor: "installation", result: unavailable("field-required") };
    const found = await singleSelectFields(call);
    if (isResult(found)) return { actor: "installation", result: found };
    // By id, or by the name somebody typed.
    const field = found.fields.find(
      (candidate) => candidate.id === wanted || (candidate.name ?? "").toLowerCase() === wanted.toLowerCase()
    );
    if (!field) return { actor: "installation", result: unavailable("no-such-field") };
    const options = (field.options ?? []).filter(
      (option): option is { id: string; name?: string } => typeof option.id === "string"
    );
    return {
      actor: "installation",
      result: {
        field_id: field.id,
        field_name: field.name ?? "",
        option_ids: options.map((option) => option.id),
        option_names: options.map((option) => option.name ?? ""),
      },
    };
  },
};

export const findProjectItem: Read = {
  declaration: {
    id: READ_IDS.findProjectItem,
    direction: "read",
    label: text("Find a project card", "Projektkarte finden", "Encontrar una tarjeta de proyecto", "Trouver une carte de projet"),
    description: text(
      "The card an issue or pull request has on a board.",
      "Die Karte, die ein Issue oder Pull Request auf einem Board hat.",
      "La tarjeta que una incidencia o pull request tiene en un tablero.",
      "La carte qu'un ticket ou une pull request a sur un tableau."
    ),
    group: "projects",
    actors: ["installation"],
    cache_ttl_seconds: 0,
    params: [BOARD, REPO, NUMBER],
    returns: [out("item_id", "string", { label: CARD }), REPO_OUT, OWNER_OUT, NUMBER_OUT, UNAVAILABLE],
    requires: { all_of: [WORKSPACE] },
  },

  async run(call) {
    const access = await repoAccess(call);
    if (isResult(access)) return { actor: "installation", result: access };
    const board = textParam(call.params, "project_id");
    if (!board) return { actor: "installation", result: unavailable("project-required") };
    const number = int(call.params, "number");
    if (number === undefined) return { actor: "installation", result: unavailable("number-required") };

    const cards = "projectItems(first: $first) { nodes { id project { id } } }";
    const answer = await graphql<{
      repository: {
        issueOrPullRequest: { projectItems?: Connection<{ id?: string; project?: { id?: string } }> } | null;
      } | null;
    }>(
      call.context.github.http,
      access.token,
      `query Card($owner: String!, $repo: String!, $number: Int!, $first: Int!) {
         repository(owner: $owner, name: $repo) {
           issueOrPullRequest(number: $number) {
             ... on Issue { ${cards} }
             ... on PullRequest { ${cards} }
           }
         }
       }`,
      { owner: access.owner, repo: access.repo, number, first: PAGE }
    );
    if (!answer.ok) return { actor: "installation", result: readFailure(answer.failure) };
    const item = answer.body.repository?.issueOrPullRequest;
    if (!item) return { actor: "installation", result: unavailable("not-found") };
    const card = nodes(item.projectItems).find((one) => typeof one.id === "string" && one.project?.id === board);
    if (!card) return { actor: "installation", result: unavailable("not-on-that-board") };
    return {
      actor: "installation",
      result: { item_id: card.id, repository: access.repo, owner: access.owner, number },
    };
  },
};

export const moveProjectItem: Write = {
  // A board belongs to an organization or to a repository, and either
  // permission reaches it.
  declaration: {
    id: WRITE_IDS.moveProjectItem,
    direction: "write",
    label: text("Move a project card", "Projektkarte verschieben", "Mover una tarjeta de proyecto", "Déplacer une carte de projet"),
    description: text(
      "Sets one single-select field on a Projects card, as the member.",
      "Setzt ein Einfachauswahl-Feld auf einer Projects-Karte, als das Mitglied.",
      "Establece un campo de selección única en una tarjeta de Projects, como el miembro.",
      "Définit un champ à choix unique sur une carte Projects, en tant que le membre."
    ),
    group: "projects",
    actors: ["member"],
    requires: { all_of: [WORKSPACE, ACCOUNT] },
    params: [
      BOARD,
      param("item_id", "string", CARD),
      param("field_id", "string", text("Field", "Feld", "Campo", "Champ"), { options_from: FIELDS_OF }),
      param("option_id", "string", text("Value", "Wert", "Valor", "Valeur"), {
        options_from: {
          endpoint: READ_IDS.listProjectOptions,
          key: "option_ids",
          label_key: "option_names",
          needs: { project_id: "project_id", field: "field_id" },
        },
      }),
    ],
    returns: [out("item_id", "string", { label: CARD })],
    identity: { kind: "project_card", key: ["item_id"] },
  },

  async run(call, token) {
    const project = textParam(call.params, "project_id");
    const item = textParam(call.params, "item_id");
    const field = textParam(call.params, "field_id");
    const option = textParam(call.params, "option_id");
    if (!project || !item || !field || !option) {
      return bad("project_id, item_id, field_id and option_id are all required");
    }
    const answer = await graphql<{ updateProjectV2ItemFieldValue?: { projectV2Item?: { id?: string } } }>(
      call.context.github.http,
      token,
      `mutation Move($project: ID!, $item: ID!, $field: ID!, $option: String!) {
         updateProjectV2ItemFieldValue(input: {
           projectId: $project, itemId: $item, fieldId: $field,
           value: { singleSelectOptionId: $option }
         }) { projectV2Item { id } }
       }`,
      { project, item, field, option }
    );
    if (!answer.ok) return writeFailure(answer.failure, answer.message);
    return { ok: true, result: { item_id: answer.body.updateProjectV2ItemFieldValue?.projectV2Item?.id ?? item } };
  },
};
