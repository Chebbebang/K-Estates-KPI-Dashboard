import { useCallback, useEffect, useRef, useState } from 'react';

const REFRESH_MS = 60000;
const STALE_MS = 30000;

export default function useKpiData() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const etagRef = useRef(null);
  const lastFetchRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      lastFetchRef.current = Date.now();
      try {
        const res = await fetch('/api/kpis', {
          headers: etagRef.current ? { 'If-None-Match': etagRef.current } : {},
        });
        const nextEtag = res.headers.get('etag');
        if (nextEtag) etagRef.current = nextEtag;
        // 304 — nothing changed, keep current data
        if (res.status === 304) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled) {
          setData(json);
          setError(null);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e.message);
          setLoading(false);
        }
      }
    }

    load();
    const timer = setInterval(load, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastFetchRef.current > STALE_MS) {
        load();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshKey]);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);
  return { data, error, loading, refresh };
}