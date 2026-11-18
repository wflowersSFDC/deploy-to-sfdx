import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useResults } from './useResults';

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
