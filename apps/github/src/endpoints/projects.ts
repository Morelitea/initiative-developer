import { defineEndpoint } from "initiative-app-sdk/manifest";

import {
  BOARD,
  COUNT_OUT,
  FIELDS_OF,
  many,
  NUMBER,
  NUMBER_OUT,
  out,
  OWNER_OUT,
  param,
  READ,
  REPO,
  REPO_OUT,
  text,
  TOTAL_OUT,
  UNAVAILABLE,
  ACCOUNT,
} from "../vocabulary.js";
import {
  GITHUB_ERRORS,
  graphql,
  needs,
  NEEDS_FIELD,
  NEEDS_NUMBER,
  NEEDS_PROJECT,
  NEEDS_REPO,
  PAGE,
  PUBLIC_READ,
  PUBLIC_WRITE,
  REPO_VARIABLES,
} from "./support.js";

const CARD = text("Card", "Karte", "Tarjeta", "Carte");

export const listProjects = defineEndpoint({
  direction: "read",
  label: text("Project boards", "Projektboards", "Tableros de proyecto", "Tableaux de projet"),
  description: text(
    "The Projects boards on the installation's account.",
    "Die Projects-Boards des Kontos der Installation.",
    "Los tableros de Projects de la cuenta de la instalación.",
    "Les tableaux Projects du compte de l'installation."
  ),
  group: "projects",
  ...PUBLIC_READ,
  cache_ttl_seconds: 300,
  returns: {
    ids: many(out("string", { label: text("Boards", "Boards", "Tableros", "Tableaux") })),
    titles: many(out("string")),
    numbers: many(out("int")),
    urls: many(out("url")),
    ...COUNT_OUT,
    ...TOTAL_OUT,
    ...UNAVAILABLE,
  },
  request: graphql(
    `query Boards($login: String!, $first: Int!) {
       repositoryOwner(login: $login) {
         ... on Organization { projectsV2(first: $first) { totalCount nodes { id title number url } } }
         ... on User { projectsV2(first: $first) { totalCount nodes { id title number url } } }
       }
     }`,
    `{"login": connections.workspace.owner, "first": ${PAGE}}`
  ),
  errors: GITHUB_ERRORS,
  map: `(
    $found := response.body.data.repositoryOwner.projectsV2;
    $boards := $found.nodes[$type(id) = "string"];
    $found ? {
      "ids": [$boards.id],
      "titles": [$boards.(title ? title : "")],
      "numbers": [$boards.(number ? number : 0)],
      "urls": [$boards.(url ? url : "")],
      "count": $count($boards),
      "total": $found.totalCount
    } : {"unavailable": "not-found"}
  )`,
});

/**
 * One board's single-select fields. A board id names a board anywhere on
 * GitHub, so it must belong to the organization's own account.
 */
const BOARD_FIELDS = graphql(
  `query Fields($project: ID!, $first: Int!) {
     node(id: $project) {
       ... on ProjectV2 {
         owner { ... on Organization { login } ... on User { login } }
         fields(first: $first) { nodes { ... on ProjectV2SingleSelectField { id name options { id name } } } }
       }
     }
   }`,
  `{"project": params.project_id, "first": ${PAGE}}`
);

/** The board's single-select fields as `$fields`, then `answer`, or why the board cannot be read. */
function onBoard(answer: string): string {
  return `(
    $board := response.body.data.node;
    $fields := $board.fields.nodes[$type(id) = "string"];
    $owned := $type($board.owner.login) = "string" and $lowercase($board.owner.login) = $lowercase(connections.workspace.owner);
    $board.fields ? ($owned ? ${answer} : {"unavailable": "project-not-listed"}) : {"unavailable": "no-such-project"}
  )`;
}

const BOARD_CODES = ["no-such-project", "project-not-listed"];

export const listProjectFields = defineEndpoint({
  direction: "read",
  label: text("Project fields", "Projektfelder", "Campos de proyecto", "Champs de projet"),
  description: text(
    "The single-select fields one board has: its columns, and anything else set that way.",
    "Die Einfachauswahl-Felder eines Boards: seine Spalten und alles andere dieser Art.",
    "Los campos de selección única de un tablero: sus columnas y cualquier otro similar.",
    "Les champs à choix unique d'un tableau : ses colonnes, et tout autre du même type."
  ),
  group: "projects",
  ...PUBLIC_READ,
  cache_ttl_seconds: 300,
  params: { ...BOARD },
  returns: {
    ids: many(out("string", { label: text("Fields", "Felder", "Campos", "Champs") })),
    names: many(out("string", { label: text("Field names", "Feldnamen", "Nombres de campos", "Noms des champs") })),
    ...COUNT_OUT,
    ...UNAVAILABLE,
  },
  request: BOARD_FIELDS,
  ...withCodes(needs(NEEDS_PROJECT), BOARD_CODES),
  map: onBoard(`{"ids": [$fields.id], "names": [$fields.(name ? name : "")], "count": $count($fields)}`),
});

