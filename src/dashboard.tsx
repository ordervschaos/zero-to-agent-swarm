// Ink-based CLI dashboard for the agent swarm.
// Uses <Static> for log output (scrolls up naturally)
// and a minimal live section for task status + input.

import React, { useState, useEffect, useRef } from "react";
import { render, Static, Box, Text, useInput, useApp, useStdout } from "ink";
import { getAllTasks, type Task } from "./task-queue.js";
import type { Summary } from "./summary.js";

// ── Module-level state (bridges imperative API → React) ─────────

interface LogEntry {
  id: number;
  text: string;
}

let logSeq = 0;
const pendingLogs: LogEntry[] = [];
let currentSummary: Summary | null = null;
const updateListeners = new Set<() => void>();

function notify() {
  for (const fn of updateListeners) fn();
}

function pushLog(text: string) {
  const clean = text.replace(/\x1B\[[0-9;]*m/g, "");
  for (const line of clean.split("\n")) {
    if (line.trim()) {
      pendingLogs.push({ id: logSeq++, text: line.trim() });
    }
  }
}

/** Push a project completion summary to the dashboard. */
export function pushSummary(summary: Summary): void {
  currentSummary = summary;
  notify();
}

/** Dismiss the current summary (called on next user input). */
export function dismissSummary(): void {
  currentSummary = null;
  notify();
}

// ── Helpers ──────────────────────────────────────────────────────

const AGENT_COLORS = ["cyan", "yellow", "magenta", "green", "red"] as const;
type AgentColor = (typeof AGENT_COLORS)[number];

function agentColor(agent: string): AgentColor {
  let h = 0;
  for (const ch of agent) h = (h + ch.charCodeAt(0)) % AGENT_COLORS.length;
  return AGENT_COLORS[h];
}

// ── Markdown renderer ────────────────────────────────────────────

interface MdSegment {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  heading?: boolean;
  bullet?: boolean;
}

function parseMarkdownSegments(input: string): MdSegment[] {
  const headingMatch = input.match(/^(#{1,3})\s+(.+)$/);
  if (headingMatch) {
    return [{ text: headingMatch[2], heading: true, bold: true }];
  }

  const bulletMatch = input.match(/^(\s*[-*+])\s+(.+)$/);
  if (bulletMatch) {
    return [
      { text: "  • ", bullet: true },
      ...parseInlineMarkdown(bulletMatch[2]),
    ];
  }

  const numberedMatch = input.match(/^(\s*\d+[.)]\s+)(.+)$/);
  if (numberedMatch) {
    return [
      { text: `  ${numberedMatch[1]}`, bullet: true },
      ...parseInlineMarkdown(numberedMatch[2]),
    ];
  }

  return parseInlineMarkdown(input);
}

function parseInlineMarkdown(input: string): MdSegment[] {
  const segments: MdSegment[] = [];
  const pattern = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`(.+?)`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(input)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: input.slice(lastIndex, match.index) });
    }
    if (match[1]) segments.push({ text: match[2], bold: true });
    else if (match[3]) segments.push({ text: match[4], italic: true });
    else if (match[5]) segments.push({ text: match[6], code: true });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < input.length) {
    segments.push({ text: input.slice(lastIndex) });
  }
  if (segments.length === 0) {
    segments.push({ text: input });
  }
  return segments;
}

function Md({ children, dim }: { children: string; dim?: boolean }) {
  const segments = parseMarkdownSegments(children);
  return (
    <Text dimColor={dim}>
      {segments.map((seg, i) => {
        if (seg.heading)
          return (
            <Text key={i} bold color="cyan">
              {seg.text}
            </Text>
          );
        if (seg.bullet)
          return (
            <Text key={i} dimColor>
              {seg.text}
            </Text>
          );
        if (seg.code)
          return (
            <Text key={i} color="yellow">
              {seg.text}
            </Text>
          );
        if (seg.bold)
          return (
            <Text key={i} bold>
              {seg.text}
            </Text>
          );
        if (seg.italic)
          return (
            <Text key={i} dimColor>
              {seg.text}
            </Text>
          );
        return <Text key={i}>{seg.text}</Text>;
      })}
    </Text>
  );
}

// ── Components ───────────────────────────────────────────────────

function Badge({ status }: { status: string }) {
  const map: Record<string, [string, string, string]> = {
    done: ["green", "black", " DONE "],
    "in-progress": ["yellow", "black", " WORK "],
    pending: ["cyan", "black", " NEXT "],
    blocked: ["magenta", "white", " WAIT "],
    failed: ["red", "white", " FAIL "],
  };
  const [bg, fg, label] = map[status] ?? ["white", "black", ` ${status} `];
  return (
    <Text backgroundColor={bg as any} color={fg as any}>
      {label}
    </Text>
  );
}

