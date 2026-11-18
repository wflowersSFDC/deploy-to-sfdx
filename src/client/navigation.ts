export function currentRoute() {
    const raw = window.location.hash.slice(1) || `${window.location.pathname}${window.location.search}`;
    const split = raw.indexOf('?');
    const name = (split < 0 ? raw : raw.slice(0, split)).replace(/^\/+|\/+$/g, '') || 'home';
    return { name, query: new URLSearchParams(split < 0 ? '' : raw.slice(split + 1)) };
}

export function templates(query: URLSearchParams) {
    return [...query.getAll('template'), ...query.getAll('template[]')].filter(Boolean);
}

export function templateUrl(base: string, values: string[], extra: Record<string, string> = {}) {
    const query = new URLSearchParams(extra);
    values.forEach(value => query.append('template', value));
    return `${base}?${query}`;
}

export function safeUrl(value?: string): string | undefined {
    if (!value) return undefined;
    try {
        const url = new URL(value, window.location.origin);
        return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined;
    } catch { return undefined; }
}
