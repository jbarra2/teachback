/**
 * Keeps the project board's Status column in step with the repo (T40), so nobody moves cards by
 * hand. The lead's machine runs it about every 15 minutes, from a copy of main's version, never a
 * working tree (CONTRIBUTING, "Running the board sync"). No workflow holds a board token: any
 * change merged to main could read a secret stored in CI.
 *
 *   node scripts/board-sync.mjs [--dry-run]
 *
 * GITHUB_TOKEN reads the repo's issues. PROJECT_TOKEN reads the board and moves cards: a classic
 * token with only the `project` scope (the lead passes the same token as both). Such a token can
 * write to every project its account can, so the script checks that it's looking at this board's
 * Status field, with the options it knows, before it writes anything. `--dry-run` prints the
 * moves and writes nothing. Node built-ins only.
 */
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://api.github.com/graphql";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The one board this script may change: its Status field and that field's options (left to
 * right). The ids are pinned, not only the names: the board's "Auto-close issue" workflow watches
 * the Done option, so writing a renamed or swapped option could close open issues.
 */
export const BOARD = Object.freeze({
  repo: "jbarra2/teachback",
  projectId: "PVT_kwHOCMca8c4Bpadk",
  statusFieldId: "PVTSSF_lAHOCMca8c4Bpadkzhn2N34",
  statuses: Object.freeze([
    "Backlog",
    "Ready",
    "In progress",
    "In review",
    "Done",
  ]),
  /** The track labels a task issue carries (the roles in .github/team.json). */
  tracks: Object.freeze(["lead", "ai", "frontend"]),
  /** @type {Readonly<Record<string, string>>} */
  optionIds: Object.freeze({
    Backlog: "f75ad846",
    Ready: "61e4505c",
    "In progress": "47fc9ee4",
    "In review": "df73e18b",
    Done: "98236657",
  }),
});

/** GitHub matches owner and name without regard to case, so these comparisons don't either. */
const isThisRepo = (name) =>
  typeof name === "string" && name.toLowerCase() === BOARD.repo.toLowerCase();

/**
 * @typedef {object} PullRequestFacts
 * @property {number} number
 * @property {string} state OPEN, CLOSED or MERGED
 * @property {boolean} isDraft
 * @property {boolean} isCrossRepository true for a PR from a fork
 * @property {string} repository the repo the PR is in ("owner/name")
 * @property {string | null} author the author's login; null for a deleted account
 */

/**
 * @typedef {object} IssueFacts
 * @property {number} number
 * @property {string} state OPEN or CLOSED
 * @property {string[]} labels
 * @property {PullRequestFacts[]} pullRequests PRs that close the issue when they merge
 * @property {number} linkedBranches branches made with `gh issue develop`
 * @property {{ number: number, state: string }[]} blockedBy the issue's native "blocked by" list
 */

/**
 * The column an issue's card belongs in. The first rule that matches wins.
 * @param {IssueFacts} issue
 * @param {Set<string>} team the team's GitHub logins (.github/team.json)
 * @returns {string}
 */
export function statusFor(issue, team) {
  // The only way to Done. The board's "Auto-close issue" workflow closes whatever is moved there.
  if (issue.state === "CLOSED") return "Done";
  // Anyone can open a PR on a public repo and write "Closes #12" in it, so only open PRs from the
  // team, on this repo and not from a fork, count. Logins are unique without regard to case.
  const members = new Set([...team].map((login) => login.toLowerCase()));
  const prs = issue.pullRequests.filter(
    (pr) =>
      pr.state === "OPEN" &&
      isThisRepo(pr.repository) &&
      !pr.isCrossRepository &&
      pr.author !== null &&
      members.has(pr.author.toLowerCase()),
  );
  const labels = new Set(issue.labels);
  if (prs.some((pr) => !pr.isDraft) || labels.has("in-review"))
    return "In review";
  if (
    prs.some((pr) => pr.isDraft) ||
    labels.has("in-progress") ||
    issue.linkedBranches > 0
  )
    return "In progress";
  // Ready only for a task issue (it has a track label). Anyone can open an issue on a public repo,
  // and an outsider's report waits in Backlog until the team triages it.
  if (
    issue.labels.some((label) => BOARD.tracks.includes(label)) &&
    issue.blockedBy.every((blocker) => blocker.state === "CLOSED")
  )
    return "Ready";
  return "Backlog";
}

const ISSUES = `query ($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    issues(first: 100, after: $after, orderBy: { field: CREATED_AT, direction: ASC }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number
        state
        labels(first: 50) { nodes { name } pageInfo { hasNextPage } }
        blockedBy(first: 50) { nodes { number state } pageInfo { hasNextPage } }
        closedByPullRequestsReferences(first: 50, includeClosedPrs: false) {
          nodes { number state isDraft isCrossRepository repository { nameWithOwner } author { login } }
          pageInfo { hasNextPage }
        }
        linkedBranches(first: 1) { totalCount }
      }
    }
  }
}`;

