// State
let worlds = [];
let players = [];
let logs = new Map(); // worldId -> [log entries]
let selectedLogWorldId = null;
let autoScroll = true;

// Toast functionality
function showToast(message, type = "info") {
  const toastContainer = document.getElementById("toastContainer");
  const toast = document.createElement("div");

  const bgColor = {
    success: "bg-green-500",
    error: "bg-red-500",
    info: "bg-blue-500",
  }[type];

  toast.className = `${bgColor} text-white px-6 py-3 rounded-lg shadow-lg transform transition-all duration-300 ease-in-out translate-x-full`;
  toast.textContent = message;

  toastContainer.appendChild(toast);

  // Trigger reflow to enable animation
  toast.offsetHeight;
  toast.classList.remove("translate-x-full");

  // Remove toast after 3 seconds
  setTimeout(() => {
    toast.classList.add("translate-x-full");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// --- World Management ---
async function createWorld() {
  const nameInput = document.getElementById("worldNameInput");
  const seedInput = document.getElementById("worldSeedInput");
  const name = nameInput.value.trim();
  const seed = seedInput.value.trim();

  if (!name || !seed) {
    showToast("Please enter both a name and a seed.", "error");
    return;
  }

  showToast(`Creating world '${name}'...`, "info");
  try {
    const res = await fetch("/api/worlds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, seed }),
    });
    if (res.ok) {
      showToast("World created successfully!", "success");
      nameInput.value = "";
      seedInput.value = "";
      loadWorlds();
    } else {
      const err = await res.json();
      showToast(`Error creating world: ${err.error}`, "error");
    }
  } catch (err) {
    showToast(`Network error: ${err.message}`, "error");
  }
}

async function startWorld(worldId) {
  showToast(`Starting world ${worldId}...`, "info");
  await fetch(`/api/worlds/${worldId}/start`, { method: "POST" });
  // Status will be updated via websocket/polling
}

async function stopWorld(worldId) {
  showToast(`Stopping world ${worldId}...`, "info");
  await fetch(`/api/worlds/${worldId}/stop`, { method: "POST" });
}

async function deleteWorld(worldId) {
  if (!confirm(`Are you sure you want to permanently delete world ${worldId}?`))
    return;

  showToast(`Deleting world ${worldId}...`, "info");
  await fetch(`/api/worlds/${worldId}`, { method: "DELETE" });
  // The list will refresh, removing the deleted world
}

async function loadWorlds() {
  try {
    const res = await fetch("/api/worlds");
    worlds = await res.json();
    renderWorlds();
    updateLogSelector();
  } catch (err) {
    console.error("Failed to load worlds:", err);
    showToast("Could not load worlds.", "error");
  }
}

function renderWorlds() {
  const container = document.getElementById("worldsList");
  container.innerHTML = "";

  if (worlds.length === 0) {
    container.innerHTML = `<p class="text-gray-500 italic">No worlds created yet.</p>`;
    return;
  }

  worlds.forEach((world) => {
    const isRunning = world.status === "RUNNING";
    const isStopped = world.status === "STOPPED";
    const isWorking =
      world.status === "STARTING" || world.status === "STOPPING";

    const el = document.createElement("div");
    el.className = "bg-gray-50 rounded-lg p-4 border border-gray-200";
    el.innerHTML = `
      <div class="flex justify-between items-center mb-3">
        <div class="flex items-center space-x-3">
          <span class="status-dot status-${world.status || "UNKNOWN"}"></span>
          <strong class="text-lg text-gray-800">${world.name}</strong>
        </div>
        <span class="text-sm font-mono text-gray-500">#${world.id}</span>
      </div>
      <div class="text-sm text-gray-600 mb-4">
        <p>Status: <span class="font-semibold">${world.status}</span></p>
        <p>Seed: <code class="font-mono bg-gray-200 px-1 rounded">${
          world.seed
        }</code></p>
        <p>Server: <code class="font-mono bg-gray-200 px-1 rounded">localhost:${
          world.server_port
        }</code></p>
        <p>Dynmap: <a href="http://localhost:${
          world.dynmap_port
        }" target="_blank" class="text-blue-600 hover:underline">http://localhost:${
      world.dynmap_port
    }</a></p>
      </div>
      <div class="flex space-x-2">
        <button 
          onclick="startWorld(${world.id})" 
          class="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
          ${!isStopped ? "disabled" : ""}>
          Start
        </button>
        <button 
          onclick="stopWorld(${world.id})"
          class="px-3 py-1 text-sm bg-yellow-600 text-white rounded hover:bg-yellow-700 disabled:opacity-50"
           ${!isRunning ? "disabled" : ""}>
          Stop
        </button>
        <button 
          onclick="deleteWorld(${world.id})"
          class="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
           ${isWorking ? "disabled" : ""}>
          Delete
        </button>
      </div>
    `;
    container.appendChild(el);
  });
}

// --- Player Management (mostly unchanged) ---
async function addPlayer() {
  const name = document.getElementById("playerNameInput").value;
  if (!name) {
    showToast("Please enter a name", "error");
    return;
  }

  await fetch("/add-player", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });

  document.getElementById("playerNameInput").value = "";
  loadPlayers();
}

async function removePlayer(token) {
  await fetch("/remove-player", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  loadPlayers();
}

async function loadPlayers() {
  const res = await fetch("/players");
  players = await res.json();
  const container = document.getElementById("playersList");
  container.innerHTML = "";

  players.forEach((player) => {
    const el = document.createElement("div");
    el.className = "bg-gray-50 rounded-lg p-4 border border-gray-200";
    el.innerHTML = `
      <div class="flex justify-between items-start mb-3">
        <strong class="text-lg text-gray-800">${player.name}</strong>
        <button 
          onclick="removePlayer('${player.token}')"
          class="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
        >
          Remove
        </button>
      </div>
      <div class="space-y-2">
        <div>
          <span class="text-sm text-gray-600">Token:</span>
          <code class="block mt-1 px-3 py-2 bg-gray-100 rounded text-sm font-mono">${player.token}</code>
        </div>
        <div>
          <span class="text-sm text-gray-600">Dynmap URL:</span>
          <code class="block mt-1 px-3 py-2 bg-gray-100 rounded text-sm font-mono">${window.location.origin}/update-position/${player.token}</code>
        </div>
      </div>
    `;
    container.appendChild(el);
  });
}

// --- Log Management ---
function updateLogSelector() {
  const selector = document.getElementById("logSelector");
  const previousValue = selector.value;
  selector.innerHTML = "";

  worlds
    .filter((w) => w.status !== "STOPPED")
    .forEach((world) => {
      const option = document.createElement("option");
      option.value = world.id;
      option.textContent = world.name;
      selector.appendChild(option);
    });

  if (selector.options.length > 0) {
    if (
      previousValue &&
      [...selector.options].some((o) => o.value === previousValue)
    ) {
      selector.value = previousValue;
    } else {
      selector.value = selector.options[0].value;
    }
  }

  if (selectedLogWorldId !== selector.value) {
    selectedLogWorldId = selector.value;
    displayLogs();
  }
}

function updateStatusIndicator(elementId, isActive) {
  const element = document.getElementById(elementId);
  element.className = `w-3 h-3 rounded-full ${
    isActive ? "bg-green-500" : "bg-red-500"
  }`;
}

let lastServerUptime = 0;
let lastUptimeSync = null;
let uptimeInterval = null;

function formatUptime(seconds) {
  if (!seconds) return "-";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hours}h ${minutes}m ${secs}s`;
}

function startUptimeTicker() {
  if (uptimeInterval) clearInterval(uptimeInterval);
  uptimeInterval = setInterval(() => {
    if (lastUptimeSync) {
      const now = Date.now();
      const elapsed = Math.floor((now - lastUptimeSync) / 1000);
      document.getElementById("uptime").textContent = formatUptime(
        lastServerUptime + elapsed
      );
    }
  }, 1000);
}

async function updateServerStatus() {
  try {
    const res = await fetch("/health");
    const status = await res.json();

    updateStatusIndicator("runningStatus", status.isRunning);
    updateStatusIndicator("initializedStatus", status.isInitialized);

    lastServerUptime = status.uptime;
    lastUptimeSync = Date.now();
    document.getElementById("uptime").textContent = formatUptime(status.uptime);
    startUptimeTicker();
  } catch (err) {
    console.error("Failed to fetch server status:", err);
    updateStatusIndicator("runningStatus", false);
    updateStatusIndicator("initializedStatus", false);
    document.getElementById("uptime").textContent = "-";
    if (uptimeInterval) clearInterval(uptimeInterval);
  }
}

// Initialize the page
document.addEventListener("DOMContentLoaded", () => {
  // Connect to WebSocket for log streaming
  connectWebSocket();

  // Update worlds list periodically
  setInterval(loadWorlds, 5000);

  // Initial loads
  loadWorlds();
  loadPlayers();

  document.getElementById("logSelector").addEventListener("change", (e) => {
    selectedLogWorldId = e.target.value;
    displayLogs();
  });
});

// WebSocket connection for log streaming
let ws = null;

function connectWebSocket() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log("WebSocket connected for log streaming");
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      if (data.type === "initial_logs") {
        Object.entries(data.logs).forEach(([worldId, logArray]) => {
          logs.set(parseInt(worldId, 10), logArray);
        });
        displayLogs();
      } else if (data.type === "log_entry") {
        if (!logs.has(data.worldId)) {
          logs.set(data.worldId, []);
        }
        logs.get(data.worldId).push(data.log);
        if (String(data.worldId) === selectedLogWorldId) {
          addLogEntryToView(data.log);
        }
      }
    } catch (error) {
      console.error("Error parsing WebSocket message:", error);
    }
  };

  ws.onclose = () => {
    console.log("WebSocket disconnected, attempting to reconnect...");
    setTimeout(connectWebSocket, 3000);
  };

  ws.onerror = (error) => {
    console.error("WebSocket error:", error);
  };
}

function displayLogs() {
  const logContent = document.getElementById("logContent");
  logContent.innerHTML = "";

  const worldLogs = logs.get(parseInt(selectedLogWorldId, 10));
  if (!worldLogs) return;

  worldLogs.forEach((log) => {
    addLogEntryToView(log);
  });

  if (autoScroll) {
    scrollToBottom();
  }
}

function addLogEntryToView(log) {
  const logContent = document.getElementById("logContent");
  const logLine = document.createElement("div");
  logLine.className = `log-line ${log.type === "error" ? "text-red-400" : ""}`;
  logLine.textContent = `[${new Date(log.timestamp).toLocaleTimeString()}] ${
    log.message
  }`;
  logContent.appendChild(logLine);

  if (autoScroll) {
    scrollToBottom();
  }
}

function scrollToBottom() {
  const logContainer = document.getElementById("logContainer");
  logContainer.scrollTop = logContainer.scrollHeight;
}

function clearLogs() {
  if (!selectedLogWorldId) return;
  logs.set(parseInt(selectedLogWorldId, 10), []);
  displayLogs();
  showToast("Logs for selected world cleared", "info");
}

function toggleAutoScroll() {
  autoScroll = !autoScroll;
  const autoScrollBtn = document.getElementById("autoScrollBtn");
  autoScrollBtn.textContent = `Auto-scroll: ${autoScroll ? "ON" : "OFF"}`;
  autoScrollBtn.className = `px-3 py-1 text-sm ${
    autoScroll
      ? "bg-blue-600 hover:bg-blue-700"
      : "bg-gray-600 hover:bg-gray-700"
  } text-white rounded focus:outline-none focus:ring-2 focus:ring-offset-2`;

  if (autoScroll) {
    scrollToBottom();
  }
}

async function sendCommand() {
  const input = document.getElementById("commandInput");
  const command = input.value.trim();
  if (!command) return;
  if (!selectedLogWorldId) {
    showToast("Select a running world to send a command to.", "error");
    return;
  }
  try {
    const res = await fetch("/send-command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command, worldId: selectedLogWorldId }),
    });
    if (res.ok) {
      showToast(`Command sent: ${command}`, "success");
      input.value = "";
    } else {
      const err = await res.json();
      showToast(`Error: ${err.error}`, "error");
    }
  } catch (e) {
    showToast(`Error: ${e.message}`, "error");
  }
}
