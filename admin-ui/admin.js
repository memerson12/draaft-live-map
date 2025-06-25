function updateStartButtonState() {
  const seedInput = document.getElementById("seedInput");
  const startButton = document.getElementById("startServerBtn");
  startButton.disabled = !seedInput.value.trim();
}

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

async function startServer() {
  const seed = document.getElementById("seedInput").value;
  showToast("Starting server...", "info");
  const res = await fetch("/start-server", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seed }),
  });
  if (res.ok) {
    showToast("Server started successfully", "success");
    loadPlayers();
  } else {
    const err = await res.json();
    showToast(`Error: ${err.error}`, "error");
  }
}

async function stopServer() {
  const res = await fetch("/stop-server", { method: "POST" });
  if (res.ok) {
    showToast("Server stopped and cleaned up", "success");
    loadPlayers();
    clearLogs();
  } else {
    const err = await res.json();
    showToast(`Error: ${err.error}`, "error");
  }
}

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
  const players = await res.json();
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
          <code class="block mt-1 px-3 py-2 bg-gray-100 rounded text-sm font-mono">${window.location.origin}/map?token=${player.token}</code>
        </div>
      </div>
    `;
    container.appendChild(el);
  });
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

  // Update status every 10 seconds
  setInterval(updateServerStatus, 10000);
  // Initial status check
  updateServerStatus();
  loadPlayers();
});

// WebSocket connection for log streaming
let ws = null;
let autoScroll = true;
let logBuffer = [];

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
        logBuffer = data.logs;
        displayLogs();
      } else if (data.type === "log_entry") {
        logBuffer.push(data.log);
        addLogEntry(data.log);
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

  logBuffer.forEach((log) => {
    const logLine = document.createElement("div");
    logLine.className = "log-line";
    logLine.textContent = `[${new Date(log.timestamp).toLocaleTimeString()}] ${
      log.message
    }`;
    logContent.appendChild(logLine);
  });

  if (autoScroll) {
    scrollToBottom();
  }
}

function addLogEntry(log) {
  const logContent = document.getElementById("logContent");
  const logLine = document.createElement("div");
  logLine.className = "log-line";
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
  logBuffer = [];
  displayLogs();
  showToast("Logs cleared", "info");
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
