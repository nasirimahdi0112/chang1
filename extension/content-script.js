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

const LOAD_MORE_SELECTORS = [
  "button[data-role='load-more']",
  "button.load-more",
  "button.more-doctors",
  ".load-more button",
  "button[data-action='load-more']",
  "button.show-more",
  "a[data-role='load-more']",
];

const DOCTOR_LINK_SELECTORS = [
  "a.doctor-ui",
  "a[data-role='doctor-card']",
  "a.doctor-card",
  ".doctor-ui a[href]",
  "a[href*='/doctor/']",
  "a[href*='/dr/']",
  "a[href*='/profile/doctor']",
];

const DOCTOR_LINK_ATTRIBUTE_SELECTORS = [
  "[data-profile-url]",
  "[data-doctor-url]",
  "[data-url]",
  "[data-link]",
];

const NEXT_PAGE_SELECTORS = [
  "a[rel='next']",
  "a.pagination-next",
  ".pagination a.next",
  ".pagination li.next a",
  ".pagination li.active + li a",
  "a[aria-label='Next']",
  "a[aria-label='next']",
  "a[aria-label='بعد']",
  "a[aria-label='بعدی']",
  "a[aria-label*='بعد']",
  "a[aria-label*='next']",
];

const PHONE_CONTAINER_SELECTORS = [
  ".office-description",
  ".office-contact",
  "[data-role='tells-container']",
  ".doctor-phone",
  ".doctor-phones",
  ".phone-number",
  ".contact-phone",
  ".contact-item",
];

const ADDRESS_CONTAINER_SELECTORS = [
  ".office-address",
  ".doctor-address",
  "[data-role='address']",
  "[itemprop='streetAddress']",
  ".address",
  ".clinic-address",
];

function toAbsoluteUrl(url) {
  try {
    return new URL(url, window.location.href).href;
  } catch (error) {
    return url;
  }
}

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

function normalisePhoneText(value) {
  const cleaned = normaliseWhitespace(value);
  if (!cleaned) {
    return "";
  }
  return cleaned.replace(/^(?:تلفن|شماره|call|phone)[:：\s-]*/i, "");
}

function normalisePhoneKey(value) {
  return convertLocaleDigits(value).replace(/[^0-9+]/g, "");
}

function createCollector(transform = normaliseText, keyFn) {
  const seen = new Set();
  const values = [];
  return {
    add(value) {
      const transformed = transform ? transform(value) : value;
      if (!transformed) {
        return;
      }
      const key = keyFn ? keyFn(value, transformed) : transformed;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      values.push(transformed);
    },
    values() {
      return values.slice();
    },
  };
}

function isElementVisible(element) {
  if (!element) {
    return false;
  }
  if (element.offsetParent === null && element.getClientRects().length === 0) {
    return false;
  }
  const style = window.getComputedStyle(element);
  return style.visibility !== "hidden" && style.display !== "none";
}

function isLoadMoreButtonUsable(button) {
  if (!button) {
    return false;
  }
  if (button.disabled || button.getAttribute("aria-disabled") === "true") {
    return false;
  }
  if (button.classList.contains("disabled") || button.classList.contains("d-none")) {
    return false;
  }
  return isElementVisible(button);
}

