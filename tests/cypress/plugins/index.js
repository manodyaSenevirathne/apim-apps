const browserify = require('@cypress/browserify-preprocessor')
const path = require('path');
const fs = require('fs');

/**
 * @type {Cypress.PluginConfig}
 */
module.exports = (on, config) => {
    const options = browserify.defaultOptions;
    options.browserifyOptions.transform[1][1].babelrc = true;

    on('file:preprocessor', browserify(options));

    // Record failed specs for test.sh's rerun pass.
    on('after:run', (results) => {
        const failed = (results && Array.isArray(results.runs))
            ? results.runs
                .filter((r) => r && r.stats && r.stats.failures > 0)
                .map((r) => r.spec && (r.spec.relative || r.spec.name))
                .filter(Boolean)
            : [];
        try {
            fs.writeFileSync('cypress/failed-specs.txt', failed.join(','));
        } catch (e) {
            console.error('Failed to write cypress/failed-specs.txt:', e.message);
        }
    });

    // Surface a message on the cypress-run stdout (Jenkins console).
    on('task', {
        log(message) {
            console.log(message)
            return null
        },
    })

    return config;
}
