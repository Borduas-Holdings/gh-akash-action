# Changelog

## [0.3.0](https://github.com/Borduas-Holdings/gh-akash-action/compare/close-deployment/v0.2.1...close-deployment/v0.3.0) (2026-03-27)


### Features

* add RPC failover and trusted-providers support ([#1](https://github.com/Borduas-Holdings/gh-akash-action/issues/1)) ([6860336](https://github.com/Borduas-Holdings/gh-akash-action/commit/6860336a04b02e933ef94b7a7e659386d8eeabdc))


### Bug Fixes

* add https fallback probe when fetch fails ([#3](https://github.com/Borduas-Holdings/gh-akash-action/issues/3)) ([3d10236](https://github.com/Borduas-Holdings/gh-akash-action/commit/3d1023618f1ac15c4e8500bb56230918fe2101d8))
* bump chain-sdk to alpha.27 for chain upgrade compatibility ([54191e7](https://github.com/Borduas-Holdings/gh-akash-action/commit/54191e732bc0b8d876a671f8075a0a6be95662b0))
* increase RPC health-check timeout from 5s to 10s ([#2](https://github.com/Borduas-Holdings/gh-akash-action/issues/2)) ([84bec8e](https://github.com/Borduas-Holdings/gh-akash-action/commit/84bec8e857780f755fe1a5d824031c60bdc3fea4))
* rebuild action bundles to include https fallback probe ([b7f8e37](https://github.com/Borduas-Holdings/gh-akash-action/commit/b7f8e37c1b33cd7540a7135c000269065340f0c9))
* use curl as health-check probe (Node.js networking broken in GH Actions) ([c54bd62](https://github.com/Borduas-Holdings/gh-akash-action/commit/c54bd62714666c8db062e6321a3d7da8e7473206))

## [0.2.1](https://github.com/akash-network/gh-actions/compare/close-deployment/v0.2.0...close-deployment/v0.2.1) (2026-02-22)


### Bug Fixes

* fixes close deployment filter ([21cda9a](https://github.com/akash-network/gh-actions/commit/21cda9a55f729ab1b3b26a2a730f65103beb5376))

## [0.2.0](https://github.com/akash-network/gh-actions/compare/close-deployment/v0.1.0...close-deployment/v0.2.0) (2026-02-22)


### Features

* adds possibility to filter what deployments to close ([#19](https://github.com/akash-network/gh-actions/issues/19)) ([444648b](https://github.com/akash-network/gh-actions/commit/444648bf84580cbf601db46b82a0800b1882c209))

## [0.1.0](https://github.com/akash-network/gh-actions/compare/close-deployment/v0.0.1...close-deployment/v0.1.0) (2026-02-06)


### Features

* initial commit ([30d5806](https://github.com/akash-network/gh-actions/commit/30d5806c6d6fafa56545488d8db2409308bb5623))


### Bug Fixes

* fixes and tests deployments ([85d7960](https://github.com/akash-network/gh-actions/commit/85d79607439793cfaa03993d971f9b7c25f0cceb))
