import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

const MOVEMENT_INDEXER_URL = process.env.MOVEMENT_INDEXER_URL || 'https://indexer.mainnet.movementnetwork.xyz/v1/graphql';
const USER_ADDRESS = '0x90c2c69d2cfaa0537ce152c2bcc67859626a2a867d7ca624ab2d17de19bac78f';

const GET_BALANCES = `
query GetUserTokenBalances($address: String!) {
  current_fungible_asset_balances(
    where: {
      owner_address: {_eq: $address},
      amount: {_gt: "0"}
    }
  ) {
    asset_type
    amount
    metadata {
      name
      symbol
      decimals
    }
  }
}
`;

async function run() {
  try {
    const res = await fetch(MOVEMENT_INDEXER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: GET_BALANCES,
        variables: { address: USER_ADDRESS }
      })
    });
    const json: any = await res.json();
    console.log(JSON.stringify(json, null, 2));
  } catch (err) {
    console.error("Failed to query user balances:", err);
  }
}

run();
