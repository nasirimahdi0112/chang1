import assert from "assert/strict";
import { readFileSync } from "fs";
import vm from "vm";

const scriptSource = readFileSync(new URL("../extension/content-script.js", import.meta.url), "utf8");

const context = {
  console,
  window: { location: { href: "https://nobat.ir/doctors" } },
  document: {
    querySelector: () => null,
    querySelectorAll: () => [],
  },
  MutationObserver: class {
    observe() {}
    disconnect() {}
  },
  setTimeout,
  clearTimeout,
  chrome: { runtime: { onMessage: { addListener: () => {} } } },
};

vm.createContext(context);
vm.runInContext(`${scriptSource}\nthis.__extractCodeToken = extractCodeToken;\nthis.__normaliseText = normaliseText;\nthis.__extractDoctorCode = extractDoctorCode;`, context);

const extractCodeToken = context.__extractCodeToken;
const normaliseText = context.__normaliseText;
const extractDoctorCode = context.__extractDoctorCode;

assert.equal(typeof extractCodeToken, "function", "extractCodeToken should be available");
assert.equal(typeof normaliseText, "function", "normaliseText should be available");
assert.equal(typeof extractDoctorCode, "function", "extractDoctorCode should be available");

{
  const raw = "کد نظام پزشکی: ف ۱۲۳۴۵";
  const cleaned = extractCodeToken(normaliseText(raw));
  assert.equal(cleaned, "ف12345", "Should preserve Persian letter prefixes");
}

{
  const structuredEntries = [
    {
      "@type": "Person",
      identifier: {
        "@type": "PropertyValue",
        name: "Medical Council",
        value: "م 67890",
      },
    },
  ];
  const code = extractDoctorCode(structuredEntries);
  assert.equal(code, "م67890", "Should extract value from PropertyValue identifier objects");
}

{
  const structuredEntries = [
    {
      identifier: [
        { code: "ف123" },
        "غ987",
      ],
      medicalLicenseNumber: "ک456",
    },
  ];
  const code = extractDoctorCode(structuredEntries);
  assert.equal(code, "ف123", "Should prioritise alphanumeric tokens with letters");
}

console.log("All content-script tests passed.");
