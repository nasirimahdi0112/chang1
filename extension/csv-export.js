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

export async function downloadCsv(filename, rows) {
  const csvContent = typeof rows === "string" ? rows : convertToCsv(rows);
  const blob = new Blob([UTF8_BOM, csvContent], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  try {
    await download({ url, filename, saveAs: false });
  } finally {
    // Give the download API time to consume the object URL before revoking it.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