const PROJECT = `query ($id: ID!, $after: String) {
  node(id: $id) {
    ... on ProjectV2 {
      id
      field(name: "Status") {
        ... on ProjectV2SingleSelectField { id options { id name } }
      }
      items(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          type
          content { ... on Issue { number repository { nameWithOwner } } }
          fieldValueByName(name: "Status") {
            ... on ProjectV2ItemFieldSingleSelectValue { name }
          }
        }
      }
    }
  }
}`;

const WRITE = `mutation ($project: ID!, $item: ID!, $field: ID!, $option: String!) {
  updateProjectV2ItemFieldValue(
    input: { projectId: $project, itemId: $item, fieldId: $field, value: { singleSelectOptionId: $option } }
  ) { projectV2Item { id } }
}`;

/** One GraphQL request. Throws on an HTTP error or a GraphQL error, with GitHub's messages. */
async function graphql(apiUrl, token, query, variables) {
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      authorization: `bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "teachback-board-sync",
    },
    body: JSON.stringify({ query, variables }),
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    // Not JSON: the status says enough.
  }
  // GraphQL errors come as { errors: [...] }; a refused token as { message } (REST style).
  const messages = [
    ...(body?.errors ?? []).map((e) => e?.message),
    body?.message,
  ].filter(Boolean);
  if (!res.ok || messages.length > 0 || !body?.data)
    throw new Error(
      `GitHub answered ${res.status}${messages.length ? `: ${messages.join("; ")}` : ""}`,
    );
  return body.data;
}

/**
 * The facts statusFor needs from one issue node, and anything that makes them incomplete.
 * Labels and blockers are set by the team, so a list cut off at one page means the column can't
 * be worked out (`skip`). Anyone can add a PR to an issue, though (a fork's "Closes #12"), so a cut
 * off PR list only earns a warning: the card is placed from the PRs that fit.
 */
function factsOf(node) {
  let skip = null;
  for (const [what, list] of [
    ["labels", node.labels],
    ["blockers", node.blockedBy],
  ])
    if (list.pageInfo.hasNextPage)
      skip = `#${node.number} has more ${what} than one page holds, so its card is left as it is. Raise the page size in scripts/board-sync.mjs.`;
  const warning = node.closedByPullRequestsReferences.pageInfo.hasNextPage
    ? `#${node.number} has more linked PRs than one page holds; its card is placed from the first page.`
    : null;
  return {
    skip,
    warning,
    facts: {
      number: node.number,
      state: node.state,
      // GitHub's lists can hold null entries (something the token can't see): skip them.
      labels: node.labels.nodes.filter(Boolean).map((label) => label.name),
      pullRequests: node.closedByPullRequestsReferences.nodes
        .filter(Boolean)
        .map((pr) => ({
          number: pr.number,
          state: pr.state,
          isDraft: pr.isDraft,
          isCrossRepository: pr.isCrossRepository,
          repository: pr.repository?.nameWithOwner ?? "",
          author: pr.author?.login ?? null,
        })),
      linkedBranches: node.linkedBranches.totalCount,
      // A blocker the token can't see (one in a private repo) arrives as null: it counts as
      // open, so the card waits in Backlog rather than claim to be ready.
      blockedBy: node.blockedBy.nodes.map((b) =>
        b
          ? { number: b.number, state: b.state }
          : { number: 0, state: "HIDDEN" },
      ),
    },
  };
}

/** Throws unless this is the board, the Status field and the exact options the script knows. */
function checkBoard(project) {
  if (project?.id !== BOARD.projectId)
    throw new Error("PROJECT_TOKEN didn't reach the TeachBack board.");
  if (project.field?.id !== BOARD.statusFieldId)
    throw new Error(
      "The board's Status field isn't the one this script expects.",
    );
  const options = project.field.options;
  const same =
    options.length === BOARD.statuses.length &&
    BOARD.statuses.every((name) =>
      options.some(
        (option) => option.name === name && option.id === BOARD.optionIds[name],
      ),
    );
  if (!same)
    throw new Error(
      `The board's Status options changed (${options.map((o) => `${o.name} ${o.id}`).join(", ")}). If that's intended, update BOARD in scripts/board-sync.mjs.`,
    );
}

/**
 * Reads every issue and every card, then moves the cards whose Status is wrong (none in a dry run).
 * @returns {Promise<{ planned: number, moved: number }>}
 */
