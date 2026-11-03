import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BOARD,
  main,
  run,
  statusFor,
  type IssueFacts,
} from "../../scripts/board-sync.mjs";

// The board sync (T40): which Status each issue gets, and what the script sends to GitHub. The
// script runs against a fake GraphQL server that records every request and the token it carried,
// and refuses a query that doesn't ask for what the real API was checked to need.
const root = path.resolve(import.meta.dirname, "../..");
const TEAM = new Set(["lead-login", "ai-login", "frontend-login"]);

// A task issue: open, with its track label, and nothing else yet.
const facts = (over: Partial<IssueFacts> = {}): IssueFacts => ({
  number: 1,
  state: "OPEN",
  labels: ["ai"],
  pullRequests: [],
  linkedBranches: 0,
  blockedBy: [],
  ...over,
});
type PrFacts = IssueFacts["pullRequests"][number];
const pr = (over: Partial<PrFacts> = {}): PrFacts => ({
  number: 100,
  state: "OPEN",
  isDraft: false,
  isCrossRepository: false,
  repository: "jbarra2/teachback",
  author: "ai-login",
  ...over,
});

describe("statusFor (first matching rule wins)", () => {
  it.each<[string, Partial<IssueFacts>, string]>([
    // 1. Closed → Done, whatever else is true.
    ["closed", { state: "CLOSED" }, "Done"],
    [
      "closed with an open PR and labels",
      { state: "CLOSED", pullRequests: [pr()], labels: ["in-review"] },
      "Done",
    ],
    // 2. In review: an open, non-draft PR from the team on this repo, or the label.
    ["an open PR from the team", { pullRequests: [pr()] }, "In review"],
    ["the in-review label", { labels: ["in-review"] }, "In review"],
    [
      "a ready PR beside a draft one",
      { pullRequests: [pr({ isDraft: true }), pr({ number: 101 })] },
      "In review",
    ],
    // 3. In progress: a draft PR from the team, the label, or a linked branch.
    [
      "a draft PR from the team",
      { pullRequests: [pr({ isDraft: true })] },
      "In progress",
    ],
    ["the in-progress label", { labels: ["in-progress"] }, "In progress"],
    ["a linked branch", { linkedBranches: 1 }, "In progress"],
    // 4. Ready: a track label, and every blocker closed (or none at all).
    ["no blockers", {}, "Ready"],
    ["the lead track", { labels: ["lead"] }, "Ready"],
    ["the frontend track", { labels: ["frontend"] }, "Ready"],
    // An outsider's issue has no track label: it waits in Backlog until someone triages it.
    ["no track label (an outsider's issue)", { labels: [] }, "Backlog"],
    ["only a bug label", { labels: ["bug"] }, "Backlog"],
    [
      "every blocker closed",
      {
        blockedBy: [
          { number: 2, state: "CLOSED" },
          { number: 3, state: "CLOSED" },
        ],
      },
      "Ready",
    ],
    // 5. Otherwise Backlog.
    [
      "one blocker still open",
      {
        blockedBy: [
          { number: 2, state: "CLOSED" },
          { number: 3, state: "OPEN" },
        ],
      },
      "Backlog",
    ],
  ])("%s → %s", (_name, over, expected) => {
    expect(statusFor(facts(over), TEAM)).toBe(expected);
  });

  // Anyone can open a PR on a public repo and write "Closes #12" in it: those don't move cards.
  it.each<[string, Partial<PrFacts>]>([
    ["a PR from a fork", { isCrossRepository: true }],
    ["a PR in another repo", { repository: "someone/else" }],
    ["a PR from someone outside the team", { author: "stranger" }],
    ["a PR with no author (a deleted account)", { author: null }],
    ["a closed PR", { state: "CLOSED" }],
    ["a merged PR", { state: "MERGED" }],
  ])("ignores %s", (_name, over) => {
    expect(statusFor(facts({ pullRequests: [pr(over)] }), TEAM)).toBe("Ready");
    expect(
      statusFor(
        facts({ pullRequests: [pr({ ...over, isDraft: true })] }),
        TEAM,
      ),
    ).toBe("Ready");
  });

  // GitHub logins are unique without regard to case, and team.json is typed by hand.
  it("matches team logins without regard to case", () => {
    expect(
      statusFor(facts({ pullRequests: [pr({ author: "AI-Login" })] }), TEAM),
    ).toBe("In review");
    expect(
      statusFor(
        facts({ pullRequests: [pr({ author: "ai-login" })] }),
        new Set(["AI-LOGIN"]),
      ),
    ).toBe("In review");
  });

  it("takes the track labels from the team's roles in .github/team.json", () => {
    const roles = Object.keys(
      JSON.parse(readFileSync(path.join(root, ".github/team.json"), "utf8")),
    );
    expect([...BOARD.tracks].sort()).toEqual(roles.sort());
  });

  it("never gives Done to an open issue (the board's Auto-close would close it)", () => {
    for (const over of [
      {},
      { labels: ["done", "Done"] },
      { pullRequests: [pr({ state: "MERGED" })] },
    ])
      expect(statusFor(facts(over), TEAM)).not.toBe("Done");
  });
});