export const listProjectOptions = defineEndpoint({
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
  ...PUBLIC_READ,
  cache_ttl_seconds: 300,
  params: { ...BOARD, field: param("string", text("Field", "Feld", "Campo", "Champ"), { options_from: FIELDS_OF }) },
  returns: {
    field_id: out("string"),
    field_name: out("string"),
    option_ids: many(out("string", { label: text("Values", "Werte", "Valores", "Valeurs") })),
    option_names: many(out("string", { label: text("Value names", "Wertnamen", "Nombres de valores", "Noms des valeurs") })),
    ...UNAVAILABLE,
  },
  request: BOARD_FIELDS,
  ...withCodes(needs(NEEDS_FIELD, NEEDS_PROJECT), [...BOARD_CODES, "no-such-field"]),
  // By id, or by the name somebody typed.
  map: onBoard(`(
    $wanted := params.field;
    $field := $fields[id = $wanted or $lowercase(name) = $lowercase($wanted)][0];
    $options := $field.options[$type(id) = "string"];
    $field ? {
      "field_id": $field.id,
      "field_name": $field.name ? $field.name : "",
      "option_ids": [$options.id],
      "option_names": [$options.(name ? name : "")]
    } : {"unavailable": "no-such-field"}
  )`),
});

export const findProjectItem = defineEndpoint({
  direction: "read",
  label: text("Find a project card", "Projektkarte finden", "Encontrar una tarjeta de proyecto", "Trouver une carte de projet"),
  description: text(
    "The card an issue or pull request has on a board.",
    "Die Karte, die ein Issue oder Pull Request auf einem Board hat.",
    "La tarjeta que una incidencia o pull request tiene en un tablero.",
    "La carte qu'un ticket ou une pull request a sur un tableau."
  ),
  group: "projects",
  ...PUBLIC_READ,
  cache_ttl_seconds: 0,
  params: { ...BOARD, ...REPO, ...NUMBER },
  returns: { item_id: out("string", { label: CARD }), ...REPO_OUT, ...OWNER_OUT, ...NUMBER_OUT, ...UNAVAILABLE },
  request: graphql(
    `query Card($owner: String!, $repo: String!, $number: Int!, $first: Int!) {
       repository(owner: $owner, name: $repo) {
         name
         owner { login }
         issueOrPullRequest(number: $number) {
           ... on Issue { projectItems(first: $first) { nodes { id project { id } } } }
           ... on PullRequest { projectItems(first: $first) { nodes { id project { id } } } }
         }
       }
     }`,
    `{${REPO_VARIABLES}, "number": params.number, "first": ${PAGE}}`
  ),
  ...withCodes(needs(NEEDS_REPO, NEEDS_PROJECT, NEEDS_NUMBER), ["not-on-that-board"]),
  map: `(
    $repository := response.body.data.repository;
    $item := $repository.issueOrPullRequest;
    $wanted := params.project_id;
    $card := $item.projectItems.nodes[$type(id) = "string" and project.id = $wanted][0];
    $item ? (
      $card ? {"item_id": $card.id, "repository": $repository.name, "owner": $repository.owner.login, "number": params.number}
      : {"unavailable": "not-on-that-board"}
    ) : {"unavailable": "not-found"}
  )`,
});

// A board belongs to an organization or to a repository, and either
// permission reaches it.
export const moveProjectItem = defineEndpoint({
  direction: "write",
  label: text("Move a project card", "Projektkarte verschieben", "Mover una tarjeta de proyecto", "Déplacer une carte de projet"),
  description: text(
    "Sets one single-select field on a Projects card, as the member.",
    "Setzt ein Einfachauswahl-Feld auf einer Projects-Karte, als das Mitglied.",
    "Establece un campo de selección única en una tarjeta de Projects, como el miembro.",
    "Définit un champ à choix unique sur une carte Projects, en tant que le membre."
  ),
  group: "projects",
  ...PUBLIC_WRITE,
  params: {
    ...BOARD,
    item_id: param("string", CARD),
    field_id: param("string", text("Field", "Feld", "Campo", "Champ"), { options_from: FIELDS_OF }),
    option_id: param("string", text("Value", "Wert", "Valor", "Valeur"), {
      options_from: {
        endpoint: READ.listProjectOptions,
        key: "option_ids",
        label_key: "option_names",
        needs: { project_id: "project_id", field: "field_id" },
      },
    }),
  },
  returns: { item_id: out("string", { label: CARD }) },
  identity: { kind: "project_card", key: ["item_id"] },
  request: graphql(
    `mutation Move($project: ID!, $item: ID!, $field: ID!, $option: String!) {
       updateProjectV2ItemFieldValue(input: {
         projectId: $project, itemId: $item, fieldId: $field,
         value: { singleSelectOptionId: $option }
       }) { projectV2Item { id } }
     }`,
    `{"project": params.project_id, "item": params.item_id, "field": params.field_id, "option": params.option_id}`,
    ACCOUNT
  ),
  errors: GITHUB_ERRORS,
  map: `(
    $moved := response.body.data.updateProjectV2ItemFieldValue.projectV2Item.id;
    {"item_id": $moved ? $moved : params.item_id}
  )`,
});

/** A read's refusals, with the codes its map answers besides. */
function withCodes(refusals: ReturnType<typeof needs>, codes: string[]): ReturnType<typeof needs> {
  return { ...refusals, unavailable: [...refusals.unavailable, ...codes] };
}
