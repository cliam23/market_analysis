import { useRef, useEffect, useCallback } from "react";

/**
 * Manages a single in-flight AbortController for API calls.
 * beginRequest() aborts any previous request and returns a new controller.
 */
export function useAbortableApi() {
  const acRef = useRef(null);

  const abortInFlight = useCallback(() => {
    if (acRef.current) {
      acRef.current.abort();
      acRef.current = null;
    }
  }, []);

  const beginRequest = useCallback(() => {
    abortInFlight();
    const ac = new AbortController();
    acRef.current = ac;
    return ac;
  }, [abortInFlight]);

  const clearIfCurrent = useCallback((ac) => {
    if (acRef.current === ac) acRef.current = null;
  }, []);

  useEffect(() => () => abortInFlight(), [abortInFlight]);

  return { abortInFlight, beginRequest, clearIfCurrent };
}

export function isAbortError(err) {
  return err?.name === "AbortError";
}
