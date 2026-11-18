import { useEffect, useState, type ReactNode } from 'react';
import { currentRoute, safeUrl, templates, templateUrl } from './navigation';
import { useResults } from './useResults';

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
    return <section className={`slds-card panel ${className}`}>{children}</section>;
}

function LinkButton({ href, children, external = false, primary = false }: { href?: string; children: ReactNode; external?: boolean; primary?: boolean }) {
    const url = safeUrl(href);
    return url ? <a className={`slds-button ${primary ? "slds-button_brand" : "slds-button_neutral"}`} href={url} target={external ? '_blank' : undefined}
        rel={external ? 'noopener noreferrer' : undefined}>{children}</a> : null;
}

function ErrorMessage({ children }: { children: ReactNode }) {
    return <div role="alert" className="notice error">{children}</div>;
}

function Home() {
    return <Card><h2>Deploy a Salesforce project</h2>
        <p>Use a deployment link from your project, or provide a GitHub repository below.</p>
        <form action="/launch" method="get">
            <label htmlFor="template">GitHub repository URL</label>
            <input className="slds-input" id="template" name="template" type="url" required placeholder="https://github.com/owner/repository" />
            <button className="slds-button slds-button_brand" type="submit">Deploy to a Scratch Org</button>
        </form>
        <p><a href="https://github.com/wflowersSFDC/deploy-to-sfdx" target="_blank" rel="noopener noreferrer">Source code and documentation</a></p>
    </Card>;
}

function UserInfo({ query }: { query: URLSearchParams }) {
    const values = templates(query);
    if (!values.length) return <MissingTemplate />;
    return <Card><h2>Your email address</h2><p>Your email address will be used in your new org.</p>
        <form action="/launch" method="get">
            {values.map((value, i) => <input key={i} type="hidden" name="template" value={value} />)}
            <label htmlFor="email">Email</label>
            <input className="slds-input" id="email" name="email" type="email" required defaultValue={query.get('email') || ''} />
            <button className="slds-button slds-button_brand" type="submit">Go</button>
        </form>
    </Card>;
}

function MissingTemplate() {
    return <Card><h2>A repository is required</h2><p>Include a template parameter in the URL pointing to an accessible GitHub repository.</p><a href="/#home">Go to home</a></Card>;
}