// ---------------------------------------------------------------------------------------------
// The fake GitHub GraphQL API.

const REPO_TOKEN = "ghs_repo_token_for_tests_0000000000000000";
const PROJECT_TOKEN = "ghp_project_token_for_tests_00000000000000";
// The board's real option ids, written out here rather than taken from BOARD, so a typo there
// fails a test before merge instead of every run after it.
const IDS: Record<string, string> = {
  Backlog: "f75ad846",
  Ready: "61e4505c",
  "In progress": "47fc9ee4",
  "In review": "df73e18b",
  Done: "98236657",
};
const OPTIONS = Object.entries(IDS).map(([name, id]) => ({ id, name }));
const optionId = (name: string) => IDS[name];

interface FakeIssue {
  number: number;
  state?: string;
  labels?: string[];
  prs?: PrFacts[];
  branches?: number;
  blockedBy?: { number: number; state: string }[];
  /** The list runs past one page. */
  more?: "labels" | "blockedBy" | "prs";
}
interface FakeItem {
  id: string;
  type?: string;
  number?: number;
  repo?: string;
  status?: string | null;
}

interface Recorded {
  kind: "issues" | "project" | "write" | "unknown";
  auth: string | undefined;
  variables: Record<string, unknown>;
}

// The exact queries, whitespace aside: the read queries were sent verbatim to GitHub's real API
// and the mutation's types checked against its schema (T40 reviews). The fake answers whatever
// fields it likes, so any other query text is refused, the way GitHub refuses an invalid query.
// Changing a query means changing it here too, after running it against the real API.
// The real repo, board and Status field, written out rather than taken from BOARD: the fake
// checks every request against these, so a wrong id in the script fails here, not in production.
const REPO = "jbarra2/teachback";
const PROJECT_ID = "PVT_kwHOCMca8c4Bpadk";
const FIELD_ID = "PVTSSF_lAHOCMca8c4Bpadkzhn2N34";
const [OWNER, NAME] = REPO.split("/");
const EXACT: Record<Exclude<Recorded["kind"], "unknown">, string> = {
  issues: [
    "query ($owner: String!, $name: String!, $after: String) {",
    "repository(owner: $owner, name: $name) {",
    "issues(first: 100, after: $after, orderBy: { field: CREATED_AT, direction: ASC }) {",
    "pageInfo { hasNextPage endCursor }",
    "nodes { number state",
    "labels(first: 50) { nodes { name } pageInfo { hasNextPage } }",
    "blockedBy(first: 50) { nodes { number state } pageInfo { hasNextPage } }",
    "closedByPullRequestsReferences(first: 50, includeClosedPrs: false) {",
    "nodes { number state isDraft isCrossRepository repository { nameWithOwner } author { login } }",
    "pageInfo { hasNextPage } }",
    "linkedBranches(first: 1) { totalCount } } } } }",
  ].join(" "),
  project: [
    "query ($id: ID!, $after: String) {",
    "node(id: $id) { ... on ProjectV2 { id",
    'field(name: "Status") { ... on ProjectV2SingleSelectField { id options { id name } } }',
    "items(first: 100, after: $after) {",
    "pageInfo { hasNextPage endCursor }",
    "nodes { id type",
    "content { ... on Issue { number repository { nameWithOwner } } }",
    'fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } } } } } } }',
  ].join(" "),
  write: [
    "mutation ($project: ID!, $item: ID!, $field: ID!, $option: String!) {",
    "updateProjectV2ItemFieldValue( input: { projectId: $project, itemId: $item, fieldId: $field,",
    "value: { singleSelectOptionId: $option } } ) { projectV2Item { id } } }",
  ].join(" "),
};

let server: Server;
let url: string;
let requests: Recorded[];
let state: {
  issues: FakeIssue[];
  items: FakeItem[];
  projectId: string;
  fieldId: string;
  options: { id: string; name: string }[];
  fail?: {
    kind: Recorded["kind"];
    status?: number;
    message?: string;
    /** "graphql": { errors } (the default); "partial": { data, errors }; "data": { data } only;
     * "rest": { message }, as GitHub answers a bad token; "empty": {}; "html": an edge error
     * page; "notFound": { data: { node: null }, errors }, GitHub's answer for an unknown id;
     * "notProject": { data: { node: {} } }, its answer for an id that isn't a project. */
    shape?:
      | "graphql"
      | "partial"
      | "data"
      | "rest"
      | "empty"
      | "html"
      | "notFound"
      | "notProject";
  };
  /** GitHub's lists may hold null entries (an item the token can't see). */
  nullEntries?: boolean;
  /** Null entries inside each issue's labels, blockers and PRs (things the token can't see). */
  nestedNulls?: boolean;
};

