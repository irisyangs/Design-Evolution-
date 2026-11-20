const PREFIX = "design-evolution:research";
const ACTIVE_KEY = `${PREFIX}:active`;
const COUNTER_KEY = `${PREFIX}:counter`;
const LAST_COMPLETED_KEY = `${PREFIX}:last-completed`;
const COMPLETED_KEY = `${PREFIX}:completed`;

const columns = [
  "session_id",
  "event_timestamp",
  "generation_index",
  "event_type",
  "product_category",
  "candidate_id",
  "selected_candidate_id",
  "genome_parameters",
  "similarity_rating",
  "control_rating",
  "elapsed_seconds",
  "rating_type",
  "control_action",
  "renderer_id",
];

function sessionKey(sessionId) {
  return `${PREFIX}:session:${sessionId}`;
}

function saveSession(session) {
  // Save the whole event list after every event, so it survives a refresh.
  localStorage.setItem(sessionKey(session.session_id), JSON.stringify(session));
}

export function nextSessionId() {
  const currentNumber = Number(localStorage.getItem(COUNTER_KEY) || 0) + 1;
  return `P${String(currentNumber).padStart(3, "0")}`;
}

export function beginSession(sessionId, productCategory) {
  const startedAt = Date.now();

  const session = {
    session_id: sessionId,
    started_at: new Date(startedAt).toISOString(),
    started_at_ms: startedAt,
    events: [],
  };

  localStorage.setItem(COUNTER_KEY, String(Number(sessionId.slice(1))));
  localStorage.setItem(ACTIVE_KEY, sessionId);

  return recordEvent(session, {
    event_type: "start",
    generation_index: 0,
    product_category: productCategory,
  });
}

export function recordEvent(session, details) {
  const now = Date.now();

  const event = {
    session_id: session.session_id,
    event_timestamp: new Date(now).toISOString(),
    generation_index: details.generation_index ?? 0,
    event_type: details.event_type,
    product_category: details.product_category ?? "other",
    candidate_id: details.candidate_id ?? "",
    selected_candidate_id: details.selected_candidate_id ?? "",
    genome_parameters: details.genome_parameters ?? "",
    similarity_rating: details.similarity_rating ?? "",
    control_rating: details.control_rating ?? "",
    elapsed_seconds: Math.floor((now - session.started_at_ms) / 1000),
    rating_type: details.rating_type ?? "",
    control_action: details.control_action ?? "",
    renderer_id: details.renderer_id ?? "",
  };

  const updatedSession = {
    ...session,
    events: [...session.events, event],
  };

  saveSession(updatedSession);
  return updatedSession;
}

export function loadActiveSession() {
  const sessionId = localStorage.getItem(ACTIVE_KEY);
  if (!sessionId) return null;

  const saved = localStorage.getItem(sessionKey(sessionId));
  return saved ? JSON.parse(saved) : null;
}

export function finishSession(session, generationIndex, productCategory) {
  const completed = recordEvent(session, {
    event_type: "end",
    generation_index: generationIndex,
    product_category: productCategory,
  });

  const completedIds = JSON.parse(localStorage.getItem(COMPLETED_KEY) || "[]");
  if (!completedIds.includes(completed.session_id)) {
    localStorage.setItem(COMPLETED_KEY, JSON.stringify([...completedIds, completed.session_id]));
  }
  localStorage.setItem(LAST_COMPLETED_KEY, completed.session_id);
  localStorage.removeItem(ACTIVE_KEY);
  return completed;
}

export function loadCompletedSessions() {
  const completedIds = JSON.parse(localStorage.getItem(COMPLETED_KEY) || "[]");
  return completedIds
    .map((sessionId) => {
      const saved = localStorage.getItem(sessionKey(sessionId));
      return saved ? JSON.parse(saved) : null;
    })
    .filter(Boolean);
}

export function loadLastCompletedSession() {
  const sessionId = localStorage.getItem(LAST_COMPLETED_KEY);
  if (!sessionId) return null;

  const saved = localStorage.getItem(sessionKey(sessionId));
  return saved ? JSON.parse(saved) : null;
}

function csvCell(value) {
  let text =
    value && typeof value === "object" ? JSON.stringify(value) : String(value ?? "");

  // Avoid spreadsheet formula evaluation for text cells.
  if (/^[\t\r ]*[=+@]/.test(text)) text = `'${text}`;

  // Quote every cell and escape any quotes inside it.
  return `"${text.replaceAll('"', '""')}"`;
}

export function downloadSession(session, format) {
  const isCsv = format === "csv";

  const contents = isCsv
    ? [
        columns.map(csvCell).join(","),
        ...session.events.map((event) =>
          columns.map((column) => csvCell(event[column])).join(",")
        ),
      ].join("\r\n")
    : JSON.stringify(
        { session_id: session.session_id, events: session.events },
        null,
        2
      );

  const blob = new Blob([contents], {
    type: isCsv ? "text/csv;charset=utf-8" : "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `${session.session_id}-study.${format}`;
  link.click();

  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
