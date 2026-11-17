echo ".Profile: Updating PATH"
export PATH=$PATH:/app

echo ".Profile: Updating PATH to include Salesforce CLI ..."
export PATH=$PATH:/app/.local/share/sfdx/cli/bin/

# Standalone oclif CLIs bundle their own Node, independently of package.json.
# Use the app's pinned runtime so legacy Salesforce plugins load consistently.
if [ -x /app/.heroku/node/bin/node ]; then
    deployer_oclif_node_dir="${XDG_DATA_HOME:-$HOME/.local/share}/oclif/node"
    mkdir -p "$deployer_oclif_node_dir"
    ln -sf /app/.heroku/node/bin/node "$deployer_oclif_node_dir/node-custom"
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
