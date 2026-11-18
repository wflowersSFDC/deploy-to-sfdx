import { useEffect, useState } from 'react';
import type { Results } from './types';

export function useResults(deployId: string, retry = 0) {
    const [results, setResults] = useState<Results>();
    const [error, setError] = useState('');
    const [reconnecting, setReconnecting] = useState(false);
    useEffect(() => {
        setResults(undefined);
        setError('');
        setReconnecting(false);
        let failureStarted: number | undefined;
        let failures = 0;
        let stopped = false;
        let next: ReturnType<typeof setTimeout>;
        let request: AbortController;
        let requestTimeout: ReturnType<typeof setTimeout>;
        const deadline = setTimeout(() => {
            stopped = true;
            clearTimeout(next);
            clearTimeout(requestTimeout);
            request?.abort();
            setReconnecting(false);
            setError('Status updates paused after 30 minutes. Retry to check the deployment again.');
        }, 30 * 60 * 1000);
        async function poll() {
            let transient = false;
            request = new AbortController();
            requestTimeout = setTimeout(() => request.abort(), 15000);
            try {
                let response: Response;
                try {
                    response = await fetch(`/results/${encodeURIComponent(deployId)}`, { signal: request.signal });
                } catch (cause) {
                    transient = true; // Network interruption or request timeout.
                    throw cause;
                }
                if (!response.ok) {
                    transient = [502, 503, 504].includes(response.status);
                    throw new Error(`Unable to retrieve deployment status (HTTP ${response.status}).`);
                }
                const data: Results = await response.json();
                if (!data || data.deployId !== deployId || typeof data.complete !== 'boolean') {
                    throw new Error('Deployment status is not available yet.');
                }
                if (stopped) return;
                setResults(data);
                setError('');
                setReconnecting(false);
                failureStarted = undefined;
                failures = 0;
                if (data.complete) { stopped = true; clearTimeout(deadline); }
            } catch (cause) {
                if (!stopped) {
                    failures++;
                    failureStarted ??= Date.now();
                    const recovering = transient && Date.now() - failureStarted < 60000;
                    setReconnecting(recovering);
                    setError(recovering ? '' : cause instanceof Error && cause.name !== 'AbortError' ? cause.message : 'Status request timed out. Retrying…');
                }
            } finally {
                clearTimeout(requestTimeout);
                if (!stopped) next = setTimeout(poll, transient ? Math.min(1000 * 2 ** Math.min(failures - 1, 3), 5000) : 1000);
            }
        }
        void poll();
        return () => { stopped = true; clearTimeout(next); clearTimeout(deadline); clearTimeout(requestTimeout); request?.abort(); };
    }, [deployId, retry]);
    return { results, error, reconnecting };
}
