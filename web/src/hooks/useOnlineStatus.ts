import { useEffect, useState } from "react";

const isBrowser = typeof window !== "undefined";

/** Tracks navigator online/offline state without touching the draft queue. */
export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(() => (isBrowser ? navigator.onLine !== false : true));

  useEffect(() => {
    if (!isBrowser) return;
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return isOnline;
}
