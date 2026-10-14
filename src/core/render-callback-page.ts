import { CALLBACK_PAGE_STYLES } from "./callback-page-styles.ts";
import { VC_LOGO_SVG } from "./vc-logo-svg.ts";

export type CallbackOutcome =
  | { kind: "success" }
  | { kind: "failure"; error: string; errorDescription?: string | undefined };

const FONTS_URL =
  "https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&family=Poppins:wght@400;500;600;700&display=swap";

const SUCCESS_ICON = `<svg viewBox="0 0 17 17" aria-hidden="true"><path d="M1 8L6 13L16 3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none" stroke="currentcolor"/></svg>`;

const FAILURE_ICON = `<svg viewBox="0 0 18 18" aria-hidden="true" fill="currentcolor"><path d="M8.999 12.602c-.994 0-1.8-.808-1.8-1.801v-9a1.8 1.8 0 0 1 3.601 0v9a1.8 1.8 0 0 1-1.799 1.8l-.002.001Z"/><path d="M9 14.2A1.9 1.9 0 1 0 9 18a1.9 1.9 0 0 0 0-3.8Z"/></svg>`;

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replaceAll(/[&<>"']/gu, (character) => HTML_ESCAPES[character] ?? character);
}

function renderCard(outcome: CallbackOutcome): string {
  if (outcome.kind === "success") {
    return `<div class="status status-success">${SUCCESS_ICON}</div>
<h1>You're logged in to Validation Cloud</h1>
<p>You can close this tab and return to your terminal.</p>`;
  }
  const description =
    outcome.errorDescription === undefined
      ? ""
      : `\n<p class="detail">${escapeHtml(outcome.errorDescription)}</p>`;
  return `<div class="status status-failure">${FAILURE_ICON}</div>
<h1>Login was not completed</h1>
<p>Authorization server returned <code>${escapeHtml(outcome.error)}</code>. Return to your terminal for details.</p>${description}`;
}

export function renderCallbackPage(outcome: CallbackOutcome): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#242731">
<title>Validation Cloud CLI</title>
<link rel="stylesheet" href="${escapeHtml(FONTS_URL)}">
<style>${CALLBACK_PAGE_STYLES}</style>
</head>
<body>
<main>
<div class="frame">
<div class="brand">${VC_LOGO_SVG}</div>
<div class="card">
${renderCard(outcome)}
</div>
</div>
</main>
</body>
</html>
`;
}
