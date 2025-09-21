const DEFAULT_DELAY_SECONDS = 2.5;
const DEFAULT_MAX_RETRIES = 2;
const MAX_RETRIES_LIMIT = 5;

const startButton = document.getElementById("start");
const stopButton = document.getElementById("stop");
const statusElement = document.getElementById("status");
const progressElement = document.getElementById("progress");
const errorsElement = document.getElementById("errors");
const delayInput = document.getElementById("delay");
const retriesInput = document.getElementById("retries");
const lastDoctorElement = document.getElementById("last-doctor");
const retryElement = document.getElementById("retry");

stopButton.disabled = true;
errorsElement.style.display = "none";
lastDoctorElement.style.display = "none";
retryElement.style.display = "none";
progressElement.textContent = "";

function updateButtons(isScraping) {
  startButton.disabled = !!isScraping;
  stopButton.disabled = !isScraping;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function parseDelayInput() {
  const value = parseFloat(delayInput.value);
  if (!Number.isFinite(value) || value < 0) {
    return DEFAULT_DELAY_SECONDS;
  }
  return Math.round(value * 100) / 100;
}

function parseRetriesInput() {
  const value = parseInt(retriesInput.value, 10);
  if (!Number.isFinite(value) || value < 0) {
    return DEFAULT_MAX_RETRIES;
  }
  return clamp(Math.round(value), 0, MAX_RETRIES_LIMIT);
}

function formatErrors(errors = []) {
  if (!Array.isArray(errors) || !errors.length) {
    return "";
  }
  return errors
    .map((error) => {
      if (!error) {
        return "";
      }
      if (typeof error === "string") {
        return `• ${error}`;
      }
      const parts = [];
      if (error.url && error.url !== "global") {
        parts.push(error.url);
      }
      if (error.message) {
        parts.push(error.message);
      }
      const text = parts.join(" - ") || "Unknown error";
      return `• ${text}`;
    })
    .filter(Boolean)
    .join("\n");
}

function formatDelaySeconds(delayMs) {
  const seconds = Math.max(0, Number(delayMs ?? DEFAULT_DELAY_SECONDS * 1000) / 1000);
  return (Math.round(seconds * 100) / 100).toString();
}

function setDelayInputValue(delayMs) {
  if (document.activeElement === delayInput) {
    return;
  }
  delayInput.value = formatDelaySeconds(delayMs);
}

function setRetriesInputValue(retries) {
  if (document.activeElement === retriesInput) {
    return;
  }
  const value = Number.isFinite(retries) ? clamp(Math.round(retries), 0, MAX_RETRIES_LIMIT) : DEFAULT_MAX_RETRIES;
  retriesInput.value = value.toString();
}

function renderLastDoctor(lastDoctor) {
  if (!lastDoctor || (!lastDoctor.name && !lastDoctor.url)) {
    lastDoctorElement.textContent = "";
    lastDoctorElement.style.display = "none";
    return;
  }

  lastDoctorElement.textContent = "";
  const label = document.createElement("span");
  label.textContent = "Last profile: ";
  lastDoctorElement.appendChild(label);

  if (lastDoctor.url) {
    const link = document.createElement("a");
    link.href = lastDoctor.url;
    link.textContent = lastDoctor.name || lastDoctor.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    lastDoctorElement.appendChild(link);
  } else if (lastDoctor.name) {
    lastDoctorElement.append(lastDoctor.name);
  }

  lastDoctorElement.style.display = "block";
}

function applyStatus(status) {
  if (!status) {
    statusElement.textContent = "Status: Unknown";
    progressElement.textContent = "";
    retryElement.textContent = "";
    retryElement.style.display = "none";
    lastDoctorElement.textContent = "";
    lastDoctorElement.style.display = "none";
    errorsElement.textContent = "";
    errorsElement.style.display = "none";
    updateButtons(false);
    return;
  }

  const isScraping = Boolean(status.isScraping);
  const message = status.message || (isScraping ? "Scraping in progress..." : "Idle.");
  statusElement.textContent = `Status: ${message}`;

  const total = Number(status.total) || 0;
  const processed = Number(status.processed) || 0;
  const pending = status.pending !== undefined ? Number(status.pending) : Math.max(total - processed, 0);

  if (total > 0) {
    const percentage = Math.min(100, Math.max(0, (processed / total) * 100));
    const percentText = `${percentage.toFixed(1)}%`;
    const progressParts = [`Progress: ${processed} / ${total} (${percentText})`];
    if (pending > 0) {
      progressParts.push(`Pending: ${pending}`);
    }
    progressElement.textContent = progressParts.join(" · ");
  } else {
    progressElement.textContent = "";
  }

  const errorText = formatErrors(status.errors);
  if (errorText) {
    const errorCount = Array.isArray(status.errors) ? status.errors.length : 0;
    errorsElement.textContent = `Errors (${errorCount}):\n${errorText}`;
    errorsElement.style.display = "block";
  } else {
    errorsElement.textContent = "";
    errorsElement.style.display = "none";
  }

  if (status.retrying && status.retrying.attempt && status.retrying.total) {
    retryElement.textContent = `Retrying current profile (${status.retrying.attempt} / ${status.retrying.total})...`;
    retryElement.style.display = "block";
  } else {
    retryElement.textContent = "";
    retryElement.style.display = "none";
  }

  renderLastDoctor(status.lastDoctor);
  setDelayInputValue(status.delayMs);
  setRetriesInputValue(status.maxRetries);

  updateButtons(isScraping);
}

function sendAction(action, payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action, payload }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ status: "error", message: chrome.runtime.lastError.message });
        return;
      }
      resolve(response);
    });
  });
}

