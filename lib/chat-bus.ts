import { useSyncExternalStore } from "react";

type Send = (text: string) => void;

let sender: Send | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

/** ChatView registers how to send a message (via SelectionMenu) */
export function setSender(fn: Send | null) {
  sender = fn;
  emit();
}

/** Send a message into the open chat */
export function sendToChat(text: string) {
  sender?.(text);
}

/** True when a chat is open and can receive messages */
export function useCanSend() {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    () => sender !== null,
    () => false
  );
}
