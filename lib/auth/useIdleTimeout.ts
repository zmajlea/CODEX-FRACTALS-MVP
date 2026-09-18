"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

const LAST_ACTIVE_KEY = "codex:last-active";
const LOGOUT_PING_KEY = "codex:auth-logout";
const AUTH_CHANNEL = "auth";
const ACTIVITY_THROTTLE_MS = 15_000;
/** Production default — gate asserts this exact value. Do not shorten in shipped code. */
export const IDLE_TIMEOUT_MS_DEFAULT = 3_600_000;

type Options = {
  loginUrl: string;
  /** Must stay 1h in production. Only override in tests. */
  timeoutMs?: number;
};

function readLastActive(): number {
  try {
    const raw = window.localStorage.getItem(LAST_ACTIVE_KEY);
    const n = raw != null ? Number(raw) : NaN;
    if (Number.isFinite(n) && n > 0) return n;
  } catch {
    /* private mode */
  }
  return Date.now();
}

function writeLastActive(ts: number) {
  try {
    window.localStorage.setItem(LAST_ACTIVE_KEY, String(ts));
  } catch {
    /* ignore */
  }
}

function idleLoginUrl(loginUrl: string): string {
  const join = loginUrl.includes("?") ? "&" : "?";
  return `${loginUrl}${join}reason=idle`;
}

/**
 * B32 — primary idle enforcer for open tabs (Supabase inactivity is the closed-tab backstop).
 *
 * Visibility ordering (load-bearing): on `visibilitychange`→visible, evaluate expiry
 * from stored lastActive (and getUser) BEFORE treating the event as activity. Resetting
 * first would let a 2h-idle user click back and stay signed in.
 */
export function useIdleTimeout({
  loginUrl,
  timeoutMs = IDLE_TIMEOUT_MS_DEFAULT,
}: Options): void {
  const router = useRouter();
  const signingOutRef = useRef(false);
  const lastWriteRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const supabase = createClient();

    function clearTimer() {
      if (timerRef.current != null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }

    function scheduleFrom(lastActive: number) {
      clearTimer();
      const remaining = lastActive + timeoutMs - Date.now();
      timerRef.current = setTimeout(() => {
        void onTimerFire();
      }, Math.max(0, remaining));
    }

    async function expireSession() {
      if (signingOutRef.current) return;
      signingOutRef.current = true;
      clearTimer();

      try {
        window.localStorage.setItem(LOGOUT_PING_KEY, String(Date.now()));
      } catch {
        /* ignore */
      }
      try {
        const bc = new BroadcastChannel(AUTH_CHANNEL);
        bc.postMessage({ type: "logout", reason: "idle" });
        bc.close();
      } catch {
        /* BroadcastChannel unsupported */
      }

      try {
        await supabase.auth.signOut();
      } catch {
        /* still redirect */
      }

      router.replace(idleLoginUrl(loginUrl));
    }

    /** Other tabs: sign out locally + redirect (do not re-broadcast). */
    async function followLogoutBroadcast() {
      if (signingOutRef.current) return;
      signingOutRef.current = true;
      clearTimer();
      try {
        await supabase.auth.signOut();
      } catch {
        /* ignore */
      }
      router.replace(idleLoginUrl(loginUrl));
    }

    async function onTimerFire() {
      const last = readLastActive();
      if (Date.now() - last < timeoutMs) {
        scheduleFrom(last);
        return;
      }
      await expireSession();
    }

    function markActivity() {
      if (signingOutRef.current) return;
      const now = Date.now();
      if (now - lastWriteRef.current < ACTIVITY_THROTTLE_MS) return;
      lastWriteRef.current = now;
      writeLastActive(now);
      scheduleFrom(now);
    }

    /**
     * Return-to-tab: expiry check FIRST, activity only if still valid.
     */
    async function onVisible() {
      if (document.visibilityState !== "visible") return;
      if (signingOutRef.current) return;

      const last = readLastActive();
      if (Date.now() - last >= timeoutMs) {
        await expireSession();
        return;
      }

      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          await expireSession();
          return;
        }
      } catch {
        await expireSession();
        return;
      }

      markActivity();
    }

    function onVisibilityChange() {
      void onVisible();
    }

    function onStorage(e: StorageEvent) {
      if (e.key === LOGOUT_PING_KEY && e.newValue) {
        void followLogoutBroadcast();
        return;
      }
      if (e.key === LAST_ACTIVE_KEY && e.newValue) {
        const n = Number(e.newValue);
        if (Number.isFinite(n)) scheduleFrom(n);
      }
    }

    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(AUTH_CHANNEL);
      channel.onmessage = (ev: MessageEvent) => {
        const data = ev.data as { type?: string } | null;
        if (data?.type === "logout") void followLogoutBroadcast();
      };
    } catch {
      channel = null;
    }

    if (!window.localStorage.getItem(LAST_ACTIVE_KEY)) {
      writeLastActive(Date.now());
    }
    scheduleFrom(readLastActive());

    const activityOpts: AddEventListenerOptions = { passive: true };
    const activityEvents = [
      "pointerdown",
      "keydown",
      "scroll",
      "wheel",
      "touchstart",
    ] as const;
    for (const ev of activityEvents) {
      window.addEventListener(ev, markActivity, activityOpts);
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("storage", onStorage);

    return () => {
      clearTimer();
      for (const ev of activityEvents) {
        window.removeEventListener(ev, markActivity, activityOpts);
      }
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("storage", onStorage);
      channel?.close();
    };
  }, [loginUrl, timeoutMs, router]);
}
