# Deploy on Akash Network GitHub Action

A GitHub Action to deploy applications on the [Akash Network](https://akash.network/) using the Chain SDK.

## Features

- Deploy applications using SDL (Stack Definition Language)
- Filter bids using MongoDB-style queries with [@ucast/mongo2js](https://github.com/stalniy/ucast)
- Pick bid strategy: `cheapest` or `first`
- Configurable gas and fee settings
- Automatic bid selection and lease creation
- Support for both inline SDL and file-based SDL

## Usage

```yaml
name: Deploy to Akash

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Deploy to Akash Network
        uses: akash-network/akash-gha/packages/deploy@v1
        with:
          mnemonic: ${{ secrets.AKASH_MNEMONIC }}
          sdl: ./deploy.yaml
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `mnemonic` | Wallet mnemonic phrase for signing transactions | Yes | - |
| `sdl` | Path to SDL file or inline SDL string | Yes | - |
| `bid-filter` | MongoDB-style filter for bids (see below) | No | `{}` (all bids) |
| `pick-bid-strategy` | Strategy for picking a bid: `cheapest` or `first` | No | `cheapest` |
| `gas` | Gas limit for transactions | No | `auto` |
| `gas-multiplier` | Gas multiplier (used when gas is "auto") | No | `1.5` |
| `fee` | Fee amount in smallest denomination | No | - |
| `denom` | Token denomination for fees and deposit | No | `uakt` |
| `deposit` | Deposit amount for deployment in uakt | No | `500000` |
| `rest-url` | REST API URL for querying Akash network | No | `https://rpc.akt.dev/rest` |
| `tx-rpc-url` | RPC URL for submitting transactions | No | `https://rpc.akt.dev/rpc` |
| `lease-timeout` | Maximum time to wait for bids (seconds) | No | `180` |
| `deployment-details-path` | Path to a JSON file for storing/reading deployment details. Enables redeploy support — if the file exists the action reuses the existing deployment (or creates a new one if the lease has closed). The file is updated after every new deployment. | No | - |
| `deployment-receipt-path` | Path for an atomic owner/dseq receipt written immediately after a successful create transaction, before bid, lease, manifest, or status work. | No | - |

## Outputs

| Output | Description |
|--------|-------------|
| `deployment-owner` | The wallet-derived owner of the deployment |
| `deployment-id` | The deployment ID (owner/dseq) |
| `dseq` | The deployment sequence number |
| `deployment-receipt-path` | Absolute path of the receipt when `deployment-receipt-path` was provided |
| `lease-id` | The lease ID (owner/dseq/gseq/oseq/provider) |
| `provider` | The selected provider address |
| `lease-status` | The status of the lease |
| `is-new` | `true` if a brand-new deployment was created, `false` if an existing deployment was reused |
| `prev-dseq` | The previous deployment sequence number. Set only when `is-new` is `true` and `deployment-details-path` is provided — meaning the old lease had closed and a fresh deployment was created in its place |

The owner and dseq outputs, and the optional receipt file, are published as soon as
the deployment-create transaction succeeds. They therefore remain available to a
later step with `if: always()` when bid selection, lease creation, manifest submission,
or status inspection fails. Cleanup should bind both values; a dseq alone is not an
account-scoped deployment identity.

## Bid Selection

Bid selection works in two stages:

1. **Filter** (`bid-filter`) - Narrows down bids using MongoDB-style queries
2. **Pick** (`pick-bid-strategy`) - Selects one bid from the filtered results

### Pick Bid Strategy

| Strategy | Description |
|----------|-------------|
| `cheapest` | Select the lowest priced bid (default) |
| `first` | Select the first available bid |

### Examples

**Cheapest bid (default):**
```yaml
- uses: akash-network/akash-gha/packages/deploy@v1
  with:
    mnemonic: ${{ secrets.AKASH_MNEMONIC }}
    sdl: ./deploy.yaml
    # pick-bid-strategy defaults to 'cheapest'
```

**First available bid:**
```yaml
- uses: akash-network/akash-gha/packages/deploy@v1
  with:
    mnemonic: ${{ secrets.AKASH_MNEMONIC }}
    sdl: ./deploy.yaml
    pick-bid-strategy: 'first'
```

**Cheapest bid from a specific provider:**
```yaml
- uses: akash-network/akash-gha/packages/deploy@v1
  with:
    mnemonic: ${{ secrets.AKASH_MNEMONIC }}
    sdl: ./deploy.yaml
    bid-filter: '{ "id.provider": "akash1abc123..." }'
    pick-bid-strategy: 'cheapest'
```

## Bid Filter

The `bid-filter` input uses [@ucast/mongo2js](https://github.com/stalniy/ucast) syntax to filter bids. The filter is applied to bid objects with the following structure:

```typescript
{
  id: {
    owner: string;      // Deployment owner address
    dseq: string;       // Deployment sequence number
    gseq: number;       // Group sequence number
    oseq: number;       // Order sequence number
    provider: string;   // Provider address
    bseq: number;       // Bid sequence number
  };
  price: {
    denom: string;      // Token denomination
    amount: string;     // Price amount
  };
  state: string;        // Bid state
}
```

### Filter Examples

**Select by specific provider:**
```yaml
bid-filter: '{ "id.provider": "akash1abc123..." }'
```

**Filter by maximum price:**
```yaml
bid-filter: '{ "price.amount": { "$lte": "1000" } }'
```

**Filter by price range:**
```yaml
bid-filter: |
  {
    "$and": [
      { "price.amount": { "$gte": "500" } },
      { "price.amount": { "$lte": "1500" } }
    ]
  }
```

**Filter by multiple providers:**
```yaml
bid-filter: |
  {
    "id.provider": {
      "$in": ["akash1provider1...", "akash1provider2..."]
    }
  }
```

### Supported Operators

The filter supports standard MongoDB query operators:

- Comparison: `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`
- Logical: `$and`, `$or`, `$not`, `$nor`
- Element: `$exists`
- Evaluation: `$regex`

See https://www.npmjs.com/package/@ucast/mongo2js for more details.

## SDL Configuration

You can provide SDL in two ways:

### File-based SDL

Create an SDL file in your repository and reference it:

```yaml
sdl: ./deploy.yaml
```

### Inline SDL

Provide SDL directly in the workflow:

```yaml
sdl: |
  version: "2.0"
  services:
    web:
      image: nginx:latest
      expose:
        - port: 80
          as: 80
          to:
            - global: true
  profiles:
    compute:
      web:
        resources:
          cpu:
            units: 0.5
          memory:
            size: 512Mi
          storage:
            size: 512Mi
    placement:
      dcloud:
        pricing:
          web:
            denom: uakt
            amount: 10000
  deployment:
    web:
      dcloud:
        profile: web
        count: 1
```

## Redeploy Support

When `deployment-details-path` is provided the action persists deployment details (dseq, lease info) to a JSON file and reads them back on subsequent runs. This enables idempotent deployments:

- **Existing active lease** → the action reuses it and sets `is-new: false`.
- **Lease closed / file absent** → the action creates a new deployment, writes the new details to the file, and sets `is-new: true`. `prev-dseq` is populated with the old sequence number so the stale deployment can be cleaned up.

Use these outputs to:
- Close the previous (stale) deployment after a full redeploy.
- Gate steps that should only run on the first deployment (e.g. creating a PR to commit the updated details file).

```yaml
- name: Deploy to Akash
  id: deploy
  uses: akash-network/akash-gha/packages/deploy@v1
  with:
    mnemonic: ${{ secrets.AKASH_MNEMONIC }}
    sdl: ./example/deploy.yml
    deployment-details-path: ./.akash/example/deployment-details.json

# Close the stale deployment only when a full redeploy happened
- name: Close stale deployment
  if: steps.deploy.outputs.prev-dseq != ''
  uses: akash-network/akash-gha/packages/close-deployment@v1
  with:
    mnemonic: ${{ secrets.AKASH_MNEMONIC }}
    filter: |
      dseq: ${{ steps.deploy.outputs.prev-dseq }}

# Commit updated deployment details only on a new deployment
- name: Create PR with deployment details
  if: steps.deploy.outputs.is-new == 'true'
  uses: peter-evans/create-pull-request@v8
  with:
    add-paths: ./.akash/example/deployment-details.json
    commit-message: "chore: save deployment details"
    title: "chore: save deployment details"
```

## Complete Example

```yaml
name: Deploy to Akash

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Deploy to Akash Network
        id: deploy
        uses: akash-network/akash-gha/packages/deploy@v1
        with:
          mnemonic: ${{ secrets.AKASH_MNEMONIC }}
          sdl: ./akash/deploy.yaml
          bid-filter: '{ "price.amount": { "$lte": "2000" } }'
          pick-bid-strategy: 'cheapest'
          deposit: '1000000'
          lease-timeout: '300'

      - name: Print deployment info
        run: |
          echo "Deployment ID: ${{ steps.deploy.outputs.deployment-id }}"
          echo "DSEQ: ${{ steps.deploy.outputs.dseq }}"
          echo "Lease ID: ${{ steps.deploy.outputs.lease-id }}"
          echo "Provider: ${{ steps.deploy.outputs.provider }}"
```

## Security

**Important:** Always store your mnemonic as a GitHub secret. Never commit mnemonics or private keys to your repository.

```yaml
# Good - using secrets
mnemonic: ${{ secrets.AKASH_MNEMONIC }}

# Bad - hardcoded mnemonic (NEVER DO THIS)
mnemonic: "word1 word2 word3..."
```

## Network Configuration

The action uses the default Akash mainnet endpoints:

```yaml
rest-url: 'https://rpc.akt.dev/rest'
tx-rpc-url: 'https://rpc.akt.dev/rpc'
```

You can override these to use different networks or custom endpoints.

## License

Apache-2.0
