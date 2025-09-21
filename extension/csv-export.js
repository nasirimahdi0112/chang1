const CSV_HEADERS = ["Name", "Specialty", "Code", "City", "Address", "Phones"];
const UTF8_BOM = "\ufeff";

function normaliseValue(value) {
  if (Array.isArray(value)) {
    const unique = Array.from(new Set(value.map((item) => String(item || "").trim()).filter(Boolean)));
    return unique.join("; ");
  }

  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
}

function escapeCsvValue(value) {
  const str = normaliseValue(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function convertToCsv(rows) {
  const headerLine = CSV_HEADERS.join(",");
  const dataLines = rows.map((row) => {
    return CSV_HEADERS
      .map((header) => {
        const key = header.toLowerCase();
        return escapeCsvValue(row[key]);
      })
      .join(",");
  });

  return [headerLine, ...dataLines].join("\n");
}

function download(options) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(options, (downloadId) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(downloadId);
    });
  });
}

function ensureUtf8Bom(csvContent) {
  if (typeof csvContent !== "string") {
    return `${UTF8_BOM}${String(csvContent ?? "")}`;
  }

  return csvContent.startsWith(UTF8_BOM) ? csvContent : `${UTF8_BOM}${csvContent}`;
}

function encodeCsvAsDataUrl(csvText) {
  return `data:text/csv;charset=utf-8,${encodeURIComponent(csvText)}`;
}

async function downloadViaBlobUrl(filename, csvText) {
  let url;

  try {
    const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
    url = URL.createObjectURL(blob);
    await download({ url, filename, saveAs: false });
    // Give the download API time to consume the object URL before revoking it.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (error) {
    if (url) {
      URL.revokeObjectURL(url);
    }
    throw error;
  }
}

async function downloadViaDataUrl(filename, csvText, initialError) {
  const url = encodeCsvAsDataUrl(csvText);

  try {
    await download({ url, filename, saveAs: false });
  } catch (error) {
    if (initialError) {
      const combinedError = new Error(
        `Failed to download CSV (blob URL error: ${initialError.message}; data URL fallback: ${error.message})`
      );
      combinedError.cause = { blob: initialError, dataUrl: error };
      throw combinedError;
    }
    throw error;
  }
}

export async function downloadCsv(filename, rows) {
  const csvContent = typeof rows === "string" ? rows : convertToCsv(rows);
  const csvText = ensureUtf8Bom(csvContent);

  try {
    await downloadViaBlobUrl(filename, csvText);
    return;
  } catch (error) {
    console.warn("Blob URL download failed, falling back to data URL.", error);
    await downloadViaDataUrl(filename, csvText, error);
  }
}
