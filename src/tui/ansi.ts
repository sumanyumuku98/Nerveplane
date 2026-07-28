/**
 * Zero-dependency ANSI helpers for the terminal UI.
 *
 * Color/style functions are **no-ops** when stdout is not a TTY or `NO_COLOR`
 * is set, so piped output (and every existing test, which runs non-TTY) stays
 * byte-identical to the plain text it emits today. The cursor/screen controls
 * are only meaningful inside the full-screen `nerveplane watch` monitor, which
 * itself only runs on a TTY.
 */

export const colorEnabled = (): boolean => !!process.stdout.isTTY && !("NO_COLOR" in process.env);

const wrap = (open: number, close: number) => (s: string): string => (colorEnabled() ? `\x1b[${open}m${s}\x1b[${close}m` : s);

export const bold = wrap(1, 22);
export const dim = wrap(2, 22);
export const red = wrap(31, 39);
export const green = wrap(32, 39);
export const yellow = wrap(33, 39);
export const blue = wrap(34, 39);
export const magenta = wrap(35, 39);
export const cyan = wrap(36, 39);
export const gray = wrap(90, 39);

/** Color a severity label (info→dim … blocking→bold red). */
export function severityColor(sev: string, s: string = sev): string {
  switch (sev) {
    case "blocking":
      return bold(red(s));
    case "high":
      return red(s);
    case "medium":
      return yellow(s);
    case "low":
      return cyan(s);
    default:
      return dim(s); // info
  }
}

/** Color an agent status label. */
export function statusColor(status: string, s: string = status): string {
  switch (status) {
    case "in_progress":
      return green(s);
    case "available":
      return cyan(s);
    case "blocked":
    case "error":
      return red(s);
    case "needs_review":
      return yellow(s);
    case "offline":
      return dim(s);
    default:
      return s;
  }
}

// --- raw terminal control (used only by the full-screen watch TUI) ---
export const screen = {
  enterAlt: "\x1b[?1049h",
  leaveAlt: "\x1b[?1049l",
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h",
  clear: "\x1b[2J",
  home: "\x1b[H",
};

/** Strip ANSI SGR codes (for visible-width math). */
export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Truncate to a visible width, appending … if cut. Drops color if it has to cut. */
export function truncate(s: string, width: number): string {
  if (width <= 0) return "";
  const plain = stripAnsi(s);
  if (plain.length <= width) return s;
  return plain.slice(0, Math.max(0, width - 1)) + "…";
}
