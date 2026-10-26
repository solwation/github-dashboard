import { timeoutDetail } from "./timeouts";
import { t } from "./i18n";
import type { Issue, Repo } from "./model";
import { issueNavigationHash } from "./issue-navigation";

/** Called when the user clicks a page notification; the app shows the issue on its board (#278). */
export type NotificationSelect = (repo: Repo, issue: Issue) => void;

export interface ClosableNotification {
  close(): void;
  addEventListener?(type: string, listener: EventListenerOrEventListenerObject): void;
  removeEventListener?(type: string, listener: EventListenerOrEventListenerObject): void;
}

export interface NotificationRegistrationLike {
  getNotifications?(filter?: { tag?: string }): Promise<ReadonlyArray<ClosableNotification>>;
}

const activePageNotifications = new Set<ClosableNotification>();

/**
 * Tracks a page-level notification so it can be closed when the session ends (#312).
 * Automatically untracks when closed or on error.
 */
export function trackPageNotification<T extends ClosableNotification>(notice: T): T {
  activePageNotifications.add(notice);
  const untrack = () => {
    activePageNotifications.delete(notice);
  };
  try {
    notice.addEventListener?.("close", untrack);
    notice.addEventListener?.("error", untrack);
  } catch {
    // Best-effort
  }
  return notice;
}

/** Testing helper: returns the number of currently tracked page notifications. */
export function trackedPageNotificationCount(): number {
  return activePageNotifications.size;
}

export function notificationPermission():
  NotificationPermission | "unsupported" {
  return typeof Notification === "undefined" || !window.isSecureContext
    ? "unsupported"
    : Notification.permission;
}

export async function requestNotifications(): Promise<
  NotificationPermission | "unsupported"
> {
  const permission = notificationPermission();
  return permission === "default"
    ? Notification.requestPermission()
    : permission;
}

export async function notifyClosure(repo: Repo, issue: Issue, onSelect?: NotificationSelect) {
  return notifyIssue(repo, issue, t("Issue stängd"), `${repo.full_name}:${issue.id}:${issue.closed_at}`, undefined, onSelect);
}
export async function notifyTimeout(repo: Repo, issue: Issue, estimatedMs: number, percent: number, onSelect?: NotificationSelect) {
  return notifyIssue(repo, issue, t("Estimatet för pågående arbete har överskridits"), `timeout:${repo.full_name}:${issue.id}:${issue.startedAt}`, timeoutDetail(issue, estimatedMs, percent, Date.now()), onSelect);
}
async function notifyIssue(repo: Repo, issue: Issue, description: string, tag: string, detail?: string, onSelect?: NotificationSelect) {
  if (notificationPermission() !== "granted") return;
  const title = `${repo.name} · ${description}`;
  const options = {
    body: `#${issue.number} ${issue.title}${detail ? "\n" + detail : ""}`,
    tag,
    icon: new URL("favicon.svg", document.baseURI).href,
  };
  try {
    const notice = trackPageNotification(new Notification(title, options));
    const previousClose = notice.onclose;
    notice.onclose = (event) => {
      activePageNotifications.delete(notice);
      if (typeof previousClose === "function") previousClose.call(notice, event);
    };
    notice.onclick = () => {
      try {
        notice.close();
      } catch {
        // Best-effort
      }
      activePageNotifications.delete(notice);
      if (onSelect) {
        // Bring this dashboard tab forward and show the issue on its board (#278).
        window.focus();
        onSelect(repo, issue);
        return;
      }
      const url = new URL(issue.html_url);
      if (url.origin === "https://github.com")
        window.open(url.href, "_blank", "noopener,noreferrer");
    };
  } catch (error) {
    // Installed/mobile browsers may require service-worker notifications.
    const registration =
      "serviceWorker" in navigator
        ? await navigator.serviceWorker.getRegistration(
            new URL("./", document.baseURI).href,
          )
        : null;
    if (!registration?.active) throw error;
    await registration.showNotification(title, {
      ...options,
      // The worker focuses this app and opens the issue's board position from the hash (#278).
      data: { app: new URL("./" + issueNavigationHash({ repoId: repo.id, number: issue.number }), document.baseURI).href, url: issue.html_url },
    });
  }
}

/**
 * Closes all active notifications shown by this app: service-worker
 * notifications and any referenced page Notification instances (#312).
 * Swallows errors; closing is best-effort and never blocks or delays callers.
 */
export async function closeActiveNotifications(
  registration?: NotificationRegistrationLike | null,
): Promise<void> {
  // 1. Close tracked page-level notifications
  for (const notice of activePageNotifications) {
    try {
      notice.close();
    } catch {
      // Best-effort
    }
  }
  activePageNotifications.clear();

  // 2. Retrieve service worker registrations and close their notifications
  try {
    const registrations: NotificationRegistrationLike[] = [];
    if (registration) {
      registrations.push(registration);
    }

    if (typeof navigator !== "undefined" && "serviceWorker" in navigator && navigator.serviceWorker) {
      const sw = navigator.serviceWorker as unknown as {
        ready?: Promise<NotificationRegistrationLike>;
        getRegistration?(clientUrl?: string): Promise<NotificationRegistrationLike | undefined>;
        getRegistrations?(): Promise<ReadonlyArray<NotificationRegistrationLike>>;
      };

      if (sw.ready) {
        try {
          // In test environments or when SW is active, sw.ready resolves quickly.
          // Race with a small timeout so an unresolved ready promise never delays or blocks.
          const readyReg = await Promise.race([
            sw.ready,
            new Promise<undefined>((resolve) => setTimeout(resolve, 50)),
          ]);
          if (readyReg && !registrations.includes(readyReg)) {
            registrations.push(readyReg);
          }
        } catch {
          // Best-effort
        }
      }

      if (typeof sw.getRegistrations === "function") {
        try {
          const all = await sw.getRegistrations();
          if (all) {
            for (const r of all) {
              if (r && !registrations.includes(r)) registrations.push(r);
            }
          }
        } catch {
          // Best-effort
        }
      }

      if (typeof sw.getRegistration === "function") {
        try {
          const base =
            typeof document !== "undefined" && document.baseURI
              ? new URL("./", document.baseURI).href
              : undefined;
          const reg = await sw.getRegistration(base);
          if (reg && !registrations.includes(reg)) registrations.push(reg);
        } catch {
          // Best-effort
        }
      }
    }

    for (const reg of registrations) {
      if (typeof reg.getNotifications === "function") {
        try {
          const notices = await reg.getNotifications();
          if (notices) {
            for (const notice of notices) {
              try {
                notice.close();
              } catch {
                // Best-effort
              }
            }
          }
        } catch {
          // Best-effort
        }
      }
    }
  } catch {
    // Best-effort
  }
}