function Byoo({ query }: { query: URLSearchParams }) {
    const values = templates(query);
    const templateKey = JSON.stringify(values);
    const [links, setLinks] = useState<string[]>([]);
    const [error, setError] = useState('');
    useEffect(() => {
        setLinks([]);
        setError('');
        if (!values.length) return;
        const controller = new AbortController();
        const urls = [templateUrl('/authUrl', values), templateUrl('/authUrl', values, { base_url: 'https://test.salesforce.com' })];
        void Promise.all(urls.map(async url => {
            const response = await fetch(url, { signal: controller.signal });
            if (!response.ok || response.redirected) throw new Error('Unable to prepare org sign-in. Please try again later.');
            const link = (await response.text()).trim();
            if (!/^https?:\/\//i.test(link) || !safeUrl(link)) throw new Error('The sign-in service returned an invalid link.');
            return link;
        })).then(result => { if (!controller.signal.aborted) setLinks(result); })
            .catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
        return () => controller.abort();
    }, [templateKey]);
    if (!values.length) return <MissingTemplate />;
    return <Card><h2>Deploy to an org you own</h2><p>Projects to deploy:</p>
        <ul>{values.map((value, i) => <li key={i}><a href={safeUrl(value)} target="_blank" rel="noopener noreferrer">{value}</a></li>)}</ul>
        <p>This will install metadata and run scripts in the org. <strong>Make sure you sign in to the right org.</strong></p>
        {error ? <ErrorMessage>{error}</ErrorMessage> : !links.length ? <p role="status">Preparing sign-in links…</p> :
            <div className="actions"><LinkButton href={links[0]}>Deploy to a Regular Org</LinkButton>
                <LinkButton href={links[1]}>Deploy to a Sandbox/Scratch Org</LinkButton></div>}
        <p>Or create a new scratch org for this deployment.</p>
        <LinkButton href={templateUrl('/launch', values)}>Deploy to a Scratch Org</LinkButton>
    </Card>;
}

function TestForm() {
    return <Card><h2>Trial request test form</h2><p>This is a form for testing. The public form lives on Salesforce.com.</p>
        <form action="/trial?template=https://github.com/mshanemc/platformTrial" method="post">
            {['Email', 'FirstName', 'LastName'].map(field => <div key={field}>
                <label htmlFor={`User${field}`}>{field === 'FirstName' ? 'First name' : field === 'LastName' ? 'Last name' : field}</label>
                <input className="slds-input" type={field === 'Email' ? 'email' : 'text'} id={`User${field}`} name={`User${field}`} />
            </div>)}
            <button className="slds-button slds-button_brand" type="submit">Submit</button>
        </form>
    </Card>;
}

function rawOutput(value: unknown) { return typeof value === 'string' ? value : JSON.stringify(value, null, 2); }

function Deployment({ deployId, trial = false }: { deployId: string; trial?: boolean }) {
    const [retry, setRetry] = useState(0);
    const { results, error } = useResults(deployId, retry);
    const [deleting, setDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState('');
    // Preserve the existing trial handoff after the first valid status response.
    useEffect(() => {
        if (trial && results && !results.errors?.length) window.location.replace('https://www.salesforce.com/form/signup/conf/freetrial-platform/');
    }, [trial, results]);
    const user = results?.mainUser;
    const commands = results?.commandResults || [];
    const errors = results?.errors || [];
    const percent = Math.min(100, Math.max(1, (commands.length / (results?.lineCount || 50)) * 100));
    async function deleteOrg() {
        setDeleting(true);
        setDeleteError('');
        try {
            const response = await fetch('/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deployId }) });
            if (!response.ok) throw new Error('Unable to delete this org. Please try again.');
            const data = await response.json();
            const url = new URL(data.redirectTo, window.location.origin);
            if (url.origin !== window.location.origin || url.hash !== '#deleteConfirm') throw new Error('Unexpected deletion response.');
            window.location.assign(url.href);
        } catch (cause) { setDeleteError(cause instanceof Error ? cause.message : 'Deletion failed.'); setDeleting(false); }
    }
    return <div className={trial ? undefined : "deployment-layout"}>
        <Card className={`deployment-status ${results?.complete ? errors.length ? "status-failed" : "status-complete" : "status-running"}`}><div className="status-heading"><span className="status-symbol" aria-hidden="true">{results?.complete ? errors.length ? "!" : "✓" : "↗"}</span><div><h2>{trial ? 'Setting things up' : results?.complete ? errors.length ? 'Deployment failed' : 'Deployment complete' : 'Deploying your project'}</h2>
            {trial ? <p>We’re preparing your Agentforce 360 Platform Free Trial.</p> : <p className="deployment-id">{deployId}</p>}</div>{!trial && <span className="status-badge">{results?.complete ? errors.length ? "Needs attention" : "Ready to use" : "In progress"}</span>}</div>
            {!results?.complete && <><progress aria-label={`Deploying ${deployId}`} value={percent} max="100" /><p role="status">{results?.currentCommand ? 'Deployment in progress' : 'Waiting for deployment updates…'}</p></>}
            {error && <ErrorMessage>{error} <button className="slds-button slds-button_neutral" onClick={() => setRetry(n => n + 1)}>Retry</button></ErrorMessage>}
        </Card>
        {!!errors.length && <ErrorMessage><h2>An error occurred while deploying</h2>{errors.map((item, i) => <div key={i}><p>{item.error}</p><code>{item.command}</code></div>)}</ErrorMessage>}
        <div className="deployment-columns"><div className="deployment-overview">
        {user?.loginUrl && <Card className="org-access"><h2>Your org is ready!</h2><p>Use Launch for your first login. DNS updates can take up to five minutes.</p>
            <div className="actions"><LinkButton href={user.loginUrl} external primary>Launch</LinkButton>
                {!results?.isByoo && <button className="slds-button slds-button_destructive" disabled={deleting} onClick={deleteOrg}>{deleting ? 'Deleting…' : 'Delete'}</button>}</div>
            {results?.expirationDate && <p>Your org will expire on <strong>{results.expirationDate}</strong>.</p>}
            {deleteError && <ErrorMessage>{deleteError}</ErrorMessage>}
        </Card>}
        {user?.password && <Card className="credentials-card"><h2>Org credentials</h2><p>For integrations and mobile apps:</p>
            <dl><dt>Username</dt><dd>{user.username}</dd><dt>Password</dt><dd>{user.password}</dd></dl>
            <p>Sign in at <a href="https://test.salesforce.com/" target="_blank" rel="noopener noreferrer">test.salesforce.com</a>.</p>
        </Card>}
        </div><div className="deployment-activity">
        {results?.currentCommand && !results.complete && <Card><h2>Currently running</h2><code>{results.currentCommand}</code></Card>}
        {!trial && <Card className="activity-card"><div className="card-heading"><h2>Completed commands</h2><span className="count-badge">{commands.length}</span></div>{!commands.length ? <p>No commands have completed yet.</p> : <ol className="commands">{commands.map((item, i) => <li key={i}>
            <details><summary><span className="command-check" aria-hidden="true">✓</span><span className="command-label">{item.summary || item.shortForm || item.command || 'Command output'}</span><span className="disclosure-arrow" aria-hidden="true">›</span></summary><pre>{item.command}</pre>{item.raw !== undefined && <pre>{rawOutput(item.raw)}</pre>}</details>
        </li>)}</ol>}</Card>}
        </div></div>
    </div>;
}

export default function App() {
    const [route, setRoute] = useState(currentRoute);
    useEffect(() => {
        const update = () => setRoute(currentRoute());
        window.addEventListener('hashchange', update);
        window.addEventListener('popstate', update);
        return () => { window.removeEventListener('hashchange', update); window.removeEventListener('popstate', update); };
    }, []);
    const match = /^deploying\/(deployer|trial)\/(.+)$/.exec(route.name);
    let content: ReactNode;
    if (match) {
        try { const id = decodeURIComponent(match[2]); content = <Deployment key={`${match[1]}:${id}`} deployId={id} trial={match[1] === 'trial'} />; }
        catch { content = <ErrorMessage>Invalid deployment URL.</ErrorMessage>; }
    } else switch (route.name) {
        case 'home': content = <Home />; break;
        case 'userinfo': content = <UserInfo key={route.query.toString()} query={route.query} />; break;
        case 'byoo': content = <Byoo query={route.query} />; break;
        case 'testform': content = <TestForm />; break;
        case 'deleteConfirm': content = <Card><h2>Your org is marked for deletion</h2><a href="/#home">Return home</a></Card>; break;
        case 'error': content = <Card><ErrorMessage>{route.query.get('msg') || 'Something went wrong.'}</ErrorMessage><p>Please <a href="https://www.platformdemos.com/s/contactsupport" target="_blank" rel="noopener noreferrer">contact support</a> for help.</p></Card>; break;
        default: content = <Card><h2>Page not found</h2><a href="/#home">Return home</a></Card>;
    }
    return <><a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById("main-content")?.focus(); }}>Skip to content</a><header><div className="brand"><a href="/#home" aria-label="Home"><img src="/resources/images/salesforce_cloud.png" alt="Salesforce" width="48" /></a><div><span className="brand-eyebrow">SALESFORCE DX</span><h1>Public Deployer</h1></div></div><a className="platform-link" href="https://platformdemos.com"><span aria-hidden="true">←</span> Back to Platform Demos</a></header><main id="main-content" tabIndex={-1}>{content}</main><footer><span>Salesforce DX Public Deployer</span></footer></>;
}
