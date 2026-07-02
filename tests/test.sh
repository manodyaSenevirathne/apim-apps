#!/bin/bash
echo "tesh.sh executing started..."

set -o xtrace

HOME=`pwd`
TEST_SCRIPT=test.sh
MVNSTATE=1
TEST_SPECS=""

function usage()
{
    echo "
    Usage bash test.sh --input-dir /workspace/data-bucket.....
    Following are the expected input parameters. all of these are optional
    --input-dir       | -i    : input directory for test.sh
    --output-dir      | -o    : output directory for test.sh
    "
}

optspec=":hiom-:"
while getopts "$optspec" optchar; do
    case "${optchar}" in
        -)
            case "${OPTARG}" in
                input-dir)
                    val="${!OPTIND}"; OPTIND=$(( $OPTIND + 1 ))
                    INPUT_DIR=$val
                    ;;
                output-dir)
                    val="${!OPTIND}"; OPTIND=$(( $OPTIND + 1 ))
                    OUTPUT_DIR=$val
                    ;;
                mvn-opts)
                    val="${!OPTIND}"; OPTIND=$(( $OPTIND + 1 ))
                    MAVEN_OPTS=$val
                    ;;
                test-specs)
                    val="${!OPTIND}"; OPTIND=$(( $OPTIND + 1 ))
                    TEST_SPECS=$val
                    ;;
                *)
                    usage
                    if [ "$OPTERR" = 1 ] && [ "${optspec:0:1}" != ":" ]; then
                        echo "Unknown option --${OPTARG}" >&2
                    fi
                    ;;
            esac;;
        h)
            usage
            exit 2
            ;;
        o)
            OUTPUT_DIR=$val
            ;;
        m)
            MVN_OPTS=   $val
            ;;
        i)
            INPUT_DIR=$val
            ;;
        *)
            usage
            if [ "$OPTERR" != 1 ] || [ "${optspec:0:1}" = ":" ]; then
                echo "Non-option argument: '-${OPTARG}'" >&2
            fi
            ;;
    esac
done

echo "working Directory : ${HOME}"
echo "input directory : ${INPUT_DIR}"
echo "output directory : ${OUTPUT_DIR}"
export DATA_BUCKET_LOCATION=${INPUT_DIR}

# Retrieve specific property from deployment.properties file
function get_prop {
    local prop=$(grep -w "${1}" "${INPUT_DIR}/deployment.properties" | cut -d'=' -f2)
    echo $prop
}

cat ${INPUT_DIR}/deployment.properties

PRODUCT_VERSION=$(get_prop 'ProductVersion')

if [[ -z "$PRODUCT_VERSION" ]]
then
    echo "\$ProductVersion not found in property list."
#    After merging changes to wso2/testgrid-job-configs this need to be enabled
#    exit 1
else
    PRODUCT_VERSION="-$PRODUCT_VERSION"
fi
BASE_URL=$(get_prop 'GatewayHttpsUrl')
echo $BASE_URL

export CYPRESS_BASE_URL=${BASE_URL}
echo $CYPRESS_BASE_URL;

export CYPRESS_BASE_URL=`echo $CYPRESS_BASE_URL | sed "s|8243|9443|g"`
echo $CYPRESS_BASE_URL;

######
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -y
sleep 120
sudo killall apt apt-get dpkg
sudo dpkg --configure -a
curl -fsSL https://nodejs.org/dist/v12.13.0/node-v12.13.0-linux-x64.tar.xz -o /tmp/node-v12.13.0-linux-x64.tar.xz
sudo tar -xJf /tmp/node-v12.13.0-linux-x64.tar.xz -C /usr/local --strip-components=1
npm -v
sudo apt-get install libgtk2.0-0 libgtk-3-0 libgbm-dev libnotify-dev libgconf-2-4 libnss3 libxss1 libasound2 libxtst6 xauth xvfb -y
export LC_CTYPE="en_US.UTF-8"
cd $HOME
npm install cypress
npm install --save-dev cypress-file-upload
npm install --save  nodemailer
npm install --save require-text
npm install styliner
npm i --save-dev cypress-mochawesome-reporter
npm i --save-dev mocha-junit-reporter
npm i --save-dev cypress-multi-reporters
npm i babel-plugin-module-resolver


export S3_SECRET_KEY=$(get_prop 's3secretKey')
export S3_ACCESS_KEY=$(get_prop 's3accessKey')
export TESTGRID_EMAIL_PASSWORD=$(get_prop 'testgridEmailPassword')

npm install --save-dev cypress-multi-reporters mocha-junit-reporter
npm install --save-dev mochawesome mochawesome-merge mochawesome-report-generator
npm install --save-dev mocha
npm install --save-dev @cypress/browserify-preprocessor
npm install archiver
npm install yamljs
npm install junit-report-merger --save-dev
npm i --save aws-sdk
npm run delete:reportFolderHTML
npm run delete:reportFolderJUnit
npm run delete:reportFolderReport
npm run pre-test
# Drop any stale failed-specs list from a prior build on a reused CI agent.
rm -f cypress/failed-specs.txt
nohup Xvfb :99 > /dev/null 2>&1 &
export DISPLAY=:99
# Cypress 9 has no --e2e flag; --spec alone scopes the run.
if [ -n "$TEST_SPECS" ]; then
    echo "===== test_specs set — running user-selected specs only ====="
    echo "$TEST_SPECS" | tr ',' '\n'
    NO_COLOR=1 npx cypress run --spec "$TEST_SPECS"