const page = <T>(all: T[], after: unknown, size = 100) => {
  const start = typeof after === "string" ? Number(after) : 0;
  const nodes = all.slice(start, start + size);
  const end = start + nodes.length;
  return {
    nodes,
    pageInfo: { hasNextPage: end < all.length, endCursor: String(end) },
  };
};

const nested = <T>(nodes: T[]): (T | null)[] =>
  state.nestedNulls ? [null, ...nodes] : nodes;
const withNulls = <T>(nodes: T[]): (T | null)[] =>
  state.nullEntries ? [null, ...nodes, null] : nodes;

/** Why GitHub would refuse this request, or null. */
function invalid(
  kind: Recorded["kind"],
  query: string,
  variables: Record<string, unknown>,
) {
  if (kind === "unknown") return "unknown query";
  if (query.replace(/\s+/g, " ").trim() !== EXACT[kind])
    return `the ${kind} query isn't the one checked against GitHub's API`;
  if (
    kind === "issues" &&
    (variables.owner !== OWNER || variables.name !== NAME)
  )
    return "wrong repository";
  if (kind === "project" && variables.id !== PROJECT_ID)
    return "Could not resolve to a node with the global id";
  if (
    kind === "write" &&
    (variables.project !== PROJECT_ID || variables.field !== FIELD_ID)
  )
    return "wrong project or field";
  return null;
}

function answer(kind: Recorded["kind"], variables: Record<string, unknown>) {
  if (kind === "issues") {
    const { nodes, pageInfo } = page(state.issues, variables.after);
    return {
      repository: {
        issues: {
          pageInfo,
          nodes: withNulls(nodes).map(
            (i) =>
              i && {
                number: i.number,
                state: i.state ?? "OPEN",
                labels: {
                  // A task issue has its track label unless the test says otherwise.
                  nodes: nested(
                    (i.labels ?? ["lead"]).map((name) => ({ name })),
                  ),
                  pageInfo: { hasNextPage: i.more === "labels" },
                },
                blockedBy: {
                  nodes: nested(i.blockedBy ?? []),
                  pageInfo: { hasNextPage: i.more === "blockedBy" },
                },
                closedByPullRequestsReferences: {
                  nodes: nested(i.prs ?? []).map(
                    (p) =>
                      p && {
                        number: p.number,
                        state: p.state,
                        isDraft: p.isDraft,
                        isCrossRepository: p.isCrossRepository,
                        repository: { nameWithOwner: p.repository },
                        author: p.author === null ? null : { login: p.author },
                      },
                  ),
                  pageInfo: { hasNextPage: i.more === "prs" },
                },
                linkedBranches: { totalCount: i.branches ?? 0 },
              },
          ),
        },
      },
    };
  }
  if (kind === "project") {
    const { nodes, pageInfo } = page(state.items, variables.after);
    return {
      node: {
        id: state.projectId,
        field: { id: state.fieldId, options: state.options },
        items: {
          pageInfo,
          nodes: withNulls(nodes).map(
            (it) =>
              it && {
                id: it.id,
                type: it.type ?? "ISSUE",
                content:
                  it.type === "DRAFT_ISSUE"
                    ? {}
                    : {
                        number: it.number,
                        repository: { nameWithOwner: it.repo ?? REPO },
                      },
                fieldValueByName:
                  it.status === null || it.status === undefined
                    ? null
                    : { name: it.status },
              },
          ),
        },
      },
    };
  }
  return {
    updateProjectV2ItemFieldValue: { projectV2Item: { id: variables.item } },
  };
}

