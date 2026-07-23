const {createFixtureConfiguration} = require('./fixture-config.cjs');

module.exports = createFixtureConfiguration(process.env.DEPCRUISE_FIXTURE_PACKAGE || process.cwd());