else
    NO_COLOR=1 npm run test
fi
MVNSTATE_FIRST=$?
pkill Xvfb || true

# after:run (cypress/plugins/index.js) wrote failing specs to failed-specs.txt.
FAILED_SPECS=$(node ./scripts/extract-failed-specs.js)
FLAKY_SPECS=""
MVNSTATE=$MVNSTATE_FIRST

if [ -n "$FAILED_SPECS" ]; then
    echo "===== First pass failures detected ====="
    echo "$FAILED_SPECS" | tr ',' '\n'
    echo "===== Starting rerun pass ====="
    nohup Xvfb :99 > /dev/null 2>&1 &
    export DISPLAY=:99
    NO_COLOR=1 npx cypress run --spec "$FAILED_SPECS"
    MVNSTATE_SECOND=$?
    pkill Xvfb || true
    FLAKY_SPECS="$FAILED_SPECS"
    MVNSTATE=$MVNSTATE_SECOND
fi

# Write ONLY the spec paths (one per line) so the build-overview banner is clean.
if [ -n "$FLAKY_SPECS" ] && [ -n "${OUTPUT_DIR}" ]; then
    echo "$FLAKY_SPECS" | tr ',' '\n' > "${OUTPUT_DIR}/flaky-specs.txt"
    echo "===== Flaky-specs marker written to ${OUTPUT_DIR}/flaky-specs.txt (verdict exit ${MVNSTATE}) ====="
fi

# Build and email the mochawesome report (this suite emails its own report).
npm run report:merge
npm run report:generate
node ./upload_email

# On failure, fetch remote server logs via S3 (no SSH access to the target host).
fetch_remote_carbon_logs() {
    local s3_out instance_id trigger_path result_path tmpdir
    s3_out=$(get_prop 'S3OutputBucketLocation')
    instance_id=$(get_prop 'WSO2InstanceId')
    if [ -z "$s3_out" ] || [ -z "$instance_id" ]; then
        echo "[carbon-logs] S3OutputBucketLocation or WSO2InstanceId missing — skipping"
        return 0
    fi
    trigger_path="s3://${s3_out}/dump-now"
    result_path="s3://${s3_out}/carbon-logs/${instance_id}-carbon-logs.tar.gz"
    set +o xtrace
    echo ""
    echo "===== Begin remote carbon log dump ====="
    aws s3 rm "${result_path}" --quiet >/dev/null 2>&1
    if ! echo "$(date -u +%FT%TZ)" | aws s3 cp - "${trigger_path}" --quiet; then
        echo "[carbon-logs] failed to write trigger flag — skipping"; echo "===== End remote carbon log dump ====="; set -o xtrace; return 0
    fi
    local found=false i
    for i in $(seq 1 18); do
        sleep 5
        if aws s3 ls "${result_path}" >/dev/null 2>&1; then found=true; break; fi
    done
    if [ "$found" != "true" ]; then
        echo "[carbon-logs] tarball did not appear in 90s — watcher may not be running."; echo "===== End remote carbon log dump ====="; set -o xtrace; return 0
    fi
    tmpdir=$(mktemp -d)
    aws s3 cp "${result_path}" "${tmpdir}/carbon-logs.tar.gz" --quiet && tar -xzf "${tmpdir}/carbon-logs.tar.gz" -C "${tmpdir}"
    if [ -e "${tmpdir}/logs/wso2carbon.log" ]; then
        echo ""; echo "----- wso2carbon.log (Solr-noise filtered, tail 20000) -----"
        grep -v -E 'newapi.*Lexical error|registry\.indexing\.solr|SolrQueryParserBase|QueryParserTokenManager|org\.apache\.solr\.parser|org\.apache\.solr\.search\.LuceneQParser|org\.apache\.solr\.search\.QParser|org\.apache\.solr\.handler\.RequestHandlerBase' \
            "${tmpdir}/logs/wso2carbon.log" | tail -n 20000
    fi
    rm -rf "${tmpdir}"
    aws s3 rm "${result_path}" --quiet >/dev/null 2>&1
    echo "===== End remote carbon log dump ====="
    set -o xtrace
}
if [ "${MVNSTATE}" -ne 0 ]; then
    fetch_remote_carbon_logs || true
fi

# Ship Cypress screenshots + mochawesome HTML to S3 via ${OUTPUT_DIR}.
if [ -n "${OUTPUT_DIR}" ]; then
    [ -d "${HOME}/cypress/screenshots" ] && cp -r "${HOME}/cypress/screenshots" "${OUTPUT_DIR}/cypress-screenshots" 2>/dev/null || true
    [ -d "${HOME}/cypress/reports/html" ] && cp -r "${HOME}/cypress/reports/html" "${OUTPUT_DIR}/cypress-report" 2>/dev/null || true
fi
######

exit $MVNSTATE
