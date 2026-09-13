# Close Akash Deployment GitHub Action

This GitHub Action closes one or more deployments on the Akash Network. Deployments to close are selected via a flexible YAML `filter` input that can match by deployment sequence number and/or lease properties.

## Usage

```yaml
- name: Close Akash Deployment
  uses: akash-network/akash-gha/packages/close-deployment@main
  with:
    mnemonic: ${{ secrets.AKASH_MNEMONIC }}
    filter: |
      dseq: 12345
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `mnemonic` | Wallet mnemonic phrase for signing transactions | Yes | - |
| `filter` | YAML filter to select deployments/leases to close (see [Filter](#filter)) | Yes | - |
| `expected-owner` | Exact Akash owner expected to match the signing mnemonic; mismatch refuses before chain queries or broadcast | No | - |
| `gas` | Gas limit for transactions | No | `auto` |
| `gas-multiplier` | Gas multiplier (used when gas is `auto`) | No | `1.5` |
| `fee` | Fee amount in the smallest denomination | No | - |
| `denom` | Token denomination for fees | No | `uakt` |
| `rest-url` | REST API URL for querying the Akash network | No | `https://rpc.akt.dev/rest` |
| `tx-rpc-url` | RPC URL for submitting transactions | No | `https://rpc.akt.dev/rpc` |

## Filter

The `filter` input is a required YAML string. At least one top-level field must be provided. All matching active deployments owned by the wallet are closed.

### Top-level fields

| Field | Type | Description |
|-------|------|-------------|
| `dseq` | `number` | Close only the deployment with this sequence number |
| `lease` | `object` | MongoDB-style condition object applied to each lease — only leases that match are closed. See https://www.npmjs.com/package/@ucast/mongo2js |

### Lease filter fields

| Field | Type | Values |
|-------|------|--------|
| `state` | `string` | `active` \| `closed` \| `insufficient_funds` \| `invalid` |
| `provider` | `string` | Provider address (`akash1…`) |
| `createdAt` | `string` | Lease creation timestamp |
| `closedOn` | `string` | Lease close timestamp (optional) |
| `closedReason` | `string` | `lease_closed_owner` \| `lease_closed_unstable` \| `lease_closed_insufficient_funds` \| … |
| `status.services` | `object` | Map of service name → `{ available, total, uris }` |

Standard MongoDB query operators (`$eq`, `$gt`, `$in`, `$and`, `$or`, etc.) are supported in the `lease` object.

### Examples

```yaml
# Close a specific deployment by dseq
filter: |
  dseq: 12345
```

```yaml
# Close all deployments with active leases (no dseq restriction)
filter: |
  lease:
    state: active
```

```yaml
# Close a specific deployment, only if its lease is still active
filter: |
  dseq: 12345
  lease:
    state: active
```

```yaml
# Close all deployments for a specific provider
filter: |
  lease:
    provider: akash1exampleprovideraddress

```

```yaml
# Close all deployments
filter: all
```

## Outputs

| Output | Description |
|--------|-------------|
| `closed_deployments_json` | is a stringified JSON array of `{ dseq, txHash }` |

## Example Workflows

### Close a specific deployment on demand

```yaml
name: Close Akash Deployment

on:
  workflow_dispatch:
    inputs:
      dseq:
        description: 'Deployment sequence number to close'
        required: true

jobs:
  close:
    runs-on: ubuntu-latest
    steps:
      - name: Close Deployment
        uses: akash-network/akash-gha/packages/close-deployment@main
        with:
          mnemonic: ${{ secrets.AKASH_MNEMONIC }}
          filter: |
            dseq: ${{ github.event.inputs.dseq }}
```

### Close preview environment on PR close

```yaml
name: Cleanup Preview Environment

on:
  pull_request:
    types: [closed]

jobs:
  cleanup:
    runs-on: ubuntu-latest
    steps:
      - name: Get deployment dseq
        id: get-dseq
        run: |
          # Your logic to retrieve the dseq, e.g. from a saved artifact or comment
          echo "dseq=12345" >> $GITHUB_OUTPUT

      - name: Close Deployment
        uses: akash-network/akash-gha/packages/close-deployment@main
        with:
          mnemonic: ${{ secrets.AKASH_MNEMONIC }}
          filter: |
            dseq: ${{ steps.get-dseq.outputs.dseq }}
            lease:
              state: active
```

### Close all active deployments for the wallet

```yaml
- name: Close All Active Deployments
  uses: akash-network/akash-gha/packages/close-deployment@main
  with:
    mnemonic: ${{ secrets.AKASH_MNEMONIC }}
    filter: |
      lease:
        state: active
```

## Security Recommendations

1. **Store mnemonic as a secret**: Never commit your mnemonic phrase to the repository. Always use GitHub Secrets.

```yaml
with:
  mnemonic: ${{ secrets.AKASH_MNEMONIC }}
```

2. **Bind exact cleanup subjects to their owner**: When a DSEQ comes from an earlier job or persisted receipt, pass that receipt's owner as `expected-owner`. The action refuses if credential rotation selects a different signing account.

```yaml
with:
  mnemonic: ${{ secrets.AKASH_MNEMONIC }}
  expected-owner: ${{ needs.provision.outputs.owner }}
  filter: |
    dseq: ${{ needs.provision.outputs.dseq }}
```

3. **Use environment protection**: Consider using GitHub Environments with required reviewers for production deployments.

## Network Configuration

By default, the action connects to the Akash mainnet. You can configure custom endpoints:

```yaml
with:
  mnemonic: ${{ secrets.AKASH_MNEMONIC }}
  filter: |
    dseq: 12345
  rest-url: 'https://custom-rest.akash.network'
  tx-rpc-url: 'https://custom-rpc.akash.network'
```

## License

Apache-2.0
