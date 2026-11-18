import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App from './App';
import { safeUrl, templateUrl } from './navigation';

function open(route: string) { window.history.replaceState({}, '', route); return render(<App />); }
function response(data: unknown, status = 200) { return { ok: status === 200, status, json: async () => data }; }
const complete = { deployId: 'demo', complete: true, mainUser: { username: 'admin@example.com', password: 'test-password', loginUrl: 'https://example.com/login' }, commandResults: [{ command: 'sf project deploy start', summary: 'Deploy metadata', raw: { status: 0 } }], herokuResults: [{ appName: 'Demo app', openUrl: 'https://example.com/app', dashboardUrl: 'https://dashboard.heroku.com/apps/demo' }] };

describe('routes and forms', () => {
    it('renders the home page and preserves launch submission', () => {
        open('/');
        expect(screen.getByRole('heading', { name: 'Deploy a Salesforce project' })).toBeTruthy();
        const input = screen.getByLabelText('GitHub repository URL') as HTMLInputElement;
        expect(input.form?.getAttribute('action')).toBe('/launch');
        expect(input.required).toBe(true);
    });
    it.each(['/userinfo', '/#userinfo'])('preserves repeated template parameters and email at %s', route => {
        open(`${route}?template=https%3A%2F%2Fgithub.com%2Fa%2Fb&template=https%3A%2F%2Fgithub.com%2Fc%2Fd&email=a%2Bb%40example.com`);
        const input = screen.getByLabelText('Email') as HTMLInputElement;
        const data = new FormData(input.form!);
        expect(data.getAll('template')).toEqual(['https://github.com/a/b', 'https://github.com/c/d']);
        expect(data.get('email')).toBe('a+b@example.com');
        expect(input.form?.checkValidity()).toBe(true);
        fireEvent.change(input, { target: { value: 'invalid' } });
        expect(input.form?.checkValidity()).toBe(false);
    });
    it('renders error text as text, not markup', () => {
        open('/#error?msg=%3Cscript%3Ealert(1)%3C%2Fscript%3E');
        expect(screen.getByRole('alert').textContent).toBe('<script>alert(1)</script>');
        expect(document.querySelector('script')).toBeNull();
    });
    it('handles missing templates, deletion confirmation, and unknown routes', () => {
        open('/#byoo');
        expect(screen.getByText('A repository is required')).toBeTruthy();
        act(() => { window.location.hash = '#deleteConfirm'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
        expect(screen.getByText('Your org is marked for deletion')).toBeTruthy();
        act(() => { window.location.hash = '#unknown'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
        expect(screen.getByText('Page not found')).toBeTruthy();
    });
    it('preserves trial form field names and POST destination', () => {
        open('/#testform');
        const form = (screen.getByLabelText('Email') as HTMLInputElement).form!;
        expect(form.method).toBe('post');
        expect(form.getAttribute('action')).toContain('/trial?template=');
        expect([...new FormData(form).keys()]).toEqual(['UserEmail', 'UserFirstName', 'UserLastName']);
    });
    it('encodes templates and disallows script links', () => {
        expect(new URL(templateUrl('/launch', ['https://github.com/a/b?x=1&y=2'], { email: 'a+b@example.com' }), 'http://localhost').searchParams.get('template')).toBe('https://github.com/a/b?x=1&y=2');
        expect(safeUrl('javascript:alert(1)')).toBeUndefined();
    });
});

describe('org sign-in', () => {
    it('loads both authentication links and builds a real /launch fallback', async () => {
        const fetch = vi.fn().mockImplementation(async (url: string) => ({ ok: true, text: async () => url.includes('base_url') ? 'https://test.salesforce.com/auth' : 'https://login.salesforce.com/auth' }));
        vi.stubGlobal('fetch', fetch);
        open('/#byoo?template=https://github.com/a/b&template=https://github.com/c/d');
        await screen.findByRole('link', { name: 'Deploy to a Regular Org' });
        expect(fetch.mock.calls).toHaveLength(2);
        const fallback = screen.getByRole('link', { name: 'Deploy to a Scratch Org' }) as HTMLAnchorElement;
        expect(new URL(fallback.href).pathname).toBe('/launch');
        expect(new URL(fallback.href).searchParams.getAll('template')).toHaveLength(2);
    });
    it('shows authentication setup failures', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
        open('/#byoo?template=https://github.com/a/b');
        expect((await screen.findByRole('alert')).textContent).toContain('Unable to prepare');
    });
});

describe('deployment results', () => {
    it('shows completed org credentials and command details', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(complete)));
        open('/#deploying/deployer/demo');
        await screen.findByText('Deployment complete');
        expect(screen.queryByRole('progressbar')).toBeNull();
        expect(screen.getByText('admin@example.com')).toBeTruthy();
        expect(screen.getByText('test-password')).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Launch' }).getAttribute('href')).toBe('https://example.com/login');
        expect(screen.queryByRole('link', { name: 'Open App' })).toBeNull();
        fireEvent.click(screen.getByText('Deploy metadata'));
        expect(screen.getByText(/"status": 0/)).toBeTruthy();
    });
    it('shows backend errors and hides deletion for BYOO', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...complete, isByoo: true, errors: [{ command: 'create', error: 'Scratch org limit reached' }] })));
        open('/deploying/deployer/demo');
        await screen.findByText('Scratch org limit reached');
        expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
        expect(screen.getByText('Deployment failed')).toBeTruthy();
    });
    it('posts deletion to the existing endpoint and reports failures', async () => {
        const fetch = vi.fn().mockImplementation(async (url: string) => url === '/delete' ? response({}, 503) : response(complete));
        vi.stubGlobal('fetch', fetch);
        open('/#deploying/deployer/demo');
        fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
        await screen.findByText('Unable to delete this org. Please try again.');
        expect(fetch).toHaveBeenCalledWith('/delete', expect.objectContaining({ method: 'POST', body: '{"deployId":"demo"}' }));
    });
    it('shows a reconnecting status for a temporary service outage', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({}, 503)));
        open('/#deploying/deployer/demo');
        await screen.findByText('Reconnecting to deployment updates…');
        expect(screen.queryByRole('alert')).toBeNull();
    });
    it('shows trial loading and surfaces trial errors', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ deployId: 'demo', complete: true, errors: [{ command: 'create', error: 'Trial unavailable' }] })));
        open('/#deploying/trial/demo');
        expect(screen.getByText('Setting things up')).toBeTruthy();
        await screen.findByText('Trial unavailable');
    });
    it('aborts the previous request when moving to another deployment', async () => {
        const signals: AbortSignal[] = [];
        vi.stubGlobal('fetch', vi.fn().mockImplementation((_url, init) => { signals.push(init.signal); return new Promise(() => {}); }));
        open('/#deploying/deployer/first');
        act(() => { window.location.hash = '#deploying/deployer/second'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
        await waitFor(() => expect(signals.length).toBeGreaterThanOrEqual(2));
        expect(signals[0].aborted).toBe(true);
        expect(screen.getByText('second')).toBeTruthy();
    });
});
