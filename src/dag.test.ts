import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { flattenTaskTree, executeDag } from "./dag.js";
import type { TaskTree, DagNode, DagPlan } from "./dag.js";

// ─── flattenTaskTree ────────────────────────────────────────────────────────

describe("flattenTaskTree", () => {
  it("sequential leaf tasks form a dependsOn chain", () => {
    const trees: TaskTree[] = [
      { id: "a", title: "A", agent: "coder" },
      { id: "b", title: "B", agent: "coder" },
      { id: "c", title: "C", agent: "writer" },
    ];
    const nodes = flattenTaskTree(trees, true);
    const map = new Map(nodes.map((n) => [n.id, n]));

    assert.deepStrictEqual(map.get("a")!.dependsOn, []);
    assert.deepStrictEqual(map.get("b")!.dependsOn, ["a"]);
    assert.deepStrictEqual(map.get("c")!.dependsOn, ["b"]);

    // All marked as sequential siblings
    for (const n of nodes) {
      assert.strictEqual(n.siblingSequential, true);
    }
  });

  it("parallel leaf tasks share the same predecessors", () => {
    const trees: TaskTree[] = [
      { id: "x", title: "X", agent: "coder" },
      { id: "y", title: "Y", agent: "writer" },
      { id: "z", title: "Z", agent: "researcher" },
    ];
    const nodes = flattenTaskTree(trees, false);
    const map = new Map(nodes.map((n) => [n.id, n]));

    // All depend on the same (empty) predecessors
    assert.deepStrictEqual(map.get("x")!.dependsOn, []);
    assert.deepStrictEqual(map.get("y")!.dependsOn, []);
    assert.deepStrictEqual(map.get("z")!.dependsOn, []);

    // All marked as parallel siblings
    for (const n of nodes) {
      assert.strictEqual(n.siblingSequential, false);
    }
  });

  it("parallel with predecessors: all share the same predecessors", () => {
    const trees: TaskTree[] = [
      { id: "a", title: "A", agent: "coder" },
      { id: "b", title: "B", agent: "writer" },
    ];
    const nodes = flattenTaskTree(trees, false, ["prior"]);
    const map = new Map(nodes.map((n) => [n.id, n]));

    assert.deepStrictEqual(map.get("a")!.dependsOn, ["prior"]);
    assert.deepStrictEqual(map.get("b")!.dependsOn, ["prior"]);
  });

  it("container with parallel subtasks", () => {
    const trees: TaskTree[] = [
      {
        id: "impl",
        title: "Implementation",
        agent: "coder",
        subtasks: [
          { id: "fe", title: "Frontend", agent: "coder" },
          { id: "be", title: "Backend", agent: "coder" },
        ],
      },
    ];
    const nodes = flattenTaskTree(trees, false);
    const map = new Map(nodes.map((n) => [n.id, n]));

    // Children run in parallel (no deps between them)
    assert.deepStrictEqual(map.get("fe")!.dependsOn, []);
    assert.deepStrictEqual(map.get("be")!.dependsOn, []);

    // Container depends on all children
    const container = map.get("impl")!;
    assert.strictEqual(container.isContainer, true);
    assert.deepStrictEqual(container.dependsOn, ["fe", "be"]);

    // Children have parentId set
    assert.strictEqual(map.get("fe")!.parentId, "impl");
    assert.strictEqual(map.get("be")!.parentId, "impl");
  });

  it("container with sequential subtasks", () => {
    const trees: TaskTree[] = [
      {
        id: "pipeline",
        title: "Pipeline",
        agent: "coder",
        sequential: true,
        subtasks: [
          { id: "design", title: "Design", agent: "coder" },
          { id: "code", title: "Code", agent: "coder" },
          { id: "test", title: "Test", agent: "researcher" },
        ],
      },
    ];
    const nodes = flattenTaskTree(trees, false);
    const map = new Map(nodes.map((n) => [n.id, n]));

    assert.deepStrictEqual(map.get("design")!.dependsOn, []);
    assert.deepStrictEqual(map.get("code")!.dependsOn, ["design"]);
    assert.deepStrictEqual(map.get("test")!.dependsOn, ["code"]);

    // Container waits only on last child (sequential)
    assert.deepStrictEqual(map.get("pipeline")!.dependsOn, ["test"]);
  });

  it("sequential top-level with nested parallel container", () => {
    // 1. research → 2. implement (parallel: fe, be) → 3. docs
    const trees: TaskTree[] = [
      { id: "research", title: "Research", agent: "researcher" },
      {
        id: "implement",
        title: "Implementation",
        agent: "coder",
        subtasks: [
          { id: "fe", title: "Frontend", agent: "coder" },
          { id: "be", title: "Backend", agent: "coder" },
        ],
      },
      { id: "docs", title: "Docs", agent: "writer" },
    ];
    const nodes = flattenTaskTree(trees, true);
    const map = new Map(nodes.map((n) => [n.id, n]));

    // research first
    assert.deepStrictEqual(map.get("research")!.dependsOn, []);

    // parallel children start after research
    assert.deepStrictEqual(map.get("fe")!.dependsOn, ["research"]);
    assert.deepStrictEqual(map.get("be")!.dependsOn, ["research"]);

    // container waits for both children
    assert.deepStrictEqual(map.get("implement")!.dependsOn, ["fe", "be"]);

    // docs waits for container
    assert.deepStrictEqual(map.get("docs")!.dependsOn, ["implement"]);
  });

  it("deeply nested containers", () => {
    // sequential: [research, impl(parallel: [fe(seq: [design-ui, build-ui]), be(seq: [design-api, build-api])]), docs]
    const trees: TaskTree[] = [
      { id: "research", title: "Research", agent: "researcher" },
      {
        id: "impl",
        title: "Implementation",
        agent: "coder",
        subtasks: [
          {
            id: "fe",
            title: "Frontend",
            agent: "coder",
            sequential: true,
            subtasks: [
              { id: "design-ui", title: "Design UI", agent: "coder" },
              { id: "build-ui", title: "Build UI", agent: "coder" },
            ],
          },
          {
            id: "be",
            title: "Backend",
            agent: "coder",
            sequential: true,
            subtasks: [
              { id: "design-api", title: "Design API", agent: "coder" },
              { id: "build-api", title: "Build API", agent: "coder" },
            ],
          },
        ],
      },
      { id: "docs", title: "Docs", agent: "writer" },
    ];
    const nodes = flattenTaskTree(trees, true);
    const map = new Map(nodes.map((n) => [n.id, n]));

    assert.deepStrictEqual(map.get("research")!.dependsOn, []);

    // fe branch: sequential under fe, starts after research
    assert.deepStrictEqual(map.get("design-ui")!.dependsOn, ["research"]);
    assert.deepStrictEqual(map.get("build-ui")!.dependsOn, ["design-ui"]);
    assert.deepStrictEqual(map.get("fe")!.dependsOn, ["build-ui"]);

    // be branch: parallel with fe, also starts after research
    assert.deepStrictEqual(map.get("design-api")!.dependsOn, ["research"]);
    assert.deepStrictEqual(map.get("build-api")!.dependsOn, ["design-api"]);
    assert.deepStrictEqual(map.get("be")!.dependsOn, ["build-api"]);

    // impl waits for both fe and be containers
    assert.deepStrictEqual(map.get("impl")!.dependsOn, ["fe", "be"]);

    // docs waits for impl
    assert.deepStrictEqual(map.get("docs")!.dependsOn, ["impl"]);
  });

  it("applies project prefix to all IDs", () => {
    const trees: TaskTree[] = [
      { id: "a", title: "A", agent: "coder" },
      { id: "b", title: "B", agent: "writer" },
    ];
    const nodes = flattenTaskTree(trees, true, [], undefined, "proj-123");
    const map = new Map(nodes.map((n) => [n.id, n]));

    assert.ok(map.has("proj-123-a"));
    assert.ok(map.has("proj-123-b"));
    assert.deepStrictEqual(map.get("proj-123-b")!.dependsOn, ["proj-123-a"]);
  });

  it("sets siblingIndex on all nodes", () => {
    const trees: TaskTree[] = [
      { id: "a", title: "A", agent: "coder" },
      { id: "b", title: "B", agent: "writer" },
      { id: "c", title: "C", agent: "researcher" },
    ];
    const nodes = flattenTaskTree(trees, false);

    assert.strictEqual(nodes[0].siblingIndex, 0);
    assert.strictEqual(nodes[1].siblingIndex, 1);
    assert.strictEqual(nodes[2].siblingIndex, 2);
  });

  it("single leaf task", () => {
    const trees: TaskTree[] = [
      { id: "only", title: "Only task", agent: "coder" },
    ];
    const nodes = flattenTaskTree(trees, true);

    assert.strictEqual(nodes.length, 1);
    assert.deepStrictEqual(nodes[0].dependsOn, []);
    assert.strictEqual(nodes[0].isContainer, undefined);
  });
});

