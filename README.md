# SFDX Deployer

[![npm version](https://badge.fury.io/js/shane-sfdx-plugins.svg)](https://badge.fury.io/js/shane-sfdx-plugins)

Front end: [LWC](lwc.dev)

Back end: Node.js/Express/TypeScript + Heroku buildpacks

Test: jest

The Heroku deployment targets the `heroku-26` Cedar stack and Node.js 22 LTS.
Node is pinned in `package.json` so Heroku doesn't silently move this legacy
LWC/Webpack build to a newer major runtime. The client build enables Node's
legacy OpenSSL provider only while compiling the existing Webpack bundle; it is
not enabled for running dynos.

The Salesforce CLI buildpack ships a standalone CLI with its own Node runtime;
the `package.json` pin alone does not control it. `.profile` sets oclif's
`node-custom` runtime to `/app/.heroku/node/bin/node`, so oclif-based CLIs use
the app's Node 22 as well. In testing, the bundled Node 26 crashed while loading
`sf-demo-utils` with `Cannot read properties of undefined (reading 'prototype')`.
The same plugin loaded under Node 22, and the sfconnect scratch-create command
successfully created a test org locally. That test org was deleted afterward.
The app now implements the four `demoutil` commands internally and no longer
installs that plugin. The runtime pin remains for the other legacy plugins.

After deploying, compare `node --version` and `sf --version` in a dyno. Both
should report Node 22. Command failures now preserve non-JSON CLI error output
and mark deployment results complete with an error, rather than leaving the
browser showing an indefinitely running command.

[Video explanation](https://youtu.be/gyGt386eAqw?t=1168) from May 2019 (TDX) (some things have changed, especially LWC instead of vue)

## Purpose

You have a dev hub, and an sfdx repo. You'd like to let people spin up scratch orgs based on the repo, and these people might not feel like using a terminal, cloning the repo, loggin in to a dev hub, and executing sfdx commands.

-   because they might not be developers (think admins, or even end users in a training scenario)
-   because they might not be Salesforce developers (say you built an app and give your designer/CSS person github access to "make it cool")
-   because you might have dev hub access and you don't want to give it to them
-   because you want to let people test the app quickly
-   because (like me) you're using it for workshops and demos

---

## Connected app setup

Create a connected app for JWT auth, with certificates, per the SFDX setup guide.

<https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_auth_jwt_flow.htm>

The hub integration uses the OAuth 2.0 JWT bearer flow. It does not use an
authorization code or store a refresh token, so the Connected App can require
PKCE and can rotate or expire refresh tokens without requiring a different hub
authentication flow in this application.

Configure the Connected App used by `HUB_USERNAME` as follows:

- Keep **Use digital signatures** enabled with the certificate whose private
  key is supplied in `JWTKEY` or `LOCAL_ONLY_KEY_PATH`.
- Set **Permitted Users** to **Admin approved users are pre-authorized**.
- Grant `HUB_USERNAME` access to the Connected App through a permission set or
  profile. This avoids relying on a previous self-authorization approval that
  can disappear when refresh tokens expire or are revoked.
- Keep the required API OAuth scope. PKCE and refresh-token security policies
  may remain enabled; they do not apply to the JWT bearer token request.

---

## Environment variables

you can find a list of all the env vars in <https://github.com/mshanemc/deploy-to-sfdx/blob/master/src/server/lib/processWrapper.ts>

### Required

-   `HUB_USERNAME` the username from your dev hub
-   `CONSUMERKEY` from your connected app
-   `REDIS_URL` starts with `redis://` (probably set up automatically when you use the heroku button)

### Plus one of the following, depending on where you're running

-   `JWTKEY` use only in heroku cloud. Cut/paste your server.key, including the ---- lines
-   `LOCAL_ONLY_KEY_PATH` don't use this in the cloud. Put it in your local .env file, and it needs to be an absolute path

### strongly recommended

-   `HEROKU_API_KEY` can run one-off dynos, needed for org pools (see below) and lets you combine the deployer with my sfdx plugin to deploy heroku apps to a team. If you're note using org pools, be sure to delete these heroku apps. See [the plugin docs](https://github.com/mshanemc/shane-sfdx-plugins#sfdx-shaneherokurepodeploy) for how to use this

### optional

-   `UA_ID` for google analytics measurement protocol
-   `GITHUB_USERNAME_WHITELIST` lets you whitelist usernames. It's a comma-separated list. Ex: `mshanemc,andrew,bebraw`
-   `GITHUB_REPO_WHITELIST` lets you whitelist username/repo combinations. It's a comma-separated list. Ex: `mshanemc/DF17integrationWorkshops,torvalds/linux`
-   if you need to use the prerelease version of the sfdx plugin, then set `SFDX_PRERELEASE` to true.
-   org pools -- see below for details
-   BYOO (bring your own org) -- see below for details

What's whitelisting do? Normally, this app will parse your orgInit.sh and throw an error if you're doing any funny business. BUT if you're on the whitelist, the app owner trusts you and you can do things with bash metacharacters (think &&, |, >) and execute non-sfdx commands (grep, rm, whatever!) etc. BE CAREFUL!

Here's a heroku button so you can have your own instance of the Deployer

[![Deploy](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy?template=https%3A%2F%2Fgithub.com%2Fmshanemc%2Fdeploy-to-sfdx)

---

## Heroku setup

Workers require Git at runtime to clone deployment repositories. `Aptfile`
installs Git through the `heroku-community/apt` buildpack, listed first in
`app.json`. For an existing app, add this buildpack before deploying this change
(editing `app.json` alone does not update existing buildpacks):

```shell
heroku buildpacks:add --index 1 heroku-community/apt -a hosted-scratch
```

A rebuild is required; restarting existing dynos does not install Git. After
deploying, verify the runtime with `heroku run 'git --version' -a hosted-scratch`.

For an existing app, `app.json` doesn't change the stack automatically. Test
the new stack in a review or staging app, then apply it to the existing app and
redeploy:

```shell
heroku stack:set heroku-26 -a hosted-scratch
git push heroku HEAD:main
```

The `app.json` stack setting applies to new Review Apps, Heroku CI apps, and
apps created with the Heroku button.

The button starts the web and org builder processes on Basic dynos. For higher
traffic, use Standard or Performance dynos and scale the web and org builder
processes according to demand.

If you're going to be doing a lot of users (imagine a workshop where lots of people are pushing the button at the same time) you can scale out more workers so the people last in line don't have to wait so long. Otherwise, it'll spin while the workers are busy processing the deploy request queue.

The oneoffbuilder is the same as the orgbuilder but exits when it's finished with its queue item. They do take ~30 seconds to spin up before starting to build an org, so having "live workers" is better. These give you the ability to scale out work horizontally (booting up a new dyno will be faster than waiting in line behind several other deploys on the always-live workers)

Up to you to balance costs between live workers (orgbuilder) and on-demand (oneoffbuilder).

Add Heroku Scheduler to your app and set `orgdeleter` to run every 10 minutes or so. Deleted orgs go into a deletion queue that isn't actively monitored so this will free up some scratch org capacity for you.
Then have `dynoskimmer` run every 10 minutes or so...it kills one-off dyno processes that stalled out
If you're using org pools, you also want to have scheduler running `poolwatcher` (checks actual pools vs. configuration and starts `poolbuilder` processes) and `poolskimmer` (deletes expired orgs from the pools) scheduled.

---

## Troubleshooting pool configuration

### Authenticated platformmarketing pool reads

To use the org's authenticated endpoint instead of the public Site, configure:

```text
POOLCONFIG_AUTH=jwt
POOLCONFIG_URL=https://platformmarketing.my.salesforce.com/services/apexrest/pools/Production
```

JWT mode uses the existing pool-drain integration's `PD_USERNAME`,
`PD_CONSUMERKEY` and `PD_KEY` credentials, separate from the Dev Hub credentials.
The connected app must authorize this integration user for the `api` scope, and
the user needs access to `poolsRestApi` and the records and fields it reads.
Prefer a dedicated integration user with only the required permissions; this
change does not alter the existing user's grants.

Keep the private key in Heroku config, never in the repository. For local use,
`PD_LOCAL_ONLY_KEY_PATH` can point to an external private-key file. The Dev Hub's
`LOCAL_ONLY_KEY_PATH` is no longer used as a fallback for the pool-drain key.

The app exchanges a short-lived RS256 assertion for an access token and sends
it only to the matching authenticated Salesforce org. Redirects are disabled;
authentication failures never fall back to anonymous access. Tokens and signed
assertions are not logged. Unset `POOLCONFIG_AUTH` preserves anonymous behavior
for existing installations; changing credentials alone does not enable JWT mode.

On November 17, 2026, a read-only check from `hosted-scratch` using its existing
pool-drain credentials successfully authenticated to platformmarketing and read
161 pool definitions (HTTP 200) from the org endpoint. Its anonymous Site
endpoint returned HTTP 500. The local code and configuration above must be
deployed and enabled before regular pool reads use authentication.

### Endpoint failures

`POOLCONFIG_URL` must return a JSON array of pool definitions. A successful
network connection is not enough: HTTP errors and invalid JSON prevent the
pool watcher from preparing new orgs. The loader uses a 20-second timeout and
reports the HTTP status and Salesforce error message without dumping the full
request and response objects.

The platformmarketing Production endpoint returned HTTP 500 on November 17,
2026: `poolsRestApi.actualWork` (line 19) reported that `GitHub_Repo__c` was not
available on `Demo__c`. This is an upstream endpoint failure. Check that class's
query against the org's current field API names and the site's execution
permissions. The endpoint's source is not included in this repository. Restore
its valid JSON response before expecting pool replenishment to work; changing
the Heroku buildpacks will not repair this query.

## Architectural overview

Nodejs, express run the web server.
When the web server receives a request, it creates a unique deployID (user-repo-timestamp plus a few random digits) and a message on the deploy queue (using Heroku Redis)
The server redirects the user to a web page which polls an http endpoint (/results/:deployId) for updated results

When a process starts up, it auths to a devhub via its environment variables.
Then it listens to the deploy queue and executes jobs

-   clone the repo into local filestorage
-   execute the orgInit.sh script, or the default create/push/open flow if there isn't one
-   drop the output results into a redis key (the deployId) so that the results endpoint can find it
-   delete the local folder and send the ALLDONE message

It runs a plugin that give it powers SFDX doesn't out-of-the-box
<https://github.com/mshanemc/shane-sfdx-plugins> along with `sfdx-migration-automatic` and `@salesforce/analytics` and `sfdmu` and `@salesforce/plugin-functions`

Put plugins in the package.json dependencies, then linked from source in lib/hubAuth.js. Feel free to add additional plugins using `yarn add` some-plugin-of-yours and then add it in hubAuth.ts.

---

## BYOO Bring your own org (optional, mildly dangerous)

Let people deploy from a repo to an existing org, and run some scripts. Set the BYOO environment variables to match a connected app (it needs to be a separate connected app from the one your hub uses because that one uses cert/jwt to auth, and this one won't have a cert).

You'll need to set the appropriate callback URIs for the /token page. Mine look like this (3 cloud environments plus local)

-   https://hosted-scratch.herokuapp.com/token
-   https://hosted-scratch-dev.herokuapp.com/token
-   https://deployer-prerelease.herokuapp.com/token
-   http://localhost:8443/token

### BYOO ConnectedApp Details

Your app should have the following scope

-   Access your basic information (id, profile, email, address, phone)
-   Access and manage your data (api)
-   Provide access to your data via the Web (web)
-   Allow access to your unique identifier (openid)

Users sign into their app, and then the deployer connects that instead of using a new scratch org. Password commands are omitted from the scripts, since that would be cruel.

Change the launcher url from `.../launch?template=...` to `.../byoo?template=...` to use the BYOO feature.

The page warns people about the risks of executing scripts in a non-scratch org. Expect failures because you can't guarantee that the target org has the features/settings your repo depends on.

---

## Org pools (optional, advanced!)

Building orgs that take too long? Ever have one that doesn't get its DNS ready in time? Know you're mostly deploying the same orgs all the time?

Org Pools are the answer. You tell it which username/repo pairs, and how many orgs you'd like pre-built. When the user requests one, you simply grab one from the pool. Orgs in the pool are less than 12 hours old so they stay fresh.

There's 3 worker dynos, both off by default (leave them that way).

-   If you want pools, use Heroku Scheduler to run the `poolwatcher` task up to every 10 minutes (as a one-off dyno). If any pool orgs need to be created, it'll start up one-off dynos to handle that
-   run poolskimmer with Heroku Scheduler every hour or so--it'll check for expired orgs to help keep you within your limits.

Then, in your .env/heroku config vars, point the deployer to some url that returns json.
`POOLCONFIG_URL` = `https://where.yourstuff/is`.

Finally, since poolwatcher is starting dynos to handle this pool stuff, you want to enable a heroku Labs setting for getting dyno metadata `heroku labs:enable runtime-dyno-metadata -a`. This lets heroku start more heroku with the name of your app being dynamically fed into the environment variables without you having to 1) set that up 2) maintain different names for each instance/stage

Example code here, but feel free to generate it however you like.
<https://github.com/mshanemc/poolsConfig>

```json
[
    {
        "user": "mshanemc", //ex: lives at https://github.com/mshanemc/cg1
        "repo": "cg1",
        "quantity": 4, //how many of this org to keep handy
        "lifeHours": 12 //how long it should live, in hours
    }
    // ... use 1 for each repo
]
```

`pooldeployer` should have 0 dynos running. It runs as a one-off dyno called by **poolwatcher**

---

## Local Setup and Build (Mac...others, who knows?)

in your `.env` add

-   `LOCAL_ONLY_KEY_PATH=/Users/shane.mclaughlin/code/certificates/server.key` or your equivalent to where your cert for jwt is
-   in your `process.env` file, put the Heroku Redis url (it can be the same as you're using in the cloud. **Don't commit this file to your repo.**
-   `yarn install` will get all your modules installed, including my plugin.
-   `yarn build` will get the typescript and LWC output from /src to /built, which is where the executables go.
-   then start this app with `yarn local:web` and use localhost:8443

## Building for Local Dev

Backend:
`npx nodemon` will recompile all your typescript and restart the local web and worker servers.

Frontend (LWC):
`yarn watch:client` will start a server on localhost:3001. It'll rebuild and hotswap anytime you save a file.

Running both is good if you're working both front and backend

## Things you might need

Ensure the following is installed:

-   [NodeJS](https://nodejs.org/en/)
-   [Yarn](https://classic.yarnpkg.com/en/)
-   [Shane SFDX Plugins](https://github.com/mshanemc/shane-sfdx-plugins)
-   [SFDX CLI](https://developer.salesforce.com/tools/sfdxcli)
-   [Heroku CLI (If using Heroku Pools)](https://devcenter.heroku.com/articles/heroku-cli)
-   Open SSL (For Key Generation)

---

## Debugging on [non-local] Heroku

if **hosted-scratch-qa** is the name of your app

`heroku logs --tail -a hosted-scratch` will give you the logs.

`heroku redis:cli -a hosted-scratch -c hosted-scratch` will lets you look at your redis stuff and see what's in the queue

`heroku ps:exec -a hosted-scratch-qa --dyno=worker.1` lets you ssh into the dyno of your choice and take a look around, clean stuff up, etc.

---

## Setting up a repo (optional)

So you need a target repo to deploy (see examples below). If your repo is simple, the tool will do the default behavior (create, push source, open).

But with an orgInit.sh file, you can list out all your sfdx commands and they'll be executed by the deployer. Remember, no bash metacharacters and only sfdx commands are allowed (We can't let anyone run any arbitrary command on our servers...security, yo!)

That lets you create records, assign permsets, create users, install packages, run tests, generate passwords, and do anything you can do with an SFDX command

### Built-in demo utilities in orgInit.sh

The deployer handles these commands directly, with the same command names as
[sf-demo-utils](https://github.com/wflowersSFDC/sf-demo-utils). No plugin installation
is required. Standard Salesforce commands still run through the Salesforce CLI.

```sh
sf demoutil org create scratch -f config/project-scratch-def.json -d 7 -w 60 -p admin -e example.demo -s
sf project deploy start
sf demoutil user password set -g User -l User -p 'DemoPassword123!'
sf org open -p /lightning/page/home
```

| Command | Supported flags | Behavior |
| --- | --- | --- |
| `sf demoutil org create scratch` | `-f/--definitionfile`, `-d/--durationdays`, `-w/--wait`, `-p/--userprefix`, `-e/--userdomain`, `-i/--clientid`, `-c/--noancestors`, `-n/--nonamespace`, `-s/--setdefaultusername`, `-a/--setalias` | Generates a username and creates the scratch org using the app's configured Dev Hub. Sets the deployment's project default org; repository aliases are accepted but ignored. |
| `sf demoutil user password set` | `-g/--firstname`, `-l/--lastname`, `-p/--password` | Sets the password for exactly one matching user in the deployment org. First and last name default to `User`. |
| `sf demoutil tsp update` | `-d/--directory` | Replaces `user` and `executionUser` in transaction security policies with the deployment username. |
| `sf demoutil agent userupdate` | `-d/--directory` | Finds exactly one user with the `Einstein Agent User` profile and updates `botUser` in Einstein Service Agent bot files recursively. |

All four accept `--json`; the app adds it automatically. Colon-style names such as
`sfdx demoutil:tsp:update` are also accepted. Scratch creation defaults to
`config/user.definition.json`, 7 days, and a 20-minute wait. Metadata commands
default to `force-app/main/default`; run them before deploying the affected metadata.
Paths are relative to the repository and must stay inside the deployment checkout.
Multi-repository deployments adjust these paths automatically and create one shared org.

Put each command on its own line. Quoted argument values may contain spaces and
literal punctuation; shell expansion, pipes, redirection, and chained commands
are unsupported for built-in commands, including in whitelisted repositories.
Unknown commands or flags fail explicitly. Bring-your-own-org deployments skip
scratch creation and password commands, as before.

Username generation replaces the external
[unique-username-generator](https://github.com/SFDC-Assets/unique-username-generator)
service. It combines the requested prefix and domain (defaults: `user` and
`example.com`) with cryptographic randomness and an atomic Redis sequence shared
by workers. It uses the app's existing Redis connection; no separate Heroku app,
Memcached service, or public username endpoint is needed. Usernames are lowercased
and validated against the 80-character limit. The exact random format differs
from the old service.

Native handlers use standard CLI commands for scratch creation, user queries, and
the password REST request. They use the deployment org's CLI authentication and
require a CLI version with `sf api request rest`. Password request bodies are
written to a restricted temporary file and removed after the request. Deployment
results continue to include the configured demo password for the requesting user.
Failures stop the deployment and appear in its results; metadata writes finish
before the next command starts.

## Private repos

By default, the deployer expects all repos to be public. If you really need private repos, you can use the following buildpack and a [Github Personal Access Token](https://docs.github.com/en/github/authenticating-to-github/creating-a-personal-access-token).

<https://github.com/mshanemc/github-via-pat>

## Whatever the personal access token user has access to see, the deployer can then see.

## Testing

uses Jest.

There's a file called `testRepos` that you'll want to customize with any repos you want to use for verification. It'll probably fail if you use mine.

Run them with `yarn test:unit`. A few of them are not true unit tests...the require a server and redis running, and will try to connect to github for your testRepos. Run each of these commands in a separate terminal.

```shell
yarn local:web
```

Integration (tests/integrationTests) are slower/harder.

`yarn test:generate` will parse testRepos.ts and create a integration tests for each repo that

1. tests that it deploys
2. builds a pooled org using org pools if you specify testPool=true in testrepos
3. tests that it deploys from the pool

Modify `repoCodeGen.ts` to change the generator.

NOTE: This is using up your scratch org quotas. The tests delete the orgs, so it's minimally wasteful, but still expect it to take a while AND watch your daily limit. Especially if you're testing deploys and tests are failing...you might be using orgs that never get to the delete phase.

---

## Contributing

I'm using typescript...

-   `yarn install` will get all your modules installed, including my plugins.
-   `yarn build` will get any typescript changes from /src to /built, which is where the executables go.

Finally, the front end app is Lightning Web Components. You'll figure it out...if not, start here: [https://lwc.dev/](https://lwc.dev/)

---

## Launcher URLs

There's not anything at / on the server. Don't worry. The only page you probably care about is `/launch` which takes 1 parameter `template`

So your path should be `https://whatever.herokuapp.com/launch?template=https://github.com/username/reponame`

Also handles branches on github, like `https://whatever.herokuapp.com/launch?template=https://github.com/username/reponame/tree/somebranch`

You can optionally pass in an `email` parameter so that the emails go to someone who's not the hub owner :)
`https://whatever.herokuapp.com/launch?template=https://github.com/username/reponame&email=shane.mclaughlin@salesforce.com`

You can pass in `&email=required` to force user to a form where they add their email. This is useful if they need to deal with emails from the org, or password resets, or security challenges, etc.

---

## Example Repos with orgInit.sh scripts

[![Deploy](https://raw.githubusercontent.com/mshanemc/deploy-to-sfdx/master/client-src/resources/images/sfdx_it_now.png)](https://hosted-scratch.herokuapp.com/launch?template=https://github.com/mshanemc/DF17integrationWorkshops) <https://github.com/mshanemc/DF17integrationWorkshops>

---

[![Deploy](https://raw.githubusercontent.com/mshanemc/deploy-to-sfdx/master/client-src/resources/images/sfdx_it_now.png)](https://hosted-scratch.herokuapp.com/launch?template=https://github.com/mshanemc/community-apps-workshop-df17)
<https://github.com/mshanemc/community-apps-workshop-df17>

---

[![Deploy](https://raw.githubusercontent.com/mshanemc/deploy-to-sfdx/master/client-src/resources/images/sfdx_it_now.png)](https://hosted-scratch.herokuapp.com/launch?template=https://github.com/mshanemc/process-automation-workshop-df17)
<https://github.com/mshanemc/process-automation-workshop-df17>

---

[![Deploy](https://raw.githubusercontent.com/mshanemc/deploy-to-sfdx/master/client-src/resources/images/sfdx_it_now.png)](https://hosted-scratch.herokuapp.com/launch?template=https://github.com/mshanemc/df17AppBuilding)<https://github.com/mshanemc/df17AppBuilding>
