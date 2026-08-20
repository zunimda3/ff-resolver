const input = document.getElementById("links");
const addButton = document.getElementById("add");
const pauseButton = document.getElementById("pause");
const skipButton = document.getElementById("skip");
const clearQueueButton = document.getElementById("clear-queue");
const retryButton = document.getElementById("retry");
const copyButton = document.getElementById("copy");
const exportButton = document.getElementById("export");
const clearButton = document.getElementById("clear");
const queueBody = document.getElementById("queue-body");
const outputBody = document.getElementById("output-body");
const failureBody = document.getElementById("failure-body");
const status = document.getElementById("status");
const summary = document.getElementById("summary");
const tabs = [...document.querySelectorAll("[data-tab]")];
const panels = [...document.querySelectorAll("[data-panel]")];
let latestState = null;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fileLabel(url) {
  try {
    const parsed = new URL(url);
    return decodeURIComponent(parsed.hash.slice(1)) || parsed.pathname.split("/").filter(Boolean).pop() || parsed.hostname;
  } catch {
    return url;
  }
}

function render(state) {
  latestState = state;
  const queue = [];
  if (state.current) queue.push({ url: state.current.url, status: state.current.status, active: true });
  queue.push(...state.pending.map((url) => ({ url, status: "Waiting", active: false })));

  queueBody.innerHTML = queue.length
    ? queue.map((item, index) => `
      <div class="list-row">
        <span class="order ${item.active ? "active" : ""}">${item.active ? "●" : index + 1}</span>
        <div class="row-main"><strong>${escapeHtml(fileLabel(item.url))}</strong><span>${escapeHtml(item.url)}</span></div>
        <span class="state ${item.active ? "working" : ""}">${escapeHtml(item.status)}</span>
      </div>`).join("")
    : '<div class="empty">The queue is empty.</div>';

  outputBody.innerHTML = state.outputs.length
    ? [...state.outputs].reverse().map((item) => `
      <div class="output-row">
        <span class="success">✓</span>
        <div class="row-main"><strong>${escapeHtml(fileLabel(item.source))}</strong><span>${escapeHtml(item.direct)}</span></div>
        <button class="icon-button" data-copy="${escapeHtml(item.direct)}" aria-label="Copy this link">Copy</button>
      </div>`).join("")
    : '<div class="empty">Resolved direct URLs will appear here.</div>';

  failureBody.innerHTML = state.failures.length
    ? [...state.failures].reverse().map((item) => `
      <div class="failure-row">
        <span class="failed">!</span>
        <div class="row-main"><strong>${escapeHtml(fileLabel(item.source))}</strong><span>${escapeHtml(item.error)}</span></div>
      </div>`).join("")
    : '<div class="empty">No failed links.</div>';

  status.textContent = state.paused ? "Queue paused" : state.current ? state.current.status : state.pending.length ? "Starting next item" : "Ready";
  summary.textContent = `${state.outputs.length} resolved · ${state.failures.length} failed · ${state.pending.length} waiting`;
  pauseButton.textContent = state.paused ? "Resume queue" : "Pause queue";
  pauseButton.disabled = !state.current && !state.pending.length && !state.paused;
  skipButton.disabled = !state.current;
  clearQueueButton.disabled = !state.pending.length;
  retryButton.disabled = !state.failures.length;
  copyButton.disabled = !state.outputs.length;
  exportButton.disabled = !state.outputs.length;
  clearButton.disabled = !state.outputs.length;
}

addButton.addEventListener("click", async () => {
  const links = input.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  if (!links.length) {
    status.textContent = "Paste at least one link first";
    return;
  }
  const result = await window.ffResolver.addLinks(links);
  status.textContent = result.rejected ? `${result.added} added, ${result.rejected} rejected` : `${result.added} added to queue`;
  if (result.added) input.value = "";
});

pauseButton.addEventListener("click", () => window.ffResolver.setPaused(!latestState.paused));
skipButton.addEventListener("click", () => window.ffResolver.skipCurrent());
clearQueueButton.addEventListener("click", async () => {
  const cleared = await window.ffResolver.clearQueue();
  status.textContent = `${cleared} waiting link${cleared === 1 ? "" : "s"} cleared`;
});
retryButton.addEventListener("click", () => window.ffResolver.retryFailures());
copyButton.addEventListener("click", async () => {
  const count = await window.ffResolver.copyOutputs();
  status.textContent = `${count} link${count === 1 ? "" : "s"} copied`;
});
exportButton.addEventListener("click", async () => {
  const result = await window.ffResolver.exportOutputs();
  if (result.saved) status.textContent = "Output exported";
});
clearButton.addEventListener("click", () => window.ffResolver.clearOutputs());

outputBody.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-copy]");
  if (!button) return;
  const copied = await window.ffResolver.copyText(button.dataset.copy);
  status.textContent = copied ? "Link copied" : "Could not copy link";
});

tabs.forEach((tab) => tab.addEventListener("click", () => {
  tabs.forEach((item) => item.setAttribute("aria-selected", String(item === tab)));
  panels.forEach((panel) => { panel.hidden = panel.dataset.panel !== tab.dataset.tab; });
}));

window.ffResolver.onState(render);
window.ffResolver.getState().then(render);
