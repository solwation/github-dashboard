import { describe, expect, it } from "vitest";
import { isDataRefreshShortcut } from "../src/lib/refresh-shortcuts";

const plain = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };
describe("browser reload shortcut routing", () => {
  it.each([
    { key: "r", ctrlKey: true },
    { key: "R", metaKey: true },
    { key: "F5" },
  ])("recognizes a standard refresh: %o", gesture => {
    expect(isDataRefreshShortcut({ ...plain, ...gesture })).toBe(true);
  });
  it.each([
    { key: "r" },
    { key: "r", ctrlKey: true, shiftKey: true },
    { key: "R", metaKey: true, shiftKey: true },
    { key: "F5", ctrlKey: true },
    { key: "F5", metaKey: true },
    { key: "F5", shiftKey: true },
    { key: "r", ctrlKey: true, altKey: true },
    { key: "r", ctrlKey: true, metaKey: true },
    { key: "F6" },
  ])("leaves hard reloads and other browser gestures alone: %o", gesture => {
    expect(isDataRefreshShortcut({ ...plain, ...gesture })).toBe(false);
  });
});
