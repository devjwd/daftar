async function run() {
  const query = `query {
    account_transactions(where: {transaction_version: {_eq: 151041141}}) {
      user_transaction {
        payload
      }
      fungible_asset_activities {
        owner_address
        type
        amount
      }
    }
  }`;
  const res = await fetch('https://indexer.movementnetwork.xyz/v1/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}
run();