async function persistConfig() {
  const delaySeconds = parseDelayInput();
  const maxRetries = parseRetriesInput();
  delayInput.value = delaySeconds.toString();
  retriesInput.value = maxRetries.toString();

  await sendAction("updateConfig", {
    delayMs: Math.round(delaySeconds * 1000),
    maxRetries,
  });
}

async function refreshStatus() {
  const response = await sendAction("getStatus");
  if (response?.status === "ok") {
    applyStatus(response.data);
  } else if (response?.status === "error") {
    statusElement.textContent = `Status: ${response.message}`;
    updateButtons(false);
  }
}

startButton.addEventListener("click", async () => {
  updateButtons(true);
  const delaySeconds = parseDelayInput();
  const maxRetries = parseRetriesInput();

  delayInput.value = delaySeconds.toString();
  retriesInput.value = maxRetries.toString();

  const response = await sendAction("startScraping", {
    delayMs: Math.round(delaySeconds * 1000),
    maxRetries,
  });

  if (!response) {
    statusElement.textContent = "Status: Failed to communicate with background script.";
    updateButtons(false);
    return;
  }

  if (response.status === "started") {
    statusElement.textContent = "Status: Scraping started.";
  } else if (response.status === "no-links") {
    statusElement.textContent = "Status: No doctor links found on this page.";
    updateButtons(false);
  } else if (response.status === "already-running") {
    statusElement.textContent = "Status: Scraping is already running.";
  } else if (response.status === "error") {
    statusElement.textContent = `Status: ${response.message}`;
    updateButtons(false);
  }

  await refreshStatus();
});

stopButton.addEventListener("click", async () => {
  startButton.disabled = true;
  stopButton.disabled = true;

  const response = await sendAction("stopScraping");

  if (response?.status === "stopping") {
    statusElement.textContent = "Status: Stop requested. Waiting for the current profile...";
  } else if (response?.status === "idle") {
    statusElement.textContent = "Status: Idle.";
  } else if (response?.status === "error") {
    statusElement.textContent = `Status: ${response.message}`;
  }

  await refreshStatus();
});

delayInput.addEventListener("change", () => {
  persistConfig().catch(() => {});
});

retriesInput.addEventListener("change", () => {
  persistConfig().catch(() => {});
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "SCRAPE_STATUS") {
    applyStatus(message.payload);
  }
});

refreshStatus();
