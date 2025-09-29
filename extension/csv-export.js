const BASE_HEADERS = [
  { label: "Profile URL", key: "url" },
  { label: "Name", key: "name" },
  { label: "Specialty", key: "specialty" },
  { label: "Code", key: "code" },
  { label: "City", key: "city" },
  { label: "Addresses", key: "address" },
  { label: "Phones", key: "phones" },
  { label: "Error", key: "error" },
];
const UTF8_BOM = "\ufeff";

function toPrintableValue(value) {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch (error) {
      return String(value);
    }
  }
  return String(value);
}

function normaliseValue(value) {
  if (Array.isArray(value)) {
    const unique = Array.from(
      new Set(
        value
          .map((item) => toPrintableValue(item).trim())
          .filter((item) => item.length > 0)
      )
    );
    return unique.join("; ");
  }

  return toPrintableValue(value).trim();
}

function escapeCsvValue(value) {
  const str = normaliseValue(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function getOfficeFieldValues(office, pluralKey, singularKey) {
  if (!office || typeof office !== "object") {
    return [];
  }

  const values = [];
  const seen = new Set();

  function add(value) {
    if (value === undefined || value === null) {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => add(item));
      return;
    }

    const normalised = normaliseValue(value);
    if (!normalised) {
      return;
    }
    if (seen.has(normalised)) {
      return;
    }
    seen.add(normalised);
    values.push(normalised);
  }

  add(office[pluralKey]);
  if (singularKey) {
    add(office[singularKey]);
  }

  return values;
}

export function convertToCsv(rows) {
  const normalisedRows = Array.isArray(rows) ? rows : [];
  const officeMetrics = [];

  normalisedRows.forEach((row) => {
    const offices = Array.isArray(row?.offices) ? row.offices : [];
    offices.forEach((office, index) => {
      if (!officeMetrics[index]) {
        officeMetrics[index] = { addressColumns: 0, phoneColumns: 0 };
      }

      const addresses = getOfficeFieldValues(office, "addresses", "address");
      const phones = getOfficeFieldValues(office, "phones", "phone");

      officeMetrics[index].addressColumns = Math.max(
        officeMetrics[index].addressColumns,
        addresses.length
      );
      officeMetrics[index].phoneColumns = Math.max(
        officeMetrics[index].phoneColumns,
        phones.length
      );
    });
  });

  const dynamicHeaders = [];
  officeMetrics.forEach((metrics, index) => {
    const position = index + 1;
    dynamicHeaders.push({ label: `Office ${position} City`, key: `office_${index}_city` });

    const addressColumnCount = Math.max(1, metrics.addressColumns);
    for (let addressIndex = 0; addressIndex < addressColumnCount; addressIndex += 1) {
      dynamicHeaders.push({
        label: `Office ${position} Address ${addressIndex + 1}`,
        key: `office_${index}_address_${addressIndex}`,
      });
    }

    const phoneColumnCount = Math.max(1, metrics.phoneColumns);
    for (let phoneIndex = 0; phoneIndex < phoneColumnCount; phoneIndex += 1) {
      dynamicHeaders.push({
        label: `Office ${position} Phone ${phoneIndex + 1}`,
        key: `office_${index}_phone_${phoneIndex}`,
      });
    }
  });

  const headers = [...BASE_HEADERS, ...dynamicHeaders];
  const headerLine = headers.map((header) => header.label).join(",");

  const dataLines = normalisedRows.map((row) => {
    const offices = Array.isArray(row?.offices) ? row.offices : [];

    const baseValues = BASE_HEADERS.map((header) => escapeCsvValue(row?.[header.key]));

    const officeValues = [];
    officeMetrics.forEach((metrics, index) => {
      const office = offices[index] || {};
      officeValues.push(escapeCsvValue(office.city));

      const addressValues = getOfficeFieldValues(office, "addresses", "address");
      const addressColumnCount = Math.max(1, metrics.addressColumns);
      for (let addressIndex = 0; addressIndex < addressColumnCount; addressIndex += 1) {
        officeValues.push(escapeCsvValue(addressValues[addressIndex]));
      }

      const phoneValues = getOfficeFieldValues(office, "phones", "phone");
      const phoneColumnCount = Math.max(1, metrics.phoneColumns);
      for (let phoneIndex = 0; phoneIndex < phoneColumnCount; phoneIndex += 1) {
        officeValues.push(escapeCsvValue(phoneValues[phoneIndex]));
      }
    });

    return [...baseValues, ...officeValues].join(",");
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
