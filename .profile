echo ".Profile: Updating PATH"
export PATH=$PATH:/app

echo ".Profile: Updating PATH to include Salesforce CLI ..."
export PATH=$PATH:/app/.local/share/sfdx/cli/bin/

# Standalone oclif CLIs bundle their own Node, independently of package.json.
# Use the CLI's bundled runtime (including Node 26), not the web app's Node 22.
# Remove only the override created by older releases of this app.
deployer_oclif_node="${XDG_DATA_HOME:-$HOME/.local/share}/oclif/node/node-custom"
if [ -L "$deployer_oclif_node" ] && [ "$(readlink "$deployer_oclif_node")" = /app/.heroku/node/bin/node ]; then
    rm "$deployer_oclif_node"
fi

export SFDX_TOOL=platformdemos

export SF_LAZY_LOAD_MODULES=false
# do not autoupdate
export SF_AUTOUPDATE_DISABLE=true
# new json settings
export SF_JSON_TO_STDOUT=true

echo ".Profile: Creating local resources ..."
mkdir /app/dist/tmp
mkdir /app/tmp

echo ".Profile: Completed!"
