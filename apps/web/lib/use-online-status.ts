"use client";

import { useSyncExternalStore } from "react";

// 订阅浏览器在线状态：online / offline 事件 + navigator.onLine。
// SSR 与首屏快照固定为 true，避免服务端与客户端不一致造成 hydration 抖动。

function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

function getSnapshot(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine !== false;
}

function getServerSnapshot(): boolean {
  return true;
}

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
