"use client";
import { useLayoutEffect, useRef, useSyncExternalStore } from "react";

/** Ref sempre com o valor mais recente (atualizada após o render, não durante). */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

const noopSubscribe = () => () => {};

/** true só no navegador, sem causar re-render extra nem divergência de hidratação. */
export function useIsClient() {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}
