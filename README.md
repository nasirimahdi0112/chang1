# Nobat.ir Doctor Scraper Extension

This repository contains a Chrome extension that scrapes doctor information from [nobat.ir](https://nobat.ir/) based on a list of doctors presented on the site. The extension collects profile data for each doctor and exports the results as a CSV file.

## Features

- Extracts all doctor profile links from the active doctors list page and automatically expands supported "load more" buttons to capture the full set of results.
- Visits each profile sequentially with a configurable delay and retry policy to gather detailed information without overwhelming the site.
- Reveals hidden phone numbers, normalises Persian digits, and deduplicates addresses/phones collected from multiple DOM patterns and structured data.
- Aggregates multiple clinic addresses and phone numbers for each doctor and converts the output to UTF-8 CSV with a BOM for Excel compatibility.
- Provides a popup interface that persists delay/retry settings, shows real-time progress, recent profile details, retry state, and any errors.
- Downloads a partial CSV automatically if the scraping run is stopped before completion.

## File Overview

- `extension/manifest.json` – Chrome extension manifest (Manifest V3).
- `extension/background.js` – Service worker that orchestrates scraping and CSV generation.
- `extension/content-script.js` – Extracts links and profile details within Nobat.ir pages.
- `extension/csv-export.js` – Helper functions for building and downloading CSV files.
- `extension/popup.html` & `extension/popup.js` – Popup UI for controlling the scraper.

## Loading the Extension Locally

1. Open **chrome://extensions** in Chrome.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked** and select the `extension` directory from this repository.
4. Navigate to a Nobat.ir doctors list page and open the extension popup. Adjust the delay (seconds between profiles) and max retries if needed, then press **Start**.
5. While scraping is in progress you can observe the status, last processed profile, and any retry or error information. Press **Stop** to end the run early and download a partial CSV.

The resulting CSV file will be downloaded automatically once scraping completes (or is stopped).
