import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useResults } from './useResults';

it.each([502, 503, 504])('recovers from an initial HTTP %s without flashing an error', async status => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValueOnce({ ok: false, status })
        .mockResolvedValue({ ok: true, json: async () => ({ deployId: 'demo', complete: true }) });
    vi.stubGlobal('fetch', fetch);
    const hook = renderHook(() => useResults('demo'));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(hook.result.current.reconnecting).toBe(true);
    expect(hook.result.current.error).toBe('');
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(hook.result.current.results?.complete).toBe(true);
    expect(hook.result.current.reconnecting).toBe(false);
    expect(hook.result.current.error).toBe('');
    expect(vi.getTimerCount()).toBe(0);
});

it('backs off during a sustained outage, waits one minute before showing the error, and clears it on recovery', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal('fetch', fetch);
    const hook = renderHook(() => useResults('demo'));
    await act(async () => { await vi.advanceTimersByTimeAsync(12000); });
    expect(fetch).toHaveBeenCalledTimes(5); // 0, 1, 3, 7, 12 seconds.
    expect(hook.result.current.error).toBe('');
    await act(async () => { await vi.advanceTimersByTimeAsync(47000); });
    expect(hook.result.current.error).toBe('');
    expect(hook.result.current.reconnecting).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(hook.result.current.error).toContain('HTTP 503');
    expect(hook.result.current.reconnecting).toBe(false);
    fetch.mockResolvedValue({ ok: true, json: async () => ({ deployId: 'demo', complete: true }) });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(hook.result.current.error).toBe('');
    expect(hook.result.current.results?.complete).toBe(true);
});

it('keeps the last known deployment status during a network interruption', async () => {
    vi.useFakeTimers();
    const data = { deployId: 'demo', complete: false, currentCommand: 'sf project deploy start' };
    const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => data })
        .mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetch);
    const hook = renderHook(() => useResults('demo'));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(hook.result.current.results).toEqual(data);
    expect(hook.result.current.reconnecting).toBe(true);
    expect(hook.result.current.error).toBe('');
    hook.unmount();
    expect(vi.getTimerCount()).toBe(0);
});

it('shows non-transient HTTP errors immediately', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    const hook = renderHook(() => useResults('demo'));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(hook.result.current.error).toContain('HTTP 403');
    expect(hook.result.current.reconnecting).toBe(false);
});

it('polls without overlap, stops on completion, and clears timers', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ deployId: 'demo', complete: false }) })
        .mockResolvedValue({ ok: true, json: async () => ({ deployId: 'demo', complete: true }) });
    vi.stubGlobal('fetch', fetch);
    const hook = renderHook(() => useResults('demo'));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(hook.result.current.results?.complete).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(fetch).toHaveBeenCalledTimes(2);
    hook.unmount();
    expect(vi.getTimerCount()).toBe(0);
});

it('stops polling after 30 minutes and rejects mismatched deployment responses', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ deployId: 'other', complete: false }) });
    vi.stubGlobal('fetch', fetch);
    const hook = renderHook(() => useResults('demo'));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(hook.result.current.results).toBeUndefined();
    expect(hook.result.current.error).toContain('not available');
    await act(async () => { await vi.advanceTimersByTimeAsync(30 * 60 * 1000); });
    expect(hook.result.current.error).toContain('30 minutes');
    const count = fetch.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(fetch).toHaveBeenCalledTimes(count);
});