export async function run({
  apiUrl = API,
  repoToken,
  projectToken,
  dryRun = false,
  team,
  log = console.log,
}) {
  const [owner, name] = BOARD.repo.split("/");
  /** @type {Map<number, ReturnType<typeof factsOf>>} */
  const issues = new Map();
  for (let after = null, more = true; more;) {
    const { repository } = await graphql(apiUrl, repoToken, ISSUES, {
      owner,
      name,
      after,
    });
    for (const node of repository.issues.nodes.filter(Boolean))
      issues.set(node.number, factsOf(node));
    ({ hasNextPage: more, endCursor: after } = repository.issues.pageInfo);
  }

  const cards = [];
  for (let after = null, more = true; more;) {
    const { node } = await graphql(apiUrl, projectToken, PROJECT, {
      id: BOARD.projectId,
      after,
    });
    checkBoard(node);
    cards.push(...node.items.nodes.filter(Boolean));
    ({ hasNextPage: more, endCursor: after } = node.items.pageInfo);
  }

  const moves = [];
  const onBoard = new Set();
  for (const card of cards) {
    // Draft items, PRs and other repos' issues are left as they are.
    if (card.type !== "ISSUE") continue;
    if (!isThisRepo(card.content?.repository?.nameWithOwner)) continue;
    const entry = issues.get(card.content.number);
    if (!entry) {
      log(
        `#${card.content.number}: the repo didn't list this issue; its card is left alone.`,
      );
      continue;
    }
    onBoard.add(entry.facts.number);
    // Warnings start their own line, so they stand out in the runner's log.
    if (entry.warning) log(`Warning: ${entry.warning}`);
    if (entry.skip) {
      log(`Warning: ${entry.skip}`);
      continue;
    }
    const from = card.fieldValueByName?.name ?? null;
    const to = statusFor(entry.facts, team);
    if (from !== to)
      moves.push({ item: card.id, number: entry.facts.number, from, to });
  }
  for (const number of issues.keys())
    if (!onBoard.has(number))
      log(
        `#${number}: not on the board (the board's auto-add workflow adds new issues).`,
      );

  moves.sort((a, b) => a.number - b.number);
  if (moves.length === 0) {
    log("Nothing to change: every card is in the right column.");
    return { planned: 0, moved: 0 };
  }
  for (const move of moves)
    log(`#${move.number}: ${move.from ?? "no status"} → ${move.to}`);
  if (dryRun) {
    log(
      `Dry run: ${moves.length} card(s) would move, and nothing was written.`,
    );
    return { planned: moves.length, moved: 0 };
  }
  let moved = 0;
  for (const move of moves) {
    await graphql(apiUrl, projectToken, WRITE, {
      project: BOARD.projectId,
      item: move.item,
      field: BOARD.statusFieldId,
      option: BOARD.optionIds[move.to],
    });
    moved += 1;
  }
  log(`Moved ${moved} card(s).`);
  return { planned: moves.length, moved };
}

/** The team's GitHub logins, from .github/team.json. */
function readTeam() {
  const team = JSON.parse(
    readFileSync(path.join(root, ".github/team.json"), "utf8"),
  );
  return new Set(Object.values(team));
}

/**
 * The command: checks the options and tokens, runs, and prints nothing that holds a token (GitHub's
 * errors, or a proxy's, can repeat the request's credentials).
 * @param {{ argv?: string[], env?: Record<string, string | undefined>, apiUrl?: string,
 *   team?: Set<string>, log?: (...parts: unknown[]) => void, error?: (...parts: unknown[]) => void }} [options]
 * @returns {Promise<number>} the exit code
 */
export async function main({
  argv = process.argv.slice(2),
  env = process.env,
  apiUrl = API,
  team,
  log = console.log,
  error = console.error,
} = {}) {
  const tokens = [env.GITHUB_TOKEN, env.PROJECT_TOKEN].filter(Boolean);
  const redact = (text) =>
    tokens.reduce((out, token) => out.split(token).join("***"), String(text));
  const unknown = argv.filter((arg) => arg !== "--dry-run");
  if (unknown.length > 0) {
    error(
      redact(
        `Unknown option ${unknown.join(" ")}. Usage: node scripts/board-sync.mjs [--dry-run]`,
      ),
    );
    return 1;
  }
  // A variable that is set but empty counts as missing.
  for (const name of ["GITHUB_TOKEN", "PROJECT_TOKEN"])
    if (!env[name]) {
      error(`${name} isn't set, so the board can't be synced.`);
      return 1;
    }
  try {
    await run({
      apiUrl,
      repoToken: env.GITHUB_TOKEN,
      projectToken: env.PROJECT_TOKEN,
      dryRun: argv.includes("--dry-run"),
      team: team ?? readTeam(),
      log: (...parts) => log(redact(parts.join(" "))),
    });
    return 0;
  } catch (err) {
    error(
      redact(`Board sync failed: ${err instanceof Error ? err.message : err}`),
    );
    return 1;
  }
}

// Run only as a command, not when a test imports it. (`import.meta.main` is undefined before
// Node 24.2, which devEngines still allows.)
let isCommand = false;
try {
  isCommand =
    process.argv[1] !== undefined &&
    realpathSync(path.resolve(process.argv[1])) ===
      realpathSync(fileURLToPath(import.meta.url));
} catch {
  isCommand = false;
}
if (isCommand) process.exitCode = await main();