beforeEach(async () => {
  requests = [];
  state = {
    issues: [],
    items: [],
    projectId: PROJECT_ID,
    fieldId: FIELD_ID,
    options: OPTIONS,
  };
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const { query, variables = {} } = JSON.parse(body) as {
        query: string;
        variables?: Record<string, unknown>;
      };
      const kind: Recorded["kind"] = query.includes(
        "updateProjectV2ItemFieldValue",
      )
        ? "write"
        : query.includes("repository(")
          ? "issues"
          : query.includes("node(id:")
            ? "project"
            : "unknown";
      requests.push({ kind, auth: req.headers.authorization, variables });
      res.setHeader("content-type", "application/json");
      const refused = invalid(kind, query, variables);
      if (refused) {
        res.end(JSON.stringify({ errors: [{ message: refused }] }));
        return;
      }
      if (state.fail?.kind === kind) {
        // An error that repeats the request's credentials, as a careless proxy might.
        const message = `${state.fail.message ?? "Bad credentials"} (${req.headers.authorization})`;
        res.statusCode = state.fail.status ?? 200;
        const shape = state.fail.shape ?? "graphql";
        if (shape === "html") {
          res.setHeader("content-type", "text/html");
          res.end("<html><body>Unicorn! 502</body></html>");
          return;
        }
        const shapes = {
          graphql: { errors: [{ message }] },
          partial: { data: answer(kind, variables), errors: [{ message }] },
          data: { data: answer(kind, variables) },
          rest: { message },
          empty: {},
          notFound: {
            data: { node: null },
            errors: [
              { type: "NOT_FOUND", message: "Could not resolve to a node" },
            ],
          },
          notProject: { data: { node: {} } },
        };
        res.end(JSON.stringify(shapes[shape]));
        return;
      }
      res.end(JSON.stringify({ data: answer(kind, variables) }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/graphql`;
  // Nothing in these tests may reach the real API, even if a call forgets its apiUrl.
  const fakeOnly: typeof fetch = (input, init) =>
    String(input) === url
      ? realFetch(input, init)
      : Promise.reject(new Error(`a test tried to reach ${String(input)}`));
  globalThis.fetch = fakeOnly;
});

const realFetch = globalThis.fetch;
afterEach(async () => {
  globalThis.fetch = realFetch;
  await new Promise((resolve) => server.close(resolve));
});

function capture() {
  const lines: string[] = [];
  return { lines, log: (...args: unknown[]) => lines.push(args.join(" ")) };
}

const sync = (dryRun = false) => {
  const out = capture();
  return {
    out,
    done: run({
      apiUrl: url,
      repoToken: REPO_TOKEN,
      projectToken: PROJECT_TOKEN,
      dryRun,
      team: TEAM,
      log: out.log,
    }),
  };
};
const writes = () =>
  requests
    .filter((r) => r.kind === "write")
    .map((r) => ({ item: r.variables.item, option: r.variables.option }));
const written = () => writes().map((w) => w.item);

describe("the fake API (so the tests below can trust it)", () => {
  it("refuses any query but the ones checked against GitHub's API", async () => {
    const res = await fetch(url, {
      method: "POST",
      body: JSON.stringify({
        query: EXACT.project.replace(" type ", " "),
        variables: { id: BOARD.projectId },
      }),
    });
    expect(await res.json()).toMatchObject({
      errors: [{ message: expect.stringMatching(/isn't the one checked/) }],
    });
  });

  it("refuses to let a test reach anything but the fake", async () => {
    await expect(fetch("https://api.github.com/graphql")).rejects.toThrow(
      /a test tried to reach/,
    );
  });

  it("uses the board's real option ids, not ones copied from the script", () => {
    expect(BOARD.optionIds).toEqual(IDS);
    expect(BOARD.statuses).toEqual(Object.keys(IDS));
  });
});

describe("run against the GitHub API", () => {
  beforeEach(() => {
    state.issues = [
      { number: 1, state: "CLOSED" },
      { number: 2, blockedBy: [{ number: 1, state: "CLOSED" }] },
      { number: 3, blockedBy: [{ number: 2, state: "OPEN" }] },
      { number: 4, prs: [pr()] },
      { number: 5, branches: 1 },
    ];
    state.items = [
      { id: "item-1", number: 1, status: "In review" },
      { id: "item-2", number: 2, status: "Backlog" },
      { id: "item-3", number: 3, status: "Backlog" },
      { id: "item-4", number: 4, status: "In progress" },
      { id: "item-5", number: 5, status: null },
    ];
  });

  it("moves exactly the cards whose Status is wrong, to the right option", async () => {
    const { done, out } = sync();
    await expect(done).resolves.toMatchObject({ moved: 4 });
    expect(writes()).toEqual([
      { item: "item-1", option: optionId("Done") },
      { item: "item-2", option: optionId("Ready") },
      { item: "item-4", option: optionId("In review") },
      { item: "item-5", option: optionId("In progress") },
    ]);
    for (const r of requests.filter((r) => r.kind === "write"))
      expect(r.variables).toMatchObject({
        project: PROJECT_ID,
        field: FIELD_ID,
      });
    expect(out.lines.join("\n")).toMatch(/#2: Backlog → Ready/);
  });

  // Least privilege: the project token only ever goes to the project, the repo token to the repo.
  it("reads the repo with the repo token, and uses the project token only for the project", async () => {
    await sync().done;
    for (const r of requests)
      expect(r.auth, r.kind).toBe(
        `bearer ${r.kind === "issues" ? REPO_TOKEN : PROJECT_TOKEN}`,
      );
    expect(new Set(requests.map((r) => r.kind))).toEqual(
      new Set(["issues", "project", "write"]),
    );
  });

  it("writes nothing when every card is already right", async () => {
    state.items = [
      { id: "item-1", number: 1, status: "Done" },
      { id: "item-2", number: 2, status: "Ready" },
      { id: "item-3", number: 3, status: "Backlog" },
      { id: "item-4", number: 4, status: "In review" },
      { id: "item-5", number: 5, status: "In progress" },
    ];
    const { done, out } = sync();
    await expect(done).resolves.toMatchObject({ moved: 0 });
    expect(writes()).toEqual([]);
    expect(out.lines.join("\n")).toMatch(/nothing to change/i);
  });

  it("only prints the moves in a dry run, and sends no write at all", async () => {
    const { done, out } = sync(true);
    await expect(done).resolves.toMatchObject({ moved: 0, planned: 4 });
    expect(requests.some((r) => r.kind === "write")).toBe(false);
    expect(out.lines.join("\n")).toMatch(/dry run/i);
    expect(out.lines.join("\n")).toMatch(/#1: In review → Done/);
  });

  // The rules above, fed through GitHub's own response shapes.
  it("reads drafts, forks, other repos, deleted authors, merged PRs and labels from GitHub's data", async () => {
    state.issues = [
      { number: 10, prs: [pr({ isDraft: true })] },
      { number: 11, prs: [pr({ isCrossRepository: true })] },
      { number: 12, prs: [pr({ repository: "someone/else" })] },
      { number: 13, prs: [pr({ author: null })] },
      { number: 14, prs: [pr({ state: "MERGED" })] },
      { number: 15, labels: ["in-review"] },
      { number: 16, labels: ["in-progress"] },
      { number: 17, prs: [pr()] },
    ];
    state.items = state.issues.map((i) => ({
      id: `item-${i.number}`,
      number: i.number,
      status: "Backlog",
    }));
    await sync().done;
    expect(Object.fromEntries(writes().map((w) => [w.item, w.option]))).toEqual(
      {
        "item-10": optionId("In progress"),
        "item-11": optionId("Ready"),
        "item-12": optionId("Ready"),
        "item-13": optionId("Ready"),
        "item-14": optionId("Ready"),
        "item-15": optionId("In review"),
        "item-16": optionId("In progress"),
        "item-17": optionId("In review"),
      },
    );
  });

  it("leaves draft cards, PR cards, other repos' issues and unknown issues alone, and says so", async () => {
    state.items.push(
      { id: "draft", type: "DRAFT_ISSUE" },
      { id: "a-pr", type: "PULL_REQUEST", number: 4, status: "Backlog" },
      { id: "elsewhere", number: 2, repo: "someone/else", status: "Backlog" },
      { id: "unknown", number: 99, status: "Backlog" },
    );
    state.issues.push({ number: 6 });
    const { done, out } = sync();
    await done;
    for (const id of ["draft", "a-pr", "elsewhere", "unknown"])
      expect(written()).not.toContain(id);
    expect(writes()).toHaveLength(4);
    const printed = out.lines.join("\n");
    expect(printed).toMatch(/#6.*not on the board/);
    expect(printed).toMatch(/#99.*didn't list/);
  });

  it("reads every page of issues and cards", async () => {
    state.issues = Array.from({ length: 250 }, (_, i) => ({ number: i + 1 }));
    state.items = state.issues.map((i) => ({
      id: `item-${i.number}`,
      number: i.number,
      status: i.number === 250 ? "Backlog" : "Ready",
    }));
    const { done } = sync();
    await expect(done).resolves.toMatchObject({ moved: 1 });
    expect(writes()).toEqual([{ item: "item-250", option: optionId("Ready") }]);
    expect(requests.filter((r) => r.kind === "issues")).toHaveLength(3);
    expect(requests.filter((r) => r.kind === "project")).toHaveLength(3);
  });

  // Labels and blockers are set by the team: a cut-off list leaves that one card as it is.
  it.each(["labels", "blockedBy"] as const)(
    "leaves a card alone, with a warning, when its %s run past one page, and syncs the rest",
    async (list) => {
      state.issues[1].more = list;
      const { done, out } = sync();
      await expect(done).resolves.toMatchObject({ moved: 3 });
      expect(written()).not.toContain("item-2");
      expect(out.lines.join("\n")).toMatch(
        /::warning::#2 has more (labels|blockers) than one page/,
      );
    },
  );

  // Anyone can add PRs to an issue (a fork's "Closes #4"), so too many can't stop the sync:
  // the card is placed from the PRs that fit, with a warning.
  // Cards move back as well as forward: every run re-sorts the whole board.
  it("moves cards backwards when the work goes back", async () => {
    state.issues = [
      { number: 20 }, // reopened: its card is still in Done
      { number: 21, prs: [pr({ isDraft: true })] }, // its PR went back to draft
      { number: 22, blockedBy: [{ number: 99, state: "OPEN" }] }, // a new open blocker
      { number: 23 }, // its in-progress label was removed and its branch deleted
      { number: 24, labels: [] }, // its track label was removed
    ];
    state.items = [
      { id: "item-20", number: 20, status: "Done" },
      { id: "item-21", number: 21, status: "In review" },
      { id: "item-22", number: 22, status: "Ready" },
      { id: "item-23", number: 23, status: "In progress" },
      { id: "item-24", number: 24, status: "Ready" },
    ];
    await sync().done;
    expect(writes()).toEqual([
      { item: "item-20", option: optionId("Ready") },
      { item: "item-21", option: optionId("In progress") },
      { item: "item-22", option: optionId("Backlog") },
      { item: "item-23", option: optionId("Ready") },
      { item: "item-24", option: optionId("Backlog") },
    ]);
  });

  // GitHub matches owner and name without regard to case but answers with the real name, so a
  // repo written in another case must still match its cards.
  it("matches the repo's cards whatever the case of its name", async () => {
    state.items = state.items.map((it) => ({
      ...it,
      repo: "JBarra2/TeachBack",
    }));
    state.issues[3].prs = [pr({ repository: "JBARRA2/teachback" })];
    await expect(sync().done).resolves.toMatchObject({ moved: 4 });
    expect(writes()).toContainEqual({
      item: "item-4",
      option: optionId("In review"),
    });
  });

  // A blocker the token can't see (one in a private repo) counts as open: the card waits in
  // Backlog rather than claim it's ready. Labels and PRs it can't see are simply skipped.
  it("counts a hidden blocker as open, and skips hidden labels and PRs", async () => {
    state.nestedNulls = true;
    state.issues = [
      { number: 30 }, // a hidden blocker, nothing else
      { number: 31, prs: [pr()] }, // a hidden PR beside a real one
      { number: 32, labels: ["in-progress"] }, // a hidden label beside a real one
    ];
    state.items = state.issues.map((i) => ({
      id: `item-${i.number}`,
      number: i.number,
      status: "Ready",
    }));
    await sync().done;
    expect(writes()).toEqual([
      { item: "item-30", option: optionId("Backlog") },
      { item: "item-31", option: optionId("In review") },
      { item: "item-32", option: optionId("In progress") },
    ]);
  });

  it("moves cards in issue order, whatever order the board lists them in", async () => {
    state.items.reverse();
    const { done, out } = sync();
    await done;
    expect(written()).toEqual(["item-1", "item-2", "item-4", "item-5"]);
    const moves = out.lines.filter((line) => line.includes(" → "));
    expect(moves.map((line) => line.split(":")[0])).toEqual([
      "#1",
      "#2",
      "#4",
      "#5",
    ]);
  });

  it("skips the empty entries GitHub can put in a page", async () => {
    state.nullEntries = true;
    const { done } = sync();
    await expect(done).resolves.toMatchObject({ moved: 4 });
  });

  it.each<
    [
      string,
      "issues" | "project",
      NonNullable<typeof state.fail>["shape"],
      number,
      RegExp,
    ]
  >([
    ["an HTML error page", "project", "html", 502, /GitHub answered 502/],
    [
      "an unknown project id",
      "project",
      "notFound",
      200,
      /Could not resolve to a node/,
    ],
    [
      "an id that isn't a project",
      "project",
      "notProject",
      200,
      /didn't reach the TeachBack board/,
    ],
  ])("fails clearly on %s", async (_name, kind, shape, status, message) => {
    state.fail = { kind, shape, status };
    await expect(sync().done).rejects.toThrow(message);
    expect(writes()).toEqual([]);
  });

  it("places a card from the PRs that fit when its PR list runs past one page", async () => {
    state.issues[3].more = "prs";
    const { done, out } = sync();
    await expect(done).resolves.toMatchObject({ moved: 4 });
    expect(writes()).toContainEqual({
      item: "item-4",
      option: optionId("In review"),
    });
    expect(out.lines.join("\n")).toMatch(/::warning::#4 .*PRs/);
  });

  // The token can write to every project the user owns, so it touches only this board's Status.
  it.each<[string, () => void]>([
    ["another project", () => (state.projectId = "PVT_somebody_else")],
    ["another Status field", () => (state.fieldId = "PVTSSF_other")],
    ["a missing option", () => (state.options = OPTIONS.slice(0, 4))],
    [
      "an extra option",
      () => (state.options = [...OPTIONS, { id: "opt-x", name: "Blocked" }]),
    ],
    [
      "a renamed option",
      () =>
        (state.options = OPTIONS.map((o) =>
          o.name === "Ready" ? { ...o, name: "Todo" } : o,
        )),
    ],
    // Auto-close watches the Done option: swapped ids would make "Ready" close issues.
    [
      "two options with their ids swapped",
      () =>
        (state.options = OPTIONS.map((o) =>
          o.name === "Ready"
            ? { ...o, id: optionId("Done") }
            : o.name === "Done"
              ? { ...o, id: optionId("Ready") }
              : o,
        )),
    ],
  ])("stops before writing when it finds %s", async (_name, change) => {
    change();
    await expect(sync().done).rejects.toThrow(/board/i);
    expect(writes()).toEqual([]);
  });

  it.each<["issues" | "project", number]>([
    ["issues", 401],
    ["project", 401],
    ["issues", 200],
    ["project", 200],
  ])(
    "fails when GitHub refuses the %s request (HTTP %i)",
    async (kind, status) => {
      state.fail = { kind, status };
      await expect(sync().done).rejects.toThrow(
        new RegExp(`GitHub answered ${status}: Bad credentials`),
      );
      expect(writes()).toEqual([]);
    },
  );

  // GraphQL can answer with data and errors together; a part that failed must not pass as empty.
  it("fails on a GraphQL error even when data comes with it", async () => {
    state.fail = {
      kind: "issues",
      shape: "partial",
      message: "Resource not accessible",
    };
    await expect(sync().done).rejects.toThrow(/Resource not accessible/);
    expect(writes()).toEqual([]);
  });

  it("fails on an HTTP error even when the body looks like data", async () => {
    state.fail = { kind: "project", status: 502, shape: "data" };
    await expect(sync().done).rejects.toThrow(/502/);
    expect(writes()).toEqual([]);
  });

  it("fails on an answer with neither data nor errors", async () => {
    state.fail = { kind: "project", shape: "empty" };
    await expect(sync().done).rejects.toThrow(/GitHub answered 200/);
    expect(writes()).toEqual([]);
  });

  it("shows GitHub's own message for a refused token", async () => {
    state.fail = { kind: "issues", status: 401, shape: "rest" };
    await expect(sync().done).rejects.toThrow(/401.*Bad credentials/);
  });

  it("stops at the first refused write", async () => {
    state.fail = { kind: "write", message: "Resource not accessible" };
    await expect(sync().done).rejects.toThrow(/Resource not accessible/);
    expect(requests.filter((r) => r.kind === "write")).toHaveLength(1);
  });
});

describe("main (the command)", () => {
  beforeEach(() => {
    state.issues = [{ number: 1, state: "CLOSED" }];
    state.items = [{ id: "item-1", number: 1, status: "Ready" }];
  });

  const command = (
    argv: string[],
    env: Record<string, string | undefined>,
    // null: let main read .github/team.json itself.
    team: Set<string> | null = TEAM,
  ) => {
    const out = capture();
    const err = capture();
    return {
      out,
      err,
      code: main({
        argv,
        env,
        apiUrl: url,
        team: team ?? undefined,
        log: out.log,
        error: err.log,
      }),
    };
  };
  const tokens = { GITHUB_TOKEN: REPO_TOKEN, PROJECT_TOKEN };

  it("syncs with both tokens from the environment, each to its own requests, and exits 0", async () => {
    const { code } = command([], tokens);
    await expect(code).resolves.toBe(0);
    expect(writes()).toHaveLength(1);
    for (const r of requests)
      expect(r.auth, r.kind).toBe(
        `bearer ${r.kind === "issues" ? REPO_TOKEN : PROJECT_TOKEN}`,
      );
  });

  // The tokens go to GitHub's API over https and nowhere else.
  it("sends the tokens only to https://api.github.com/graphql", async () => {
    const out = capture();
    const err = capture();
    const code = await main({
      argv: [],
      env: tokens,
      team: TEAM,
      log: out.log,
      error: err.log,
    });
    expect(code).toBe(1);
    expect(err.lines.join("\n")).toContain(
      "a test tried to reach https://api.github.com/graphql",
    );
  });

  it("does a dry run with --dry-run", async () => {
    const { code } = command(["--dry-run"], tokens);
    await expect(code).resolves.toBe(0);
    expect(writes()).toEqual([]);
  });

  // The team's logins come from .github/team.json, whatever they are.
  it("counts PRs from the logins in .github/team.json", async () => {
    const logins = Object.values(
      JSON.parse(readFileSync(path.join(root, ".github/team.json"), "utf8")),
    ) as string[];
    state.issues = [{ number: 1, prs: [pr({ author: logins[1] })] }];
    const { code } = command([], tokens, null);
    await expect(code).resolves.toBe(0);
    expect(writes()).toEqual([
      { item: "item-1", option: optionId("In review") },
    ]);
  });

  // An environment secret that isn't set reaches the step as an empty string.
  it.each([
    ["GITHUB_TOKEN", "missing", { PROJECT_TOKEN }],
    ["PROJECT_TOKEN", "missing", { GITHUB_TOKEN: REPO_TOKEN }],
    ["PROJECT_TOKEN", "empty", { GITHUB_TOKEN: REPO_TOKEN, PROJECT_TOKEN: "" }],
  ])("exits 1, sending nothing, with %s %s", async (name, _how, env) => {
    const { code, err } = command([], env);
    await expect(code).resolves.toBe(1);
    expect(err.lines.join("\n")).toContain(`${name} isn't set`);
    expect(requests).toEqual([]);
  });

  it("never prints a token passed as an option by mistake", async () => {
    const { code, err } = command([REPO_TOKEN], tokens);
    await expect(code).resolves.toBe(1);
    expect(err.lines.join("\n")).toMatch(/Unknown option \*\*\*/);
    expect(err.lines.join("\n")).not.toContain(REPO_TOKEN);
  });

  it("refuses an unknown option", async () => {
    const { code, err } = command(["--write-everything"], tokens);
    await expect(code).resolves.toBe(1);
    expect(err.lines.join("\n")).toMatch(/--write-everything/);
    expect(requests).toEqual([]);
  });

  // GitHub's errors and a careless proxy can repeat the request's credentials: never print them.
  it.each(["issues", "project", "write"] as const)(
    "never prints a token, even when the %s error repeats it",
    async (kind) => {
      state.fail = { kind, message: "Bad credentials" };
      const { code, out, err } = command([], tokens);
      await expect(code).resolves.toBe(1);
      const printed = [...out.lines, ...err.lines].join("\n");
      expect(printed).toMatch(/Bad credentials/);
      expect(printed).not.toContain(REPO_TOKEN);
      expect(printed).not.toContain(PROJECT_TOKEN);
    },
  );

  // Every line goes through the same filter. A token that happens to be a word shows it.
  it("filters tokens out of the progress lines too", async () => {
    const { code, out } = command([], {
      GITHUB_TOKEN: REPO_TOKEN,
      PROJECT_TOKEN: "Ready",
    });
    await expect(code).resolves.toBe(0);
    const printed = out.lines.join("\n");
    expect(printed).toMatch(/#1: \*\*\* → Done/);
    expect(printed).not.toContain("Ready");
  });
});

// The workflow runs the file itself: it must act as a command and report failure in its exit
// code, or a broken sync would show as a green run. Neither case reaches the network.
describe("node scripts/board-sync.mjs", () => {
  const script = path.join(root, "scripts/board-sync.mjs");
  // No way out: Node's fetch goes through a proxy on a closed port, so a regression that let the
  // child reach for GitHub fails at once instead of making a real call.
  const bare = {
    NODE_ENV: "test" as const,
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    NODE_USE_ENV_PROXY: "1",
    HTTPS_PROXY: "http://127.0.0.1:9",
  };
  const spawn = (args: string[], env: Record<string, string | undefined>) =>
    spawnSync(process.execPath, args, {
      env: { ...bare, ...env },
      encoding: "utf8",
      timeout: 10_000,
    });

  it("exits 1 on an unknown option", () => {
    const res = spawn([script, "--no-such-option"], {
      GITHUB_TOKEN: "x",
      PROJECT_TOKEN: "y",
    });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/Unknown option --no-such-option/);
  });

  it("exits 1 without its tokens", () => {
    const res = spawn([script], {});
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/GITHUB_TOKEN isn't set/);
  });

  // Tests import it: importing must never sync, even with tokens in the environment.
  // Under `node -e` there is no argv[1], so also import it from a run of another file.
  it("does nothing when imported while another file is the one being run", () => {
    const res = spawn(
      [
        "--input-type=module",
        "-e",
        `await import(${JSON.stringify(pathToFileURL(script).href)})`,
        path.join(root, "package.json"),
      ],
      { GITHUB_TOKEN: "x", PROJECT_TOKEN: "y" },
    );
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("");
    expect(res.stderr).toBe("");
  });

  it("does nothing when imported rather than run", () => {
    const res = spawn(
      [
        "--input-type=module",
        "-e",
        `await import(${JSON.stringify(pathToFileURL(script).href)})`,
      ],
      { GITHUB_TOKEN: "x", PROJECT_TOKEN: "y" },
    );
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("");
    expect(res.stderr).toBe("");
  });
});
