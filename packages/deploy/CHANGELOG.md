# Changelog

## [0.5.0](https://github.com/Borduas-Holdings/gh-akash-action/compare/deploy/v0.4.0...deploy/v0.5.0) (2026-03-27)


### Features

* add RPC failover and trusted-providers support ([#1](https://github.com/Borduas-Holdings/gh-akash-action/issues/1)) ([6860336](https://github.com/Borduas-Holdings/gh-akash-action/commit/6860336a04b02e933ef94b7a7e659386d8eeabdc))


### Bug Fixes

* add https fallback probe when fetch fails ([#3](https://github.com/Borduas-Holdings/gh-akash-action/issues/3)) ([3d10236](https://github.com/Borduas-Holdings/gh-akash-action/commit/3d1023618f1ac15c4e8500bb56230918fe2101d8))
* bump chain-sdk to alpha.27 for chain upgrade compatibility ([54191e7](https://github.com/Borduas-Holdings/gh-akash-action/commit/54191e732bc0b8d876a671f8075a0a6be95662b0))
* **deploy:** handle null URIs in multi-service deployments ([037b40c](https://github.com/Borduas-Holdings/gh-akash-action/commit/037b40c62197c26689a57d231b7f333a3a938532))
* **deploy:** use both Source.grant and Source.balance for deposits ([7759281](https://github.com/Borduas-Holdings/gh-akash-action/commit/7759281d9433c91e32710fe27f1d7e2b7311a1cb))
* **deploy:** use Source.balance instead of Source.grant for deposits ([4d0ba5b](https://github.com/Borduas-Holdings/gh-akash-action/commit/4d0ba5b3d90b700246c4607137fb0345d299e682))
* increase RPC health-check timeout from 5s to 10s ([#2](https://github.com/Borduas-Holdings/gh-akash-action/issues/2)) ([84bec8e](https://github.com/Borduas-Holdings/gh-akash-action/commit/84bec8e857780f755fe1a5d824031c60bdc3fea4))
* rebuild action bundles to include https fallback probe ([b7f8e37](https://github.com/Borduas-Holdings/gh-akash-action/commit/b7f8e37c1b33cd7540a7135c000269065340f0c9))
* update chain-sdk to 1.0.0-alpha.27 for Mainnet 14 compatibility ([9ee59c5](https://github.com/Borduas-Holdings/gh-akash-action/commit/9ee59c5ad577292d779f885ae311c940869ddc4a))
* use curl as health-check probe (Node.js networking broken in GH Actions) ([c54bd62](https://github.com/Borduas-Holdings/gh-akash-action/commit/c54bd62714666c8db062e6321a3d7da8e7473206))
* use Source.grant instead of Source.balance for Mainnet 14 ([bc26b8c](https://github.com/Borduas-Holdings/gh-akash-action/commit/bc26b8cc371486358d2114b039fd95db5eb78353))

## [0.4.0](https://github.com/akash-network/gh-actions/compare/deploy/v0.3.1...deploy/v0.4.0) (2026-02-22)


### Features

* adds possibility to filter what deployments to close ([#19](https://github.com/akash-network/gh-actions/issues/19)) ([444648b](https://github.com/akash-network/gh-actions/commit/444648bf84580cbf601db46b82a0800b1882c209))

## [0.3.1](https://github.com/akash-network/gh-actions/compare/deploy/v0.3.0...deploy/v0.3.1) (2026-02-22)


### Bug Fixes

* reduces what is stored in deployment stored state ([#15](https://github.com/akash-network/gh-actions/issues/15)) ([d9a414f](https://github.com/akash-network/gh-actions/commit/d9a414faecedd91020b5c2e3b4eb03efc3287f2e))

## [0.3.0](https://github.com/akash-network/gh-actions/compare/deploy/v0.2.0...deploy/v0.3.0) (2026-02-22)


### Features

* adds deployment state tracking on fs + redeploy ([#8](https://github.com/akash-network/gh-actions/issues/8)) ([813217a](https://github.com/akash-network/gh-actions/commit/813217a4f13df963a907116c210f1511e3b6daaf))

## [0.2.0](https://github.com/akash-network/gh-actions/compare/deploy/v0.1.0...deploy/v0.2.0) (2026-02-06)


### Features

* adds pick strategy to deploy action ([#6](https://github.com/akash-network/gh-actions/issues/6)) ([1327870](https://github.com/akash-network/gh-actions/commit/132787084239cc6ef86faba9fc2178b9e7934318))

## [0.1.0](https://github.com/akash-network/gh-actions/compare/deploy/v0.0.1...deploy/v0.1.0) (2026-02-06)


### Features

* initial commit ([30d5806](https://github.com/akash-network/gh-actions/commit/30d5806c6d6fafa56545488d8db2409308bb5623))


### Bug Fixes

* fixes and tests deployments ([85d7960](https://github.com/akash-network/gh-actions/commit/85d79607439793cfaa03993d971f9b7c25f0cceb))
