const fs = require("fs-extra");
const path = require("path");
const { spawn } = require("child_process");

// Constants
const TEMPLATE_DIR = path.join(__dirname, "server_template");
const SERVER_DIR = path.join(__dirname, "server_instance");
const DYNMAP_PORT = 8123;

// Server State Management
let serverProcess = null;
let heartbeatInterval = null;
let serverStatus = {
  isRunning: false,
  isInitialized: false,
  startTime: null,
  lastHealthCheck: null,
  lastHeartbeat: null,
  pendingHeartbeat: false,
};

// Minecraft Server Configuration
function generateServerProperties(seed) {
  return `
level-seed=${seed}
server-port=25565
query.port=25565
webserver-port=${DYNMAP_PORT}
motd=Dynmap Competition Server
online-mode=false
max-players=4
white-list=false
allow-nether=false
enable-command-block=false
spawn-animals=false
spawn-npcs=false
spawn-monsters=false
enable-rcon=false
`;
}

// Server Health Monitoring
function sendHeartbeat() {
  if (
    serverProcess &&
    serverStatus.isRunning &&
    !serverStatus.pendingHeartbeat
  ) {
    serverProcess.stdin.write("list\n");
    serverStatus.pendingHeartbeat = true;
    setTimeout(() => {
      if (serverStatus.pendingHeartbeat) {
        serverStatus.pendingHeartbeat = false;
        console.log("Heartbeat timeout - no response received");
      }
    }, 5000);
  }
}

// Server Process Management
async function stopAndCleanup() {
  console.log("Stopping and cleaning up server...");
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }

  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }

  serverStatus.isRunning = false;
  serverStatus.isInitialized = false;
  serverStatus.pendingHeartbeat = false;

  await new Promise((resolve) => setTimeout(resolve, 500));

  let retries = 3;
  while (retries > 0) {
    try {
      await fs.remove(SERVER_DIR);
      console.log("Successfully cleaned up server_instance folder.");
      return;
    } catch (err) {
      retries--;
      if (retries === 0) {
        console.error(
          "Failed to clean up server_instance after multiple attempts:",
          err
        );
        throw err;
      }
      console.log(
        `Cleanup attempt failed, retrying... (${retries} attempts remaining)`
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

async function startServer(seed) {
  await fs.copy(TEMPLATE_DIR, SERVER_DIR);
  await fs.writeFile(
    path.join(SERVER_DIR, "server.properties"),
    generateServerProperties(seed)
  );

  // Create a promise that resolves when the server is initialized
  const initializationPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Server initialization timed out after 2 minutes"));
    }, 120000); // 2 minute timeout

    let initializationCheckInterval = null;

    serverProcess = spawn(
      "java",
      ["-Xmx2G", "-jar", "paper-server-launcher.jar", "nogui"],
      {
        cwd: SERVER_DIR,
        stdio: ["pipe", "pipe", "inherit"],
      }
    );

    serverStatus = {
      isRunning: true,
      isInitialized: false,
      startTime: new Date(),
      lastHealthCheck: new Date(),
      lastHeartbeat: new Date(),
      pendingHeartbeat: false,
    };

    heartbeatInterval = setInterval(sendHeartbeat, 15000);

    // Function to check if server is initialized
    const checkInitialization = () => {
      if (serverStatus.isInitialized) {
        clearInterval(initializationCheckInterval);
        clearTimeout(timeout);
        resolve();
      }
    };

    // Start checking initialization status every 500ms
    initializationCheckInterval = setInterval(checkInitialization, 500);

    serverProcess.on("error", (err) => {
      console.error("Failed to start server process:", err);
      serverProcess = null;
      serverStatus.isRunning = false;
      serverStatus.isInitialized = false;
      serverStatus.pendingHeartbeat = false;
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
      if (initializationCheckInterval) {
        clearInterval(initializationCheckInterval);
        initializationCheckInterval = null;
      }
      clearTimeout(timeout);
      reject(err);
    });

    serverProcess.on("exit", (code, signal) => {
      if (code !== 0) {
        console.error(
          `Server process exited with code ${code} and signal ${signal}`
        );
        serverProcess = null;
        serverStatus.isRunning = false;
        serverStatus.isInitialized = false;
        serverStatus.pendingHeartbeat = false;
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }
        if (initializationCheckInterval) {
          clearInterval(initializationCheckInterval);
          initializationCheckInterval = null;
        }
        clearTimeout(timeout);
        reject(new Error(`Server process exited with code ${code}`));
      }
    });

    serverProcess.stdout.on("data", (data) => {
      const output = data.toString();
      if (output.includes(`! For help, type "help"`)) {
        serverStatus.isInitialized = true;
        console.log("Minecraft server fully initialized");
      }
      serverStatus.lastHealthCheck = new Date();

      if (serverStatus.pendingHeartbeat && output.includes("players online")) {
        serverStatus.lastHeartbeat = new Date();
        serverStatus.pendingHeartbeat = false;
        console.log("Heartbeat successful");
      }
    });
  });

  return initializationPromise;
}

function getServerStatus() {
  const currentTime = new Date();
  const uptime = serverStatus.startTime
    ? (currentTime - serverStatus.startTime) / 1000
    : 0;

  const isResponsive =
    serverStatus.lastHealthCheck &&
    currentTime - serverStatus.lastHealthCheck < 30000;

  const isHeartbeatResponsive =
    serverStatus.lastHeartbeat &&
    currentTime - serverStatus.lastHeartbeat < 30000 &&
    !serverStatus.pendingHeartbeat;

  return {
    isRunning: serverStatus.isRunning,
    isInitialized: serverStatus.isInitialized,
    isResponsive,
    isHeartbeatResponsive,
    uptime: Math.floor(uptime),
    startTime: serverStatus.startTime,
    lastHealthCheck: serverStatus.lastHealthCheck,
    lastHeartbeat: serverStatus.lastHeartbeat,
    pendingHeartbeat: serverStatus.pendingHeartbeat,
  };
}

module.exports = {
  startServer,
  stopAndCleanup,
  getServerStatus,
  DYNMAP_PORT,
};
