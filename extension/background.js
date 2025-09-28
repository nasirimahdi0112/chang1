import { downloadCsv } from "./csv-export.js";

const STATUS_STORAGE_KEY = "nobatDoctorScraperStatus";
const CONFIG_STORAGE_KEY = "nobatDoctorScraperConfig";
const DEFAULT_CONFIG = {
  delayMs: 2500,
  maxRetries: 2,
};
const MAX_RETRY_LIMIT = 5;

const DIGIT_MAP = {
  "۰": "0",
  "۱": "1",
  "۲": "2",
  "۳": "3",
  "۴": "4",
  "۵": "5",
  "۶": "6",
  "۷": "7",
  "۸": "8",
  "۹": "9",
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
};

const state = {
  isScraping: false,
  queue: [],
  results: [],
  currentIndex: 0,
  listTabId: null,
  listWindowId: null,
  listTabIndex: null,
  scraperTabId: null,
  delayMs: DEFAULT_CONFIG.delayMs,
  maxRetries: DEFAULT_CONFIG.maxRetries,
  errors: [],
  lastDoctor: null,
  retrying: null,
  stopRequested: false,
  visited: new Set(),
};

let autoDiscardableSettingSupported = true;

let resolveConfigReady;
const configReady = new Promise((resolve) => {
  resolveConfigReady = resolve;
});

function convertLocaleDigits(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value).replace(/[٠-٩۰-۹]/g, (digit) => DIGIT_MAP[digit] ?? digit);
}

