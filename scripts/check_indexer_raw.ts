import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

const MOVEMENT_INDEXER_URL = process.env.MOVEMENT_INDEXER_URL || 'https://indexer.mainnet.movementnetwork.xyz/v1/graphql';

const GET_RAW_ACTIVITIES = `
query GetRawActivities($version: bigint!) {
  fungible_asset_activities(where: { transaction_version: { _eq: $version } }) {
    owner_address
    amount
    asset_type
    type
    is_transaction_success
  }
  coin_activities(where: { transaction_version: { _eq: $version } }) {
    owner_address
    amount
    coin_type
    activity_type
    is_transaction_success
  }
}
`;

async function run() {
  try {
    const res = await fetch(MOVEMENT_INDEXER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: GET_RAW_ACTIVITIES,
        variables: { version: 132648171 }
      })
    });
    const json: any = await res.json();
    console.log(JSON.stringify(json, null, 2));
  } catch (err) {
    console.error("Failed to query raw indexer:", err);
  }
}

run();
