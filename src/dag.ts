/**
 * DAG Executor — runs a task plan respecting dependency order.
 *
 * Independent tasks (no unfinished deps) run in parallel via Promise.all.
 * Dependent tasks wait until all their prerequisites are complete.
 * Repeats in waves until all nodes are done or a deadlock is detected.
 *
 * Task trees use a hierarchical model:
 *   - Sequential siblings (ordered list): each blocked by the previous
 *   - Parallel siblings (unordered): all run at the same time
 *   - Nested subtasks: parent completes only when all children are done
 */

// --- Tree input (what the LLM produces) ---

export interface TaskTree {
  /** Short unique slug (e.g. "research", "implement") */
  id: string;
  /** Human-readable description */
  title: string;
  /** Specialist agent for leaf tasks; ignored for containers */
  agent: string;
  /** Child tasks — if present this node is a container */
  subtasks?: TaskTree[];
  /** When true, subtasks run one after another; when false/omitted they run in parallel */
  sequential?: boolean;
}

// --- Flat DAG (what the executor works with) ---

export interface DagNode {
  /** Unique identifier within the plan (e.g. "research", "scaffold", "implement-auth") */
  id: string;
  /** Human-readable description of the task */
  title: string;
  /** Which specialist agent should handle this node (empty for containers) */
  agent: string;
  /** IDs of nodes that must complete before this one can start */
  dependsOn: string[];
  /** True if this node is a container (auto-completes when children finish) */
  isContainer?: boolean;
  /** Parent container id, if any */
  parentId?: string;
  /** Whether this node's siblings are sequential (for UI rendering) */
  siblingSequential?: boolean;
  /** Order among siblings (for UI rendering) */
  siblingIndex?: number;
}

export interface DagPlan {
  projectId: string;
  goal: string;
  nodes: DagNode[];
}

/** Called for each node. Receives the node and a map of completed node results. */
export type NodeExecutor = (
  node: DagNode,
  results: Map<string, string>
) => Promise<string>;

// --- Tree → flat DAG conversion ---

/**
 * Flatten a TaskTree[] into DagNode[] with computed dependsOn.
 *
 * @param trees      — sibling task nodes at this level
 * @param sequential — true if these siblings run in order
 * @param predecessors — IDs that must complete before the first node here can start
 * @param parentId   — container parent id (for UI)
 * @param prefix     — id prefix (project id)
 */
export function flattenTaskTree(
  trees: TaskTree[],
  sequential: boolean,
  predecessors: string[] = [],
  parentId?: string,
  prefix: string = ""
): DagNode[] {
  const nodes: DagNode[] = [];
  let prevDeps = [...predecessors];

  for (let idx = 0; idx < trees.length; idx++) {
    const tree = trees[idx];
    const fullId = prefix ? `${prefix}-${tree.id}` : tree.id;

    if (tree.subtasks && tree.subtasks.length > 0) {
      // --- Container node ---
      const childSequential = tree.sequential ?? false;

      // Flatten children — they start after prevDeps
      const childNodes = flattenTaskTree(
        tree.subtasks,
        childSequential,
        prevDeps,
        fullId,
        prefix
      );
      nodes.push(...childNodes);

      // Determine terminal IDs (what the container waits on)
      let terminalIds: string[];
      if (childSequential) {
        // Sequential: only the last child is the terminal
        const lastChild = tree.subtasks[tree.subtasks.length - 1];
        terminalIds = [prefix ? `${prefix}-${lastChild.id}` : lastChild.id];
      } else {
        // Parallel: all immediate children are terminals
        terminalIds = tree.subtasks.map((s) =>
          prefix ? `${prefix}-${s.id}` : s.id
        );
      }

      // Container node — depends on all terminal children, auto-completes
      nodes.push({
        id: fullId,
        title: tree.title,
        agent: "",
        dependsOn: terminalIds,
        isContainer: true,
        parentId,
        siblingSequential: sequential,
        siblingIndex: idx,
      });

      if (sequential) prevDeps = [fullId];
    } else {
      // --- Leaf node ---
      nodes.push({
        id: fullId,
        title: tree.title,
        agent: tree.agent,
        dependsOn: [...prevDeps],
        parentId,
        siblingSequential: sequential,
        siblingIndex: idx,
      });

      if (sequential) prevDeps = [fullId];
    }
  }

  return nodes;
}

/**
 * Execute a DAG plan, returning a map of node id → result string.
 *
 * Algorithm:
 *   1. Find all "ready" nodes — nodes whose dependsOn are all in `results`
 *   2. Run them in parallel with Promise.all
 *   3. Add results, remove from remaining set
 *   4. Repeat until done, or throw if no progress (deadlock / bad deps)
 */
/** Called when a container node auto-completes. */
export type ContainerDoneCallback = (node: DagNode) => void;

export async function executeDag(
  plan: DagPlan,
  executor: NodeExecutor,
  onContainerDone?: ContainerDoneCallback
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  const remaining = new Set(plan.nodes.map((n) => n.id));
  const nodeMap = new Map(plan.nodes.map((n) => [n.id, n]));

  // Validate that all dependsOn references exist
  for (const node of plan.nodes) {
    for (const dep of node.dependsOn) {
      if (!nodeMap.has(dep)) {
        throw new Error(
          `Node "${node.id}" depends on "${dep}" which does not exist in the plan.`
        );
      }
    }
  }

  while (remaining.size > 0) {
    // Nodes whose every dependency is already done
    const ready = [...remaining].filter((id) =>
      nodeMap.get(id)!.dependsOn.every((dep) => results.has(dep))
    );

    if (ready.length === 0) {
      const stuck = [...remaining].join(", ");
      throw new Error(
        `DAG deadlock — no nodes are ready to run. Stuck: ${stuck}. ` +
        `This usually means a circular dependency.`
      );
    }

    // Run the ready wave in parallel
    const wave = ready.map((id) => nodeMap.get(id)!);
    const waveResults = await Promise.all(
      wave.map(async (node) => {
        // Container nodes auto-complete — no agent execution needed
        if (node.isContainer) {
          const childResults = node.dependsOn
            .filter((dep) => results.has(dep))
            .map((dep) => results.get(dep)!)
            .join("\n");
          onContainerDone?.(node);
          return { id: node.id, result: childResults || "(container done)" };
        }
        const result = await executor(node, results);
        return { id: node.id, result };
      })
    );

    for (const { id, result } of waveResults) {
      results.set(id, result);
      remaining.delete(id);
    }
  }

  return results;
}