function findLoadMoreButton() {
  for (const selector of LOAD_MORE_SELECTORS) {
    const candidates = Array.from(document.querySelectorAll(selector));
    for (const candidate of candidates) {
      if (isLoadMoreButtonUsable(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

function waitForElement(selector, timeout = 5000) {
  const existing = document.querySelector(selector);
  if (existing) {
    return Promise.resolve(existing);
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeout);

    function handleMutations() {
      const element = document.querySelector(selector);
      if (element) {
        cleanup();
        resolve(element);
      }
    }

    function cleanup() {
      clearTimeout(timer);
      observer.disconnect();
    }

    const observer = new MutationObserver(handleMutations);
    observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
    });
  });
}

function getDoctorCardCount() {
  return document.querySelectorAll(
    ["a.doctor-ui", "a[data-role='doctor-card']", "[data-profile-url]", "[data-doctor-url]"]
      .join(",")
  ).length;
}

function waitForDoctorCardCountIncrease(previousCount, timeout = 6000) {
  return new Promise((resolve) => {
    let resolved = false;

    function finish(count) {
      if (resolved) {
        return;
      }
      resolved = true;
      cleanup();
      resolve(count);
    }

    function checkCount() {
      const current = getDoctorCardCount();
      if (current > previousCount) {
        finish(current);
      }
    }

    const observer = new MutationObserver(checkCount);
    observer.observe(document.body, { childList: true, subtree: true });

    const timer = setTimeout(() => finish(getDoctorCardCount()), timeout);

    function cleanup() {
      clearTimeout(timer);
      observer.disconnect();
    }

    checkCount();
  });
}

async function loadAdditionalDoctorCards(maxIterations = 12) {
  let iteration = 0;
  let previousCount = getDoctorCardCount();

  while (iteration < maxIterations) {
    const button = findLoadMoreButton();
    if (!button) {
      break;
    }

    button.scrollIntoView({ block: "center" });
    button.click();
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const updatedCount = await waitForDoctorCardCountIncrease(previousCount, 7000);
    if (!updatedCount || updatedCount <= previousCount) {
      break;
    }

    previousCount = updatedCount;
    iteration += 1;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
}

function normaliseProfileLink(rawLink) {
  if (!rawLink) {
    return null;
  }
  if (/^javascript:/i.test(rawLink)) {
    return null;
  }
  try {
    const url = new URL(toAbsoluteUrl(rawLink));
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

function collectDoctorLinksFromDom() {
  const links = new Set();

  DOCTOR_LINK_SELECTORS.forEach((selector) => {
    const anchors = Array.from(document.querySelectorAll(selector));
    anchors.forEach((anchor) => {
      const href = anchor.getAttribute("href") || anchor.dataset?.href || anchor.dataset?.profileUrl;
      const url = normaliseProfileLink(href);
      if (url) {
        links.add(url);
      }
    });
  });

  DOCTOR_LINK_ATTRIBUTE_SELECTORS.forEach((selector) => {
    const elements = Array.from(document.querySelectorAll(selector));
    elements.forEach((element) => {
      const attributeNames = ["data-profile-url", "data-doctor-url", "data-url", "data-link"];
      attributeNames.forEach((attrName) => {
        const value = element.getAttribute(attrName);
        const url = normaliseProfileLink(value);
        if (url) {
          links.add(url);
        }
      });

      if (element.dataset) {
        Object.keys(element.dataset)
          .filter((key) => /profile|doctor|url|link/i.test(key))
          .forEach((key) => {
            const url = normaliseProfileLink(element.dataset[key]);
            if (url) {
              links.add(url);
            }
          });
      }
    });
  });

  return Array.from(links);
}

function isPaginationElementDisabled(element) {
  if (!element) {
    return true;
  }
  if (element.getAttribute && element.getAttribute("aria-disabled") === "true") {
    return true;
  }
  if (
    element.classList &&
    (element.classList.contains("disabled") || element.classList.contains("d-none"))
  ) {
    return true;
  }
  const parent = element.closest ? element.closest("li") : null;
  if (parent) {
    if (parent.getAttribute("aria-disabled") === "true") {
      return true;
    }
    if (parent.classList.contains("disabled") || parent.classList.contains("d-none")) {
      return true;
    }
  }
  return false;
}

function normalisePaginationUrl(href) {
  if (!href) {
    return null;
  }
  const trimmed = href.trim();
  if (!trimmed || trimmed === "#") {
    return null;
  }
  if (/^javascript:/i.test(trimmed)) {
    return null;
  }
  return toAbsoluteUrl(trimmed);
}

function collectPaginationCandidates() {
  const candidates = new Set();
  NEXT_PAGE_SELECTORS.forEach((selector) => {
    document.querySelectorAll(selector).forEach((element) => {
      candidates.add(element);
    });
  });

  const paginationContainers = Array.from(
    document.querySelectorAll(
      ".pagination, nav[aria-label*='page'], nav[aria-label*='صفحه'], nav[role='navigation']"
    )
  );

  paginationContainers.forEach((container) => {
    const active = container.querySelector("li.active, .active");
    if (active) {
      let nextSibling = active.nextElementSibling;
      while (nextSibling) {
        const anchor = nextSibling.querySelector ? nextSibling.querySelector("a[href]") : null;
        if (anchor) {
          candidates.add(anchor);
          break;
        }
        nextSibling = nextSibling.nextElementSibling;
      }
    }

    container.querySelectorAll("a[href]").forEach((anchor) => {
      candidates.add(anchor);
    });
  });

  return Array.from(candidates);
}

function findNextPageUrl() {
  const candidates = collectPaginationCandidates();
  const scored = [];

  candidates.forEach((candidate, index) => {
    if (!candidate || isPaginationElementDisabled(candidate)) {
      return;
    }
    const url = normalisePaginationUrl(candidate.getAttribute("href"));
    if (!url) {
      return;
    }

    const text = normaliseWhitespace(candidate.textContent || "").toLowerCase();
    const aria = normaliseWhitespace(
      (typeof candidate.getAttribute === "function" && candidate.getAttribute("aria-label")) || ""
    ).toLowerCase();

    let priority = 5 + index;
    const hasNextRel = candidate.rel && /next/i.test(candidate.rel);
    if (hasNextRel) {
      priority = Math.min(priority, 0);
    }
    const looksLikeNext = /(\u0628\u0639\u062f|\u0628\u0639\u062f\u06cc|next|›|»)/i.test(text);
    if (looksLikeNext) {
      priority = Math.min(priority, 1);
    }
    const ariaIndicatesNext = /(\u0628\u0639\u062f|\u0628\u0639\u062f\u06cc|next)/i.test(aria);
    if (ariaIndicatesNext) {
      priority = Math.min(priority, 1);
    }

    const parent = candidate.closest ? candidate.closest("li") : null;
    const hasNextClass = !!(
      candidate.classList && Array.from(candidate.classList).some((cls) => /next|\u0628\u0639\u062f/i.test(cls))
    );
    const afterActive =
      parent &&
      parent.previousElementSibling &&
      parent.previousElementSibling.classList &&
      parent.previousElementSibling.classList.contains("active");

    if (afterActive) {
      priority = Math.min(priority, 2);
    }

    const qualifies = hasNextRel || looksLikeNext || ariaIndicatesNext || hasNextClass;
    if (!qualifies && !afterActive) {
      return;
    }

    scored.push({ url, priority });
  });

  if (!scored.length) {
    return null;
  }

  scored.sort((a, b) => a.priority - b.priority);
  return scored[0].url;
}

async function gatherDoctorLinks() {
  await waitForElement("a.doctor-ui, [data-profile-url]");
  await loadAdditionalDoctorCards();
  const links = collectDoctorLinksFromDom();
  const nextPageUrl = findNextPageUrl();
  return { links, nextPageUrl };
}

function extractText(selector, root = document) {
  const element = root.querySelector(selector);
  return element ? normaliseText(element.textContent) : "";
}

function extractStructuredEntries() {
  const entries = [];
  const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));

  scripts.forEach((script) => {
    const text = script.textContent?.trim();
    if (!text) {
      return;
    }
    try {
      const parsed = JSON.parse(text);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      items.forEach((item) => {
        if (item && typeof item === "object") {
          entries.push(item);
        }
      });
    } catch (error) {
      // Ignore malformed JSON-LD blocks.
    }
  });

  return entries;
}

function extractDoctorName(structuredEntries) {
  const heading = document.querySelector("h1.doctor-ui-name");
  if (heading) {
    const ellipsis = heading.querySelector(".text-ellipsis");
    const text = ellipsis ? ellipsis.textContent : heading.textContent;
    const normalised = normaliseText(text);
    if (normalised) {
      return normalised;
    }
  }

  const fallback = document.querySelector("[itemprop='name']");
  if (fallback) {
    const normalised = normaliseText(fallback.textContent);
    if (normalised) {
      return normalised;
    }
  }

  for (const entry of structuredEntries) {
    const name = normaliseText(entry?.name);
    if (name) {
      return name;
    }
  }

  return "";
}

function extractDoctorSpecialty(structuredEntries) {
  const selectors = [
    "h2.doctor-ui-specialty",
    ".doctor-ui-specialty",
    ".doctor-specialty",
    "[data-role='doctor-specialty']",
    "[itemprop='medicalSpecialty']",
  ];

  for (const selector of selectors) {
    const text = extractText(selector);
    if (text) {
      return text;
    }
  }

  for (const entry of structuredEntries) {
    const specialty = entry?.medicalSpecialty || entry?.specialty || entry?.department;
    if (Array.isArray(specialty)) {
      const normalised = specialty.map((value) => normaliseText(value)).filter(Boolean);
      if (normalised.length) {
        return normalised.join("، ");
      }
    } else if (specialty) {
      const normalised = normaliseText(specialty);
      if (normalised) {
        return normalised;
      }
    }
  }

  return "";
}

function extractCodeToken(text) {
  if (!text) {
    return "";
  }

  const primaryMatch = text.match(/(?:\p{L}\s*)?\d+(?:\s*\p{L})?/u);
  if (primaryMatch && primaryMatch[0]) {
    return primaryMatch[0].replace(/\s+/g, "");
  }

  const tokens = text.split(/[^0-9\p{L}]+/u).filter(Boolean);
  let numericFallback = "";

  for (const token of tokens) {
    if (/\d/.test(token)) {
      if (/\p{L}/u.test(token)) {
        return token;
      }
      if (!numericFallback) {
        numericFallback = token;
      }
    }
  }

  return numericFallback;
}

function extractDoctorCode(structuredEntries) {
  const candidates = [];
  const primary = document.querySelector(".doctor-code span:last-child");
  if (primary) {
    candidates.push(primary.textContent);
  }
  const fallback = document.querySelector(".doctor-code");
  if (fallback) {
    candidates.push(fallback.textContent);
  }
  const meta = document.querySelector("[data-role='doctor-code']");
  if (meta) {
    candidates.push(meta.textContent);
  }

  structuredEntries.forEach((entry) => {
    if (entry?.identifier) {
      candidates.push(entry.identifier);
    }
  });

  for (const candidate of candidates) {
    const text = normaliseText(candidate);
    if (!text) {
      continue;
    }
    const parsed = extractCodeToken(text);
    if (parsed) {
      return parsed;
    }
  }

  for (const candidate of candidates) {
    const text = normaliseText(candidate);
    if (text) {
      return text;
    }
  }

  return "";
}

function normaliseAddressText(text) {
  return normaliseText(text);
}

function createPhoneCollector() {
  return createCollector(normalisePhoneText, (_, value) => normalisePhoneKey(value));
}

function collectPhonesFromElement(root, collector) {
  const phoneContainers = Array.from(root.querySelectorAll(PHONE_CONTAINER_SELECTORS.join(",")));
  const elementsToScan = phoneContainers.length ? phoneContainers : [root];

  elementsToScan.forEach((element) => {
    const rawText = normaliseWhitespace(element.textContent || "");
    if (!rawText) {
      return;
    }
    rawText
      .split(/\n|،|,|؛|;|\||\//)
      .map((item) => item.trim())
      .forEach((item) => addPhoneCandidate(collector, item));
  });

  const telLinks = Array.from(root.querySelectorAll("a[href^='tel:']"));
  telLinks.forEach((link) => {
    const href = link.getAttribute("href") || "";
    addPhoneCandidate(collector, href.replace(/^tel:/i, ""));
    addPhoneCandidate(collector, link.textContent || "");
  });

  const dataSelectors = ["[data-phone]", "[data-tel]", "[data-tell]", "[data-mobile]", "[data-number]", "[data-phones]"];
  dataSelectors.forEach((selector) => {
    const elements = Array.from(root.querySelectorAll(selector));
    elements.forEach((element) => {
      const attrName = selector.replace(/[\[\]]/g, "");
      const attrValue = element.getAttribute(attrName);
      addPhoneCandidate(collector, attrValue);
      if (element.dataset) {
        Object.keys(element.dataset)
          .filter((key) => /phone|tel|mobile|number/i.test(key))
          .forEach((key) => addPhoneCandidate(collector, element.dataset[key]));
      }
    });
  });
}

function collectOfficeAddresses(structuredEntries) {
  const offices = [];
  const officeSeen = new Set();
  const addressCollector = createCollector(normaliseAddressText);
  const cityCollector = createCollector(normaliseText);
  const processedAddressNodes = new Set();

  function pushOffice(details) {
    if (!details) {
      return;
    }

    const officeCityCollector = createCollector(normaliseText);
    const officeAddressCollector = createCollector(normaliseAddressText);
    const officePhoneCollector = createPhoneCollector();

    if (details.city) {
      officeCityCollector.add(details.city);
    }
    const addresses = Array.isArray(details.addresses)
      ? details.addresses
      : details.address
      ? [details.address]
      : [];
    addresses.forEach((address) => officeAddressCollector.add(address));

    const phones = Array.isArray(details.phones)
      ? details.phones
      : details.phone
      ? [details.phone]
      : [];
    phones.forEach((phone) => officePhoneCollector.add(phone));

    const city = officeCityCollector.values().find(Boolean) || "";
    const normalisedAddresses = officeAddressCollector.values();
    const normalisedPhones = officePhoneCollector.values();

    if (!city && !normalisedAddresses.length && !normalisedPhones.length) {
      return;
    }

    const key = [city, normalisedAddresses.join("||"), normalisedPhones.join("||")].join("@@");
    if (officeSeen.has(key)) {
      return;
    }
    officeSeen.add(key);

    offices.push({ city, addresses: normalisedAddresses, phones: normalisedPhones });
  }

  function addAddressNode(node, cityTarget = cityCollector, addressTarget = addressCollector) {
    if (!node) {
      return;
    }
    processedAddressNodes.add(node);
    const strongs = Array.from(node.querySelectorAll("strong"));
    if (strongs.length > 1) {
      cityTarget.add(strongs[0]?.textContent);
      addressTarget.add(strongs[strongs.length - 1]?.textContent);
    } else if (strongs.length === 1) {
      addressTarget.add(strongs[0].textContent);
    } else {
      addressTarget.add(node.textContent);
    }
  }

  const officeContainers = Array.from(
    document.querySelectorAll(
      ".office, .doctor-office, .office-item, .doctor-ui-office, .doctor-ui__office, .office-info"
    )
  );

  officeContainers.forEach((office) => {
    const officeCityCollector = createCollector(normaliseText);
    officeCityCollector.add(office.getAttribute("data-city") || office.dataset?.city);

    const officeAddressCollector = createCollector(normaliseAddressText);
    const addressNodes = Array.from(office.querySelectorAll(ADDRESS_CONTAINER_SELECTORS.join(",")));
    if (addressNodes.length) {
      addressNodes.forEach((node) => {
        addAddressNode(node, officeCityCollector, officeAddressCollector);
      });
    } else {
      officeAddressCollector.add(office.textContent);
    }

    const phoneCollector = createPhoneCollector();
    collectPhonesFromElement(office, phoneCollector);

    pushOffice({
      city: officeCityCollector.values().find(Boolean) || "",
      addresses: officeAddressCollector.values(),
      phones: phoneCollector.values(),
    });
  });

  const locality = document.querySelector("[itemprop='addressLocality']");
  if (locality) {
    cityCollector.add(locality.textContent);
  }

  structuredEntries.forEach((entry) => {
    if (entry?.addressLocality) {
      cityCollector.add(entry.addressLocality);
    }

    const addressCandidates = entry?.address;
    const addressList = Array.isArray(addressCandidates)
      ? addressCandidates
      : addressCandidates
      ? [addressCandidates]
      : [];

    if (!addressList.length && (entry?.streetAddress || entry?.telephone || entry?.addressLocality)) {
      pushOffice({
        city: entry.addressLocality || entry.addressRegion || "",
        addresses: entry.streetAddress ? [entry.streetAddress] : [],
        phones: entry.telephone ? [entry.telephone] : [],
      });
    }

    addressList.forEach((address) => {
      if (!address) {
        return;
      }
      if (typeof address === "string") {
        pushOffice({ city: "", addresses: [address], phones: [] });
        return;
      }

      const officeCityCollector = createCollector(normaliseText);
      if (address.addressLocality) {
        officeCityCollector.add(address.addressLocality);
      }
      if (address.addressRegion) {
        officeCityCollector.add(address.addressRegion);
      }

      const officeAddressCollector = createCollector(normaliseAddressText);
      if (address.streetAddress) {
        officeAddressCollector.add(address.streetAddress);
      }

      const phoneCollector = createPhoneCollector();
      addPhoneCandidate(phoneCollector, address.telephone);

      pushOffice({
        city: officeCityCollector.values().find(Boolean) || "",
        addresses: officeAddressCollector.values(),
        phones: phoneCollector.values(),
      });
    });
  });

  if (!offices.length) {
    const fallbackAddressCollector = createCollector(normaliseAddressText);
    const fallbackCityCollector = createCollector(normaliseText);

    const fallbackNodes = Array.from(document.querySelectorAll(ADDRESS_CONTAINER_SELECTORS.join(",")));
    fallbackNodes.forEach((node) => {
      if (processedAddressNodes.has(node)) {
        return;
      }
      addAddressNode(node, fallbackCityCollector, fallbackAddressCollector);
    });

    const fallbackAddresses = fallbackAddressCollector.values();
    const fallbackCity = fallbackCityCollector.values().find(Boolean) || "";

    if (fallbackAddresses.length || fallbackCity) {
      pushOffice({
        city: fallbackCity,
        addresses: fallbackAddresses,
        phones: collectPhoneNumbers(structuredEntries),
      });
    }
  }

  offices.forEach((office) => {
    cityCollector.add(office.city);
    office.addresses.forEach((address) => addressCollector.add(address));
  });

  const fallbackNodes = Array.from(document.querySelectorAll(ADDRESS_CONTAINER_SELECTORS.join(",")));
  fallbackNodes.forEach((node) => {
    if (processedAddressNodes.has(node)) {
      return;
    }
    addAddressNode(node);
  });

  structuredEntries.forEach((entry) => {
    const addresses = entry?.address;
    const addressList = Array.isArray(addresses) ? addresses : addresses ? [addresses] : [];
    addressList.forEach((address) => {
      if (!address) {
        return;
      }
      if (typeof address === "string") {
        addressCollector.add(address);
        return;
      }
      if (address.streetAddress) {
        addressCollector.add(address.streetAddress);
      }
      if (address.addressLocality) {
        cityCollector.add(address.addressLocality);
      }
    });
  });

  const addresses = addressCollector.values();
  const city = cityCollector.values().find(Boolean) || "";

  return { city, addresses, offices };
}

function addPhoneCandidate(collector, value) {
  if (value === undefined || value === null) {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => addPhoneCandidate(collector, item));
    return;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    if ((trimmed.startsWith("[") && trimmed.endsWith("]")) || (trimmed.startsWith("{") && trimmed.endsWith("}"))) {
      try {
        const parsed = JSON.parse(trimmed);
        addPhoneCandidate(collector, parsed);
        return;
      } catch (error) {
        // Ignore malformed JSON-like strings and treat them as plain text.
      }
    }
    collector.add(trimmed);
    return;
  }
  if (typeof value === "object") {
    Object.values(value).forEach((item) => addPhoneCandidate(collector, item));
    return;
  }
  collector.add(String(value));
}

function collectPhonesFromStructuredData(structuredEntries, addPhone) {
  structuredEntries.forEach((entry) => {
    const telephone = entry?.telephone;
    const telephones = Array.isArray(telephone) ? telephone : telephone ? [telephone] : [];
    telephones.forEach(addPhone);

    const contactPoints = Array.isArray(entry?.contactPoint) ? entry.contactPoint : [];
    contactPoints.forEach((point) => {
      if (!point) {
        return;
      }
      addPhone(point.telephone);
    });

    const addresses = Array.isArray(entry?.address) ? entry.address : entry?.address ? [entry.address] : [];
    addresses.forEach((address) => {
      if (!address || typeof address !== "object") {
        return;
      }
      addPhone(address.telephone);
    });
  });
}

function collectPhoneNumbers(structuredEntries) {
  const collector = createCollector(normalisePhoneText, (_, value) => normalisePhoneKey(value));

  const phoneContainers = Array.from(document.querySelectorAll(PHONE_CONTAINER_SELECTORS.join(",")));
  phoneContainers.forEach((container) => {
    const rawText = normaliseWhitespace(container.textContent || "");
    if (!rawText) {
      return;
    }
    rawText
      .split(/\n|،|,|؛|;|\||\//)
      .map((item) => item.trim())
      .forEach((item) => addPhoneCandidate(collector, item));
  });

  const telLinks = Array.from(document.querySelectorAll("a[href^='tel:']"));
  telLinks.forEach((link) => {
    const href = link.getAttribute("href") || "";
    addPhoneCandidate(collector, href.replace(/^tel:/i, ""));
    addPhoneCandidate(collector, link.textContent || "");
  });

  const dataSelectors = ["[data-phone]", "[data-tel]", "[data-tell]", "[data-mobile]", "[data-number]", "[data-phones]"];
  dataSelectors.forEach((selector) => {
    const elements = Array.from(document.querySelectorAll(selector));
    elements.forEach((element) => {
      const attrName = selector.replace(/[\[\]]/g, "");
      const attrValue = element.getAttribute(attrName);
      addPhoneCandidate(collector, attrValue);
      if (element.dataset) {
        Object.keys(element.dataset)
          .filter((key) => /phone|tel|mobile|number/i.test(key))
          .forEach((key) => addPhoneCandidate(collector, element.dataset[key]));
      }
    });
  });

  collectPhonesFromStructuredData(structuredEntries, (value) => addPhoneCandidate(collector, value));

  return collector.values();
}

async function revealPhoneNumbers() {
  const buttons = Array.from(
    document.querySelectorAll("button[data-role='show-tells'], button.show-tells, [data-role='show-tells'] button")
  );

  if (!buttons.length) {
    return;
  }

  for (const button of buttons) {
    if (button.disabled || button.getAttribute("aria-disabled") === "true") {
      continue;
    }
    button.scrollIntoView({ block: "center" });
    button.click();
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  await new Promise((resolve) => setTimeout(resolve, 800));
}

async function scrapeDoctorDetails() {
  await waitForElement("h1.doctor-ui-name, .doctor-ui-name, [itemprop='name']", 8000);
  const structuredEntries = extractStructuredEntries();

  await revealPhoneNumbers();

  const { city, addresses, offices } = collectOfficeAddresses(structuredEntries);

  return {
    name: extractDoctorName(structuredEntries),
    specialty: extractDoctorSpecialty(structuredEntries),
    code: extractDoctorCode(structuredEntries),
    city,
    addresses,
    phones: collectPhoneNumbers(structuredEntries),
    offices,
    url: window.location.href,
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) {
    return;
  }

  if (message.type === "GET_DOCTOR_LINKS") {
    (async () => {
      try {
        const { links, nextPageUrl } = await gatherDoctorLinks();
        sendResponse({ links, nextPageUrl });
      } catch (error) {
        console.error("Failed to gather doctor links", error);
        sendResponse({ error: error.message });
      }
    })();
    return true;
  }

  if (message.type === "SCRAPE_DOCTOR_DETAILS") {
    (async () => {
      try {
        const data = await scrapeDoctorDetails();
        sendResponse({ data });
      } catch (error) {
        console.error("Failed to scrape doctor details", error);
        sendResponse({ error: error.message });
      }
    })();
    return true;
  }
});
