/** Spec 46e Stage 9a — session open/close rules for the non-modal drafts drawer. */

import type { DraftKind } from "@/lib/treasury/pickable";

type Listener = () => void;

let open = false;
/** Once the operator closes the drawer, picks must not reopen it this session. */
let explicitlyClosed = false;
let lastPickOpenedDrawer = false;
let lastPickKind: DraftKind | null = null;
let pendingAnnounce: string | null = null;

const listeners = new Set<Listener>();

function notify() {
  listeners.forEach((l) => l());
}

export function subscribeDraftsDrawer(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getDraftsDrawerOpen(): boolean {
  return open;
}

export function getLastPickKind(): DraftKind | null {
  return lastPickKind;
}

export function lastPickOpenedTheDrawer(): boolean {
  return lastPickOpenedDrawer;
}

/** Rail tab / close button — opening manually does not clear the explicit-close flag. */
export function setDraftsDrawerOpenFromUi(next: boolean) {
  if (!next) {
    explicitlyClosed = true;
  }
  open = next;
  notify();
}

/** Before POST — so the rail can announce after settle. */
export function prepareDraftsPickAnnounce(
  provenanceShort: string,
  surface: string
) {
  pendingAnnounce = `Added: ${provenanceShort}, from ${surface}`;
}

export function consumeDraftsPickAnnounce(): string | null {
  const a = pendingAnnounce;
  pendingAnnounce = null;
  return a;
}

/**
 * Call on successful pick settle (not on duplicate).
 * First pick of the session opens the drawer without focus steal.
 */
export function onEvidencePickSettled(draftKind: DraftKind): {
  openedDrawer: boolean;
} {
  lastPickKind = draftKind;
  if (!open && !explicitlyClosed) {
    open = true;
    lastPickOpenedDrawer = true;
    notify();
    return { openedDrawer: true };
  }
  lastPickOpenedDrawer = false;
  notify();
  return { openedDrawer: false };
}