function normaliseWhitespace(value) {
  return convertLocaleDigits(value)
    .replace(/\u200c/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseText(value) {
  return normaliseWhitespace(value);
}

function normalisePhoneValue(value) {
  const text = normaliseWhitespace(value);
  if (!text) {
    return "";
  }
  return text;
}

function phoneKey(_, value) {
  return convertLocaleDigits(value).replace(/[^0-9+]/g, "");
}

function collectValues(...values) {
  const buffer = [];
  values.forEach((value) => {
    if (Array.isArray(value)) {
      buffer.push(...value);
    } else if (value !== undefined && value !== null) {
      buffer.push(value);
    }
  });
  return buffer;
}

function uniqueNormalisedList(values, transform = normaliseText, keyFn) {
  const seen = new Set();
  const output = [];

  values.forEach((value) => {
    const transformed = transform ? transform(value) : value;
    if (!transformed) {
      return;
    }
    const key = keyFn ? keyFn(value, transformed) : transformed;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    output.push(transformed);
  });

  return output;
}

function toNormalisedList(...values) {
  return uniqueNormalisedList(collectValues(...values));
}

function toNormalisedPhoneList(...values) {
  return uniqueNormalisedList(collectValues(...values), normalisePhoneValue, phoneKey);
}

function normaliseOfficeList(offices) {
  if (!Array.isArray(offices)) {
    return [];
  }

  const normalised = [];
  const seen = new Set();

  offices.forEach((office) => {
    if (!office || typeof office !== "object") {
      return;
    }

    const city = normaliseText(office.city || "");
    const addresses = toNormalisedList(office.addresses, office.address);
    const phones = toNormalisedPhoneList(office.phones, office.phone);

    if (!city && !addresses.length && !phones.length) {
      return;
    }

    const key = `${city}||${addresses.join("||")}||${phones.join("||")}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);

    normalised.push({ city, addresses, phones });
  });

  return normalised;
}

function cleanDoctorCode(rawValue) {
  const text = normaliseText(rawValue);
  if (!text) {
    return "";
  }
  const digits = text.replace(/[^0-9]/g, "");
  return digits || text;
}

function normaliseDoctorData(data = {}, url) {
  const offices = normaliseOfficeList(data.offices);
  const addresses = toNormalisedList(
    data.addresses,
    data.address,
    offices.flatMap((office) => office.addresses)
  );
  const phones = toNormalisedPhoneList(
    data.phones,
    data.phone,
    offices.flatMap((office) => office.phones)
  );

  const resolvedUrl = typeof url === "string" && url.length ? url : data.url || "";

  const resolvedCity = normaliseText(
    data.city || offices.find((office) => office.city)?.city || ""
  );

  return {
    url: resolvedUrl,
    name: normaliseText(data.name || ""),
    specialty: normaliseText(data.specialty || ""),
    code: cleanDoctorCode(data.code || data.doctorCode || ""),
    city: resolvedCity,
    address: addresses,
    phones,
    offices,
  };
}

function normaliseDoctorProfileUrl(rawUrl) {
  if (!rawUrl) {
    return null;
  }
  try {
    const url = new URL(rawUrl, "https://nobat.ir/");
    if (!/(^|\.)nobat\.ir$/i.test(url.hostname)) {
      return null;
    }
    url.protocol = "https:";
    url.hash = "";
    return url.toString();
  } catch (error) {
    return null;
  }
}

function isNobatDoctorHost(url) {
  if (!url) {
    return false;
  }
  try {
    const parsed = new URL(url);
    return /(^|\.)nobat\.ir$/i.test(parsed.hostname);
  } catch (error) {
    return false;
  }
}

function ensureDelay(value, fallback = state.delayMs ?? DEFAULT_CONFIG.delayMs) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return Math.max(0, Math.round(fallback));
  }
  return Math.max(0, Math.round(numeric));
}

function ensureRetries(value, fallback = state.maxRetries ?? DEFAULT_CONFIG.maxRetries) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return Math.max(0, Math.round(fallback));
  }
  return Math.min(MAX_RETRY_LIMIT, Math.max(0, Math.round(numeric)));
}

async function loadPersistedConfig() {
  try {
    const stored = await chrome.storage.local.get(CONFIG_STORAGE_KEY);
    const persisted = stored?.[CONFIG_STORAGE_KEY];
    const delay = ensureDelay(persisted?.delayMs, DEFAULT_CONFIG.delayMs);
    const retries = ensureRetries(persisted?.maxRetries, DEFAULT_CONFIG.maxRetries);
    state.delayMs = delay;
    state.maxRetries = retries;
    if (!persisted || persisted.delayMs !== delay || persisted.maxRetries !== retries) {
      await chrome.storage.local.set({
        [CONFIG_STORAGE_KEY]: { delayMs: delay, maxRetries: retries },
      });
    }
  } catch (error) {
    console.error("Failed to load persisted configuration", error);
    state.delayMs = DEFAULT_CONFIG.delayMs;
    state.maxRetries = DEFAULT_CONFIG.maxRetries;
  } finally {
    if (typeof resolveConfigReady === "function") {
      resolveConfigReady();
      resolveConfigReady = null;
    }
  }
}

loadPersistedConfig();

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function queryActiveTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(tabs[0]);
    });
  });
}

function createTab(createProperties) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create(createProperties, (tab) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(tab);
    });
  });
}

function updateTab(tabId, updateProperties) {
  return new Promise((resolve, reject) => {
    chrome.tabs.update(tabId, updateProperties, (tab) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(tab);
    });
  });
}

function getTab(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(tab);
    });
  });
}

function isAutoDiscardablePropertyError(error) {
  if (!error || typeof error.message !== "string") {
    return false;
  }
  return (
    error.message.includes("Unexpected property") &&
    error.message.includes("autoDiscardable")
  );
}

async function setTabAutoDiscardable(tabId, autoDiscardable) {
  if (!autoDiscardableSettingSupported) {
    return;
  }

  try {
    await updateTab(tabId, { autoDiscardable });
  } catch (error) {
    if (isAutoDiscardablePropertyError(error)) {
      autoDiscardableSettingSupported = false;
      console.warn(
        "autoDiscardable tab property is not supported in this browser. Continuing without it.",
        error
      );
      return;
    }
    throw error;
  }
}

function removeTab(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.remove(tabId, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

function injectContentScript(tabId) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(
      {
        target: { tabId },
        files: ["content-script.js"],
      },
      () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      }
    );
  });
}

function sendMessageToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        const error = new Error(chrome.runtime.lastError.message);
        if (tabId === state.scraperTabId && /No tab with id/i.test(error.message)) {
          state.scraperTabId = null;
        }
        reject(error);
        return;
      }
      resolve(response);
    });
  });
}

async function waitForTabLoad(tabId, timeoutMs = 45000) {
  async function getExistingTab() {
    try {
      return await getTab(tabId);
    } catch (error) {
      if (/No tab with id/i.test(error.message)) {
        return null;
      }
      throw error;
    }
  }

  const initialTab = await getExistingTab();
  if (!initialTab) {
    throw new Error("The tab was closed before loading completed.");
  }

  if (initialTab.status === "complete") {
    return;
  }

  await new Promise((resolve, reject) => {
    let finished = false;

    const timeout = setTimeout(() => {
      if (!finished) {
        finished = true;
        cleanup();
        reject(new Error("Timed out while waiting for the page to finish loading."));
      }
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(handleUpdate);
      chrome.tabs.onRemoved.removeListener(handleRemoval);
    }

    function finish(error) {
      if (finished) {
        return;
      }
      finished = true;
      cleanup();
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    }

    async function checkTabStatus() {
      if (finished) {
        return;
      }
      let tab;
      try {
        tab = await getExistingTab();
      } catch (error) {
        finish(error);
        return;
      }
      if (!tab) {
        finish(new Error("The tab was closed before loading completed."));
        return;
      }
      if (tab.status === "complete") {
        finish();
      }
    }

    function handleUpdate(updatedTabId, changeInfo) {
      if (updatedTabId !== tabId || finished) {
        return;
      }
      if (changeInfo.status === "complete") {
        finish();
      } else if (changeInfo.status === "loading") {
        // Ignore loading updates.
      } else if (changeInfo.url !== undefined) {
        checkTabStatus();
      }
    }

    function handleRemoval(removedTabId) {
      if (removedTabId !== tabId) {
        return;
      }
      finish(new Error("The tab was closed before loading completed."));
    }

    chrome.tabs.onUpdated.addListener(handleUpdate);
    chrome.tabs.onRemoved.addListener(handleRemoval);

    checkTabStatus();
  });
}

function clearError(url) {
  if (!state.errors.length) {
    return;
  }
  state.errors = state.errors.filter((error) => error.url !== url);
}

function recordError(url, message, extra = {}) {
  if (!message) {
    clearError(url);
    return;
  }
  clearError(url);
  state.errors.push({ url, message, ...extra });
}

async function updateStatus(partial = {}) {
  await configReady;

  const total = state.queue.length;
  const processed = Math.min(state.currentIndex, total);
  const pending = Math.max(total - processed, 0);

  const status = {
    isScraping: state.isScraping,
    total,
    processed,
    pending,
    errors: state.errors.map((error) => ({ ...error })),
    delayMs: state.delayMs,
    maxRetries: state.maxRetries,
    lastDoctor: state.lastDoctor ? { ...state.lastDoctor } : null,
    retrying: state.retrying ? { ...state.retrying } : null,
    message: partial.message ?? (state.isScraping ? "Scraping in progress..." : "Idle."),
  };

  if (partial.total !== undefined) {
    status.total = partial.total;
  }
  if (partial.processed !== undefined) {
    status.processed = partial.processed;
  }
  if (partial.pending !== undefined) {
    status.pending = partial.pending;
  }
  if (partial.errors) {
    status.errors = partial.errors;
  }
  if (partial.lastDoctor) {
    status.lastDoctor = partial.lastDoctor;
  }
  if (partial.retrying) {
    status.retrying = partial.retrying;
  }

  try {
    await chrome.storage.local.set({ [STATUS_STORAGE_KEY]: status });
  } catch (error) {
    console.warn("Failed to persist status", error);
  }

  try {
    chrome.runtime.sendMessage({ type: "SCRAPE_STATUS", payload: status });
  } catch (error) {
    // The popup might not be open; ignore the error.
  }
}

async function applyConfig(partialConfig = {}, { persist = false } = {}) {
  await configReady;
  const updated = {
    delayMs: state.delayMs,
    maxRetries: state.maxRetries,
  };

  if (partialConfig.delayMs !== undefined) {
    updated.delayMs = ensureDelay(partialConfig.delayMs, updated.delayMs);
  }
  if (partialConfig.maxRetries !== undefined) {
    updated.maxRetries = ensureRetries(partialConfig.maxRetries, updated.maxRetries);
  }

  state.delayMs = updated.delayMs;
  state.maxRetries = updated.maxRetries;

  if (persist) {
    try {
      await chrome.storage.local.set({
        [CONFIG_STORAGE_KEY]: {
          delayMs: state.delayMs,
          maxRetries: state.maxRetries,
        },
      });
    } catch (error) {
      console.warn("Failed to persist configuration", error);
    }
  }

  return { delayMs: state.delayMs, maxRetries: state.maxRetries };
}

async function getDoctorLinksFromTab(tabId) {
  let response;
  try {
    response = await sendMessageToTab(tabId, { type: "GET_DOCTOR_LINKS" });
  } catch (error) {
    if (/Receiving end does not exist/i.test(error.message)) {
      await injectContentScript(tabId);
      response = await sendMessageToTab(tabId, { type: "GET_DOCTOR_LINKS" });
    } else {
      throw error;
    }
  }

  if (response?.error) {
    throw new Error(response.error);
  }

  const rawLinks = Array.isArray(response?.links) ? response.links : [];
  const unique = [];
  const seen = new Set();

  rawLinks.forEach((link) => {
    const normalised = normaliseDoctorProfileUrl(link);
    if (normalised && !seen.has(normalised)) {
      seen.add(normalised);
      unique.push(normalised);
    }
  });

  return unique;
}

async function createScraperTab(url) {
  const createOptions = {
    url,
    active: false,
  };

  if (Number.isInteger(state.listWindowId)) {
    createOptions.windowId = state.listWindowId;
  }
  if (Number.isInteger(state.listTabIndex)) {
    createOptions.index = state.listTabIndex;
  }

  const tab = await createTab(createOptions);
  state.scraperTabId = tab.id;
  if (typeof tab?.id === "number") {
    await setTabAutoDiscardable(tab.id, true);
  }
  await waitForTabLoad(tab.id);
  return tab.id;
}

async function ensureScraperTab(url) {
  const targetUrl = normaliseDoctorProfileUrl(url);
  if (!targetUrl) {
    throw new Error("Invalid doctor profile URL provided.");
  }

  if (state.scraperTabId) {
    try {
      await updateTab(state.scraperTabId, { url: targetUrl, active: false });
      if (Number.isInteger(state.scraperTabId)) {
        await setTabAutoDiscardable(state.scraperTabId, true);
      }
      await waitForTabLoad(state.scraperTabId);
      return state.scraperTabId;
    } catch (error) {
      console.warn("Failed to reuse existing scraper tab", error);
      try {
        await cleanupScraperTab();
      } catch (cleanupError) {
        console.warn("Failed to clean up scraper tab", cleanupError);
      }
    }
  }

  return createScraperTab(targetUrl);
}

async function cleanupScraperTab() {
  if (!state.scraperTabId) {
    return;
  }
  const tabId = state.scraperTabId;
  state.scraperTabId = null;
  try {
    await removeTab(tabId);
  } catch (error) {
    if (!/No tab with id/i.test(error.message)) {
      console.warn("Failed to remove scraper tab", error);
    }
  }
}

async function scrapeDoctorProfile(url) {
  const tabId = await ensureScraperTab(url);

  let response;
  try {
    response = await sendMessageToTab(tabId, { type: "SCRAPE_DOCTOR_DETAILS" });
  } catch (error) {
    if (/Receiving end does not exist/i.test(error.message)) {
      await injectContentScript(tabId);
      response = await sendMessageToTab(tabId, { type: "SCRAPE_DOCTOR_DETAILS" });
    } else {
      throw error;
    }
  }

  if (response?.error) {
    throw new Error(response.error);
  }

  if (!response || !response.data) {
    throw new Error("No data was returned from the doctor profile page.");
  }

  return normaliseDoctorData(response.data, url);
}

async function scrapeDoctorProfileWithRetries(url) {
  const attempts = Math.max(0, state.maxRetries) + 1;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      state.retrying = attempt > 1 ? { attempt, total: attempts, url } : null;
      if (state.retrying) {
        await updateStatus({
          retrying: { ...state.retrying },
          message: `Retrying current profile (${attempt} / ${attempts})...`,
        });
      }
      const data = await scrapeDoctorProfile(url);
      state.retrying = null;
      return data;
    } catch (error) {
      if (attempt >= attempts) {
        state.retrying = null;
        throw error;
      }
      console.warn(`Attempt ${attempt} failed for ${url}. Retrying...`, error);
      await delay(Math.max(state.delayMs, 1000));
    }
  }

  throw new Error("Failed to scrape doctor profile after retries.");
}

async function finaliseScraping({ partial = false } = {}) {
  const total = state.queue.length;
  const processed = Math.min(state.currentIndex, total);
  const pending = Math.max(total - processed, 0);

  await cleanupScraperTab();

  if (!state.results.length) {
    await updateStatus({
      message: partial
        ? "Scraping stopped before any data was collected."
        : "No data was collected.",
      isScraping: false,
      total,
      processed,
      pending,
    });
    resetState();
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:T]/g, "-").split(".")[0];
  const prefix = partial ? "nobat-doctors-partial" : "nobat-doctors";
  const filename = `${prefix}-${timestamp}.csv`;

  const rows = state.results.map((item) => ({
    url: item.url,
    name: item.name,
    specialty: item.specialty,
    code: item.code,
    city: item.city,
    address: item.address,
    phones: item.phones,
    offices: item.offices ?? [],
    error: item.error ?? null,
  }));

  try {
    await downloadCsv(filename, rows);
    await updateStatus({
      message: partial
        ? "Scraping stopped early. Partial CSV downloaded."
        : "Scraping completed.",
      isScraping: false,
      total,
      processed,
      pending,
    });
  } catch (error) {
    recordError("download", error.message);
    await updateStatus({
      message: `Failed to save CSV: ${error.message}`,
      isScraping: false,
      total,
      processed,
      pending,
    });
  }

  resetState();
}

function resetState() {
  state.isScraping = false;
  state.queue = [];
  state.results = [];
  state.currentIndex = 0;
  state.listTabId = null;
  state.listWindowId = null;
  state.listTabIndex = null;
  state.scraperTabId = null;
  state.errors = [];
  state.lastDoctor = null;
  state.retrying = null;
  state.stopRequested = false;
  state.visited = new Set();
}

async function processQueue() {
  while (state.isScraping && state.currentIndex < state.queue.length) {
    if (state.stopRequested) {
      break;
    }

    const url = state.queue[state.currentIndex];
    if (!url) {
      state.currentIndex += 1;
      continue;
    }

    if (state.visited.has(url)) {
      state.currentIndex += 1;
      await updateStatus({
        message: `Skipped duplicate link (${state.currentIndex} / ${state.queue.length}).`,
      });
      continue;
    }

    state.visited.add(url);

    try {
      const data = await scrapeDoctorProfileWithRetries(url);
      clearError(url);
      state.results.push({ ...data, error: null });
      state.lastDoctor = {
        name: data.name || data.url || url,
        url: data.url || url,
      };
    } catch (error) {
      console.error("Failed to scrape doctor page", url, error);
      const message = error?.message || "Unknown error";
      recordError(url, message);
      const fallbackData = normaliseDoctorData(
        {
          name: "",
          specialty: "",
          code: "",
          city: "",
          addresses: [],
          phones: [],
          offices: [],
        },
        url
      );
      state.results.push({ ...fallbackData, error: message });
      state.lastDoctor = {
        name: `${fallbackData.name || fallbackData.url || url} (failed)`,
        url: fallbackData.url || url,
      };
    }

    state.currentIndex += 1;

    await updateStatus({
      message: `Processed ${Math.min(state.currentIndex, state.queue.length)} of ${state.queue.length}`,
    });

    if (state.stopRequested || state.currentIndex >= state.queue.length) {
      break;
    }

    if (state.delayMs > 0) {
      await delay(state.delayMs);
    }
  }

  const partial = state.stopRequested;
  state.isScraping = false;
  state.stopRequested = false;

  try {
    await finaliseScraping({ partial });
  } catch (error) {
    console.error("Scraping finalisation failed", error);
    recordError("finalise", error.message);
    await cleanupScraperTab();
    await updateStatus({
      message: `Scraping finalisation failed: ${error.message}`,
      isScraping: false,
    });
    resetState();
  }
}

async function handleStartScraping(options = {}) {
  await configReady;

  if (state.isScraping) {
    return { status: "already-running" };
  }

  const activeTab = await queryActiveTab();
  if (!activeTab || !activeTab.id) {
    throw new Error("No active tab detected.");
  }
  if (!isNobatDoctorHost(activeTab.url)) {
    throw new Error("Please open a Nobat.ir doctors list page before starting.");
  }

  state.listTabId = activeTab.id;
  state.listWindowId = activeTab.windowId ?? null;
  state.listTabIndex = typeof activeTab.index === "number" ? activeTab.index + 1 : null;

  await cleanupScraperTab();

  await applyConfig(options, { persist: true });

  const links = await getDoctorLinksFromTab(state.listTabId);
  if (!links.length) {
    resetState();
    await updateStatus({
      message: "No doctor links found on this page.",
      isScraping: false,
      total: 0,
      processed: 0,
      pending: 0,
    });
    return { status: "no-links" };
  }

  state.queue = links.slice();
  state.results = [];
  state.currentIndex = 0;
  state.errors = [];
  state.lastDoctor = null;
  state.retrying = null;
  state.stopRequested = false;
  state.visited = new Set();
  state.isScraping = true;

  await updateStatus({
    message: `Found ${state.queue.length} doctor profiles. Starting...`,
    total: state.queue.length,
    processed: 0,
    pending: state.queue.length,
  });

  processQueue().catch(async (error) => {
    console.error("Scraping failed", error);
    recordError("global", error.message);
    state.isScraping = false;
    state.stopRequested = false;
    await cleanupScraperTab();
    await updateStatus({
      message: `Scraping failed: ${error.message}`,
      isScraping: false,
    });
    resetState();
  });

  return { status: "started", total: state.queue.length };
}

async function handleStopScraping() {
  await configReady;

  if (!state.isScraping) {
    await cleanupScraperTab();
    resetState();
    await updateStatus({ message: "Idle.", isScraping: false, total: 0, processed: 0, pending: 0 });
    return { status: "idle" };
  }

  state.stopRequested = true;
  await updateStatus({
    message: "Stop requested. Waiting for the current profile to finish...",
  });
  return { status: "stopping" };
}

async function handleGetStatus() {
  await configReady;
  const stored = await chrome.storage.local.get(STATUS_STORAGE_KEY);
  const status = stored?.[STATUS_STORAGE_KEY];
  if (status) {
    return {
      ...status,
      delayMs: status.delayMs ?? state.delayMs,
      maxRetries: status.maxRetries ?? state.maxRetries,
    };
  }
  return {
    isScraping: false,
    total: 0,
    processed: 0,
    pending: 0,
    errors: [],
    message: "Idle.",
    delayMs: state.delayMs,
    maxRetries: state.maxRetries,
    lastDoctor: null,
    retrying: null,
  };
}

async function handleUpdateConfig(config) {
  await applyConfig(config ?? {}, { persist: true });
  await updateStatus({});
  return { delayMs: state.delayMs, maxRetries: state.maxRetries };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.action) {
    return;
  }

  if (message.action === "startScraping") {
    handleStartScraping(message.payload)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ status: "error", message: error.message }));
    return true;
  }

  if (message.action === "stopScraping") {
    handleStopScraping()
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ status: "error", message: error.message }));
    return true;
  }

  if (message.action === "getStatus") {
    handleGetStatus()
      .then((status) => sendResponse({ status: "ok", data: status }))
      .catch((error) => sendResponse({ status: "error", message: error.message }));
    return true;
  }

  if (message.action === "updateConfig") {
    handleUpdateConfig(message.payload)
      .then((config) => sendResponse({ status: "ok", data: config }))
      .catch((error) => sendResponse({ status: "error", message: error.message }));
    return true;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  resetState();
  chrome.storage.local.set({
    [CONFIG_STORAGE_KEY]: {
      delayMs: state.delayMs,
      maxRetries: state.maxRetries,
    },
    [STATUS_STORAGE_KEY]: {
      isScraping: false,
      total: 0,
      processed: 0,
      pending: 0,
      errors: [],
      message: "Idle.",
      delayMs: state.delayMs,
      maxRetries: state.maxRetries,
      lastDoctor: null,
      retrying: null,
    },
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === state.scraperTabId) {
    state.scraperTabId = null;
  }
  if (tabId === state.listTabId) {
    state.listTabId = null;
  }
});

configReady
  .then(() => updateStatus({}))
  .catch((error) => console.error("Failed to publish initial status", error));