function TaskBoard({ tasks }: { tasks: Task[] }) {
  if (tasks.length === 0) {
    return <Text dimColor>  No tasks yet — type below to send work to agents</Text>;
  }

  const roots = tasks.filter((t) => t.parent_id === null);
  const childrenOf = (pid: number) =>
    tasks.filter((t) => t.parent_id === pid);

  const elements: React.ReactNode[] = [];

  for (const root of roots) {
    const subs = childrenOf(root.id);
    if (subs.length > 0) {
      elements.push(
        <Text key={`h-${root.id}`}>
          {"  "}
          <Md>{root.description}</Md>
        </Text>,
      );
      for (let i = 0; i < subs.length; i++) {
        const sub = subs[i];
        const branch = i === subs.length - 1 ? "└" : "├";
        const depStr =
          sub.depends_on.length > 0
            ? ` ← [${sub.depends_on.join(",")}]`
            : "";
        elements.push(
          <Text key={`s-${sub.id}`} wrap="truncate">
            <Text dimColor>
              {"   "}
              {branch}{" "}
            </Text>
            <Badge status={sub.status} />
            <Text color={agentColor(sub.assigned_to)}>
              {" "}
              {sub.assigned_to}
            </Text>
            <Text> {sub.description}</Text>
            {depStr ? <Text dimColor>{depStr}</Text> : null}
          </Text>,
        );
      }
    } else {
      elements.push(
        <Text key={`t-${root.id}`} wrap="truncate">
          <Text>{"  "}</Text>
          <Badge status={root.status} />
          <Text color={agentColor(root.assigned_to)}>
            {" "}
            {root.assigned_to}
          </Text>
          <Text> {root.description}</Text>
        </Text>,
      );
    }
  }

  // Status summary bar
  const ct: Record<string, number> = {};
  for (const t of tasks) ct[t.status] = (ct[t.status] ?? 0) + 1;

  const parts: React.ReactNode[] = [];
  if (ct.done)
    parts.push(
      <Text key="done" color="green">
        {ct.done} done
      </Text>,
    );
  if (ct["in-progress"])
    parts.push(
      <Text key="work" color="yellow">
        {ct["in-progress"]} working
      </Text>,
    );
  if (ct.pending)
    parts.push(
      <Text key="pend" color="cyan">
        {ct.pending} pending
      </Text>,
    );
  if (ct.blocked)
    parts.push(
      <Text key="block" color="magenta">
        {ct.blocked} blocked
      </Text>,
    );
  if (ct.failed)
    parts.push(
      <Text key="fail" color="red">
        {ct.failed} failed
      </Text>,
    );

  elements.push(
    <Text key="statusbar">
      {"  "}
      {parts.map((p, i) => (
        <React.Fragment key={`part-${i}`}>
          {i > 0 && <Text dimColor> │ </Text>}
          {p}
        </React.Fragment>
      ))}
    </Text>,
  );

  return <Box flexDirection="column">{elements}</Box>;
}

function SummaryBox({ summary }: { summary: Summary }) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="green"
      paddingX={1}
    >
      <Text bold color="green">
        PROJECT COMPLETE<Text dimColor>: {summary.project}</Text>
      </Text>
      {summary.subtasks.map((sub, i) => (
        <Box key={`sub-${i}`} flexDirection="column">
          <Text>
            <Text bold color={agentColor(sub.agent)}>
              {sub.agent}
            </Text>
            <Text>: {sub.description}</Text>
          </Text>
          <Text dimColor>{"    "}→ {sub.result.slice(0, 80)}</Text>
        </Box>
      ))}
      {summary.subtasks.length > 0 && <Text> </Text>}
      <Text bold>Summary:</Text>
      <Md>{summary.text}</Md>
    </Box>
  );
}

// ── Main App ─────────────────────────────────────────────────────

