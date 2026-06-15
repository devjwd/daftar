async function test() {
  const targetAddress = '0x90c2c69d2cfaa0537ce152c2bcc67859626a2a867d7ca624ab2d17de19bac78f';
  const assetType = '0x7014b5b832067e6b3bfae039ed3dfb0ae97afee4649703dd2fd0a1acf3c06983';
  const res = await fetch('https://indexer.mainnet.movementnetwork.xyz/v1/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `query { current_fungible_asset_balances(where: {owner_address: {_eq: "${targetAddress}"}, asset_type: {_eq: "${assetType}"}}) { amount } }`
    })
  });
  const d = await res.json();
  console.log(JSON.stringify(d, null, 2));
}
test().catch(console.error);
