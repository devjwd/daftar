#!/bin/bash

# Swap Router Deployment Script for Movement Network
# Usage: ./deploy.sh [testnet|mainnet]

set -e

NETWORK=${1:-testnet}
PROFILE=${2:-default}

echo "🚀 Deploying Swap Router to Movement $NETWORK"
echo "Using profile: $PROFILE"
echo ""

# Check if Movement CLI is installed
if ! command -v movement &> /dev/null; then
    echo "❌ Movement CLI not found. Please install it first:"
    echo "   https://docs.movementnetwork.xyz/devs/movementcli"
    exit 1
fi

# Navigate to contract directory
cd "$(dirname "$0")"

echo "📦 Compiling contract..."
movement move compile --named-addresses swap_router=$PROFILE

echo ""
echo "🧪 Running tests..."
movement move test

echo ""
echo "⚠️  Important: Review the following before deployment:"
echo "   1. Contract code has been audited"
echo "   2. You have enough MOVE for gas fees"
echo "   3. You have the correct treasury address ready"
echo ""
read -p "Continue with deployment? (y/N) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Deployment cancelled."
    exit 0
fi

echo ""
echo "📤 Publishing contract to $NETWORK..."
movement move publish \
  --named-addresses swap_router=$PROFILE \
  --included-artifacts none \
  --assume-yes

echo ""
echo "✅ Deployment complete!"
echo ""
echo "📝 Next steps:"
echo "   1. Note your contract address from the output above"
echo "   2. Initialize the contract:"
echo "      movement move run --function-id '<address>::router::initialize' \\"
echo "        --args u64:30 --args address:'<treasury_address>'"
echo "   3. Update frontend/src/config/network.js with your contract address"
echo "   4. Test the swap functionality in the frontend"
echo ""
echo "📚 See SWAP_INTEGRATION.md for full documentation"