function App({ onInput }: { onInput: (text: string) => void }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [logItems, setLogItems] = useState<LogEntry[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [input, setInput] = useState("");
  const [cursorPos, setCursorPos] = useState(0);
  const { stdout } = useStdout();
  const cols = Math.min(stdout?.columns ?? 80, 120);

  const prevTaskHash = useRef("");
  useEffect(() => {
    const id = setInterval(() => {
      const newTasks = getAllTasks();
      const hash = newTasks
        .map((t) => `${t.id}:${t.status}:${t.result?.length ?? 0}`)
        .join("|");
      if (hash !== prevTaskHash.current) {
        prevTaskHash.current = hash;
        setTasks(newTasks);
      }

      if (pendingLogs.length > 0) {
        const batch = pendingLogs.splice(0, pendingLogs.length);
        setLogItems((prev) => [...prev, ...batch]);
      }
    }, 500);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const listener = () =>
      setSummary(currentSummary ? { ...currentSummary } : null);
    updateListeners.add(listener);
    return () => {
      updateListeners.delete(listener);
    };
  }, []);

  useInput((ch, key) => {
    if (key.return) {
      if (input.trim()) {
        pushLog(`> ${input}`);
        onInput(input.trim());
        currentSummary = null;
        setSummary(null);
        setInput("");
        setCursorPos(0);
      }
      return;
    }

    if (key.backspace || key.delete) {
      if (cursorPos > 0) {
        setInput(
          (prev) => prev.slice(0, cursorPos - 1) + prev.slice(cursorPos),
        );
        setCursorPos((p) => p - 1);
      }
      return;
    }

    if (key.leftArrow) {
      setCursorPos((p) => Math.max(0, p - 1));
      return;
    }
    if (key.rightArrow) {
      setCursorPos((p) => Math.min(input.length, p + 1));
      return;
    }

    if (key.ctrl && ch === "u") {
      setInput("");
      setCursorPos(0);
      return;
    }
    if (key.ctrl && ch === "a") {
      setCursorPos(0);
      return;
    }
    if (key.ctrl && ch === "e") {
      setCursorPos(input.length);
      return;
    }
    if (key.ctrl && ch === "w") {
      const before = input.slice(0, cursorPos).replace(/\S+\s*$/, "");
      setInput(before + input.slice(cursorPos));
      setCursorPos(before.length);
      return;
    }

    if (ch && !key.ctrl && !key.meta && ch >= " ") {
      setInput(
        (prev) => prev.slice(0, cursorPos) + ch + prev.slice(cursorPos),
      );
      setCursorPos((p) => p + ch.length);
    }
  });

  const divider = "─".repeat(Math.max(0, cols - 2));
  const before = input.slice(0, cursorPos);
  const cursorChar = cursorPos < input.length ? input[cursorPos] : " ";
  const after = cursorPos < input.length ? input.slice(cursorPos + 1) : "";

  return (
    <>
      {/* ── Scrollable output (renders once, scrolls up) ───── */}
      <Static items={logItems}>
        {(entry) => (
          <Box key={entry.id}>
            <Md dim>{entry.text}</Md>
          </Box>
        )}
      </Static>

      {/* ── Live section (updates in place at bottom) ──────── */}
      <Box flexDirection="column" width={cols}>
        <Text dimColor>{divider}</Text>

        {/* Task board */}
        <Box paddingX={1} marginBottom={0}>
          <Text bold color="cyan">
            Tasks
          </Text>
        </Box>
        <TaskBoard tasks={tasks} />

        {/* Summary (shown when a project completes) */}
        {summary && <SummaryBox summary={summary} />}

        {/* Input */}
        <Text dimColor>{divider}</Text>
        <Box paddingX={1}>
          <Text>
            <Text bold color="cyan">
              {">"}{" "}
            </Text>
            <Text>{before}</Text>
            <Text inverse>{cursorChar}</Text>
            <Text>{after}</Text>
          </Text>
        </Box>
      </Box>
    </>
  );
}

// ── Public API ───────────────────────────────────────────────────

let active = false;

/** Start the integrated dashboard. */
export function startDashboard(onInput: (text: string) => void): void {
  if (active) return;
  active = true;

  // Redirect console.log into the pending log buffer
  console.log = (...args: any[]) => {
    const msg = args
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
      .join(" ")
      .trim();
    if (msg) pushLog(msg);
  };

  // Guard: ink requires raw mode (TTY stdin)
  if (!process.stdin.isTTY) {
    console.error(
      "Dashboard requires a TTY. Run in an interactive terminal.",
    );
    process.exit(1);
  }

  // Hide cursor — ink renders its own
  process.stdout.write("\x1B[?25l");
  process.on("exit", () => process.stdout.write("\x1B[?25h\n"));

  const { waitUntilExit } = render(<App onInput={onInput} />, {
    exitOnCtrlC: true,
  });

  waitUntilExit().then(() => {
    process.stdout.write("\x1B[?25h\n");
    process.exit(0);
  });
}