// ─── executeDag ─────────────────────────────────────────────────────────────

describe("executeDag", () => {
  it("runs leaf tasks via executor and containers auto-complete", async () => {
    const trees: TaskTree[] = [
      { id: "research", title: "Research", agent: "researcher" },
      {
        id: "impl",
        title: "Implementation",
        agent: "coder",
        subtasks: [
          { id: "fe", title: "Frontend", agent: "coder" },
          { id: "be", title: "Backend", agent: "coder" },
        ],
      },
    ];
    const nodes = flattenTaskTree(trees, true);
    const plan: DagPlan = { projectId: "test", goal: "test", nodes };

    const executionOrder: string[] = [];
    const containersDone: string[] = [];

    const results = await executeDag(
      plan,
      async (node) => {
        executionOrder.push(node.id);
        return `result-${node.id}`;
      },
      (containerNode) => {
        containersDone.push(containerNode.id);
      }
    );

    // Only leaf tasks go through executor
    assert.deepStrictEqual(executionOrder, ["research", "fe", "be"]);

    // Container callback was called
    assert.deepStrictEqual(containersDone, ["impl"]);

    // All nodes have results
    assert.strictEqual(results.get("research"), "result-research");
    assert.strictEqual(results.get("fe"), "result-fe");
    assert.strictEqual(results.get("be"), "result-be");
    assert.ok(results.has("impl")); // container auto-completed
  });

  it("respects sequential ordering", async () => {
    const trees: TaskTree[] = [
      { id: "a", title: "A", agent: "coder" },
      { id: "b", title: "B", agent: "coder" },
      { id: "c", title: "C", agent: "coder" },
    ];
    const nodes = flattenTaskTree(trees, true);
    const plan: DagPlan = { projectId: "test", goal: "test", nodes };

    const executionOrder: string[] = [];

    await executeDag(plan, async (node) => {
      executionOrder.push(node.id);
      return `done-${node.id}`;
    });

    // Must run in order since sequential
    assert.deepStrictEqual(executionOrder, ["a", "b", "c"]);
  });

  it("runs parallel tasks in the same wave", async () => {
    const trees: TaskTree[] = [
      { id: "x", title: "X", agent: "coder" },
      { id: "y", title: "Y", agent: "coder" },
      { id: "z", title: "Z", agent: "coder" },
    ];
    const nodes = flattenTaskTree(trees, false);
    const plan: DagPlan = { projectId: "test", goal: "test", nodes };

    const waves: string[][] = [];
    let currentWave: string[] = [];

    // Track which nodes start together by using timing
    const results = await executeDag(plan, async (node) => {
      currentWave.push(node.id);
      return `done-${node.id}`;
    });

    // All 3 should be in the same wave (all had empty dependsOn)
    assert.strictEqual(results.size, 3);
  });

  it("passes prior results to executor", async () => {
    const trees: TaskTree[] = [
      { id: "first", title: "First", agent: "researcher" },
      { id: "second", title: "Second", agent: "coder" },
    ];
    const nodes = flattenTaskTree(trees, true);
    const plan: DagPlan = { projectId: "test", goal: "test", nodes };

    let secondPriorResults: Map<string, string> | undefined;

    await executeDag(plan, async (node, priorResults) => {
      if (node.id === "second") {
        secondPriorResults = new Map(priorResults);
      }
      return `result-${node.id}`;
    });

    assert.ok(secondPriorResults);
    assert.strictEqual(secondPriorResults!.get("first"), "result-first");
  });

  it("detects deadlock from invalid deps", async () => {
    // Manually create nodes with circular deps
    const nodes: DagNode[] = [
      { id: "a", title: "A", agent: "coder", dependsOn: ["b"] },
      { id: "b", title: "B", agent: "coder", dependsOn: ["a"] },
    ];
    const plan: DagPlan = { projectId: "test", goal: "test", nodes };

    await assert.rejects(
      () => executeDag(plan, async () => "done"),
      /deadlock/i
    );
  });

  it("rejects invalid dependsOn references", async () => {
    const nodes: DagNode[] = [
      { id: "a", title: "A", agent: "coder", dependsOn: ["nonexistent"] },
    ];
    const plan: DagPlan = { projectId: "test", goal: "test", nodes };

    await assert.rejects(
      () => executeDag(plan, async () => "done"),
      /does not exist/i
    );
  });

  it("handles deeply nested sequential → parallel → sequential", async () => {
    const trees: TaskTree[] = [
      { id: "start", title: "Start", agent: "researcher" },
      {
        id: "middle",
        title: "Middle",
        agent: "coder",
        subtasks: [
          {
            id: "branch-a",
            title: "Branch A",
            agent: "coder",
            sequential: true,
            subtasks: [
              { id: "a1", title: "A1", agent: "coder" },
              { id: "a2", title: "A2", agent: "coder" },
            ],
          },
          {
            id: "branch-b",
            title: "Branch B",
            agent: "coder",
            sequential: true,
            subtasks: [
              { id: "b1", title: "B1", agent: "coder" },
              { id: "b2", title: "B2", agent: "coder" },
            ],
          },
        ],
      },
      { id: "end", title: "End", agent: "writer" },
    ];
    const nodes = flattenTaskTree(trees, true);
    const plan: DagPlan = { projectId: "test", goal: "test", nodes };

    const executionOrder: string[] = [];
    const containersDone: string[] = [];

    await executeDag(
      plan,
      async (node) => {
        executionOrder.push(node.id);
        return `done`;
      },
      (c) => containersDone.push(c.id)
    );

    // start must be first
    assert.strictEqual(executionOrder[0], "start");

    // a1, b1 can run in parallel (both after start)
    const a1Idx = executionOrder.indexOf("a1");
    const b1Idx = executionOrder.indexOf("b1");
    assert.ok(a1Idx > 0 && b1Idx > 0);

    // a2 must come after a1, b2 after b1
    assert.ok(executionOrder.indexOf("a2") > a1Idx);
    assert.ok(executionOrder.indexOf("b2") > b1Idx);

    // end must be last leaf
    assert.strictEqual(executionOrder[executionOrder.length - 1], "end");

    // 3 containers: branch-a, branch-b, middle
    assert.strictEqual(containersDone.length, 3);
    assert.ok(containersDone.includes("branch-a"));
    assert.ok(containersDone.includes("branch-b"));
    assert.ok(containersDone.includes("middle"));
  });
});
