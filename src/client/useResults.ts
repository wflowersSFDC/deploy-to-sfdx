import { useEffect, useState } from 'react';
import type { Results } from './types';

export function useResults(deployId: string, retry = 0) {
    const [results, setResults] = useState<Results>();
    const [error, setError] = useState('');
    useEffect(() => {
        setResults(undefined);
        setError('');
        let stopped = false;
        let next: ReturnType<typeof setTimeout>;
        let request: AbortController;
        let requestTimeout: ReturnType<typeof setTimeout>;
        const deadline = setTimeout(() => {
            stopped = true;
            clearTimeout(next);
            clearTimeout(requestTimeout);
            request?.abort();
            setError('Status updates paused after 30 minutes. Retry to check the deployment again.');
        }, 30 * 60 * 1000);
        async function poll() {
            request = new AbortController();
            requestTimeout = setTimeout(() => request.abort(), 15000);
            try {
                const response = await fetch(`/results/${encodeURIComponent(deployId)}`, { signal: request.signal });
                if (!response.ok) throw new Error(`Unable to retrieve deployment status (HTTP ${response.status}).`);
                const data: Results = await response.json();
                if (!data || data.deployId !== deployId || typeof data.complete !== 'boolean') {
                    throw new Error('Deployment status is not available yet.');
                }
                if (stopped) return;
                setResults(data);
                setError('');
                if (data.complete) { stopped = true; clearTimeout(deadline); }
            } catch (cause) {
                if (!stopped) setError(cause instanceof Error && cause.name !== 'AbortError' ? cause.message : 'Status request timed out. Retrying…');
            } finally {
                clearTimeout(requestTimeout);
                if (!stopped) next = setTimeout(poll, 1000);
            }
        }
        void poll();
        return () => { stopped = true; clearTimeout(next); clearTimeout(deadline); clearTimeout(requestTimeout); request?.abort(); };
    }, [deployId, retry]);
    return { results, error };
}
