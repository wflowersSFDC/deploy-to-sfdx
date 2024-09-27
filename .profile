echo ".Profile: Updating PATH"
export PATH=$PATH:/app

echo ".Profile: Updating PATH to include Salesforce CLI ..."
export PATH=$PATH:/app/.local/share/sfdx/cli/bin/

export SF_LAZY_LOAD_MODULES=false
# do not autoupdate
export SF_AUTOUPDATE_DISABLE=true
# new json settings
export SF_JSON_TO_STDOUT=true

echo ".Profile: Creating local resources ..."
mkdir /app/dist/tmp
mkdir /app/tmp

echo ".Profile: Completed!"