import { describe, expect, it } from "vitest";
import { renderCallbackPage } from "./render-callback-page.ts";

describe("renderCallbackPage", () => {
  it("renders the success variant", () => {
    const html = renderCallbackPage({ kind: "success" });

    expect(html).toContain("<h1>You're logged in to Validation Cloud</h1>");
    expect(html).toContain("<p>You can close this tab and return to your terminal.</p>");
    expect(html).toContain('<div class="status status-success">');
    expect(html).not.toContain("Login was not completed");
  });

  it("renders the failure variant with the error and its description", () => {
    const html = renderCallbackPage({
      kind: "failure",
      error: "access_denied",
      errorDescription: "The user denied the request",
    });

    expect(html).toContain("<h1>Login was not completed</h1>");
    expect(html).toContain(
      "<p>Authorization server returned <code>access_denied</code>. Return to your terminal for details.</p>",
    );
    expect(html).toContain('<p class="detail">The user denied the request</p>');
    expect(html).toContain('<div class="status status-failure">');
    expect(html).not.toContain("logged in");
  });

  it("omits the description paragraph when there is none", () => {
    const html = renderCallbackPage({ kind: "failure", error: "server_error" });

    expect(html).toContain("<code>server_error</code>");
    expect(html).not.toContain('class="detail"');
  });

  it("escapes the error and its description", () => {
    const html = renderCallbackPage({
      kind: "failure",
      error: "<script>alert(1)</script>",
      errorDescription: `"quoted" & 'single' <script>alert(1)</script>`,
    });

    expect(html).toContain("<code>&lt;script&gt;alert(1)&lt;/script&gt;</code>");
    expect(html).toContain(
      '<p class="detail">&quot;quoted&quot; &amp; &#39;single&#39; &lt;script&gt;alert(1)&lt;/script&gt;</p>',
    );
    expect(html).not.toContain("<script>");
  });

  it("is dark-only, keeps the code out of Referer headers and runs no script", () => {
    const html = renderCallbackPage({ kind: "success" });

    expect(html).toContain("color-scheme: dark;");
    expect(html).toContain('<meta name="theme-color" content="#242731">');
    expect(html).toContain('<meta name="referrer" content="no-referrer">');
    expect(html).toContain("<title>Validation Cloud CLI</title>");
    expect(html).not.toContain("<script");
  });

  it("loads the same Google Fonts stylesheet as the apps", () => {
    expect(renderCallbackPage({ kind: "success" })).toContain(
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&amp;family=Poppins:wght@400;500;600;700&amp;display=swap">',
    );
  });

  it("inlines the wordmark", () => {
    expect(renderCallbackPage({ kind: "success" })).toContain(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 30" fill="none" role="img" aria-label="Validation Cloud" class="logo">',
    );
  });
});
