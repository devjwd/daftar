import fetch from 'node-fetch';

async function testBackend() {
  const url = 'https://api.daftar.fi/api/analytics/pnl-precise?wallet=0x5077a6be218410fb5710a0d56278892c4563cb8b845aada96b5871b1f05a5c80&timeframe=1D';
  
  const payload = {
    balances: [
      { asset_type: '0x1', symbol: 'MOVE', amount: 40 }
    ],
    staticExtraUsd: 1.45
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const text = await res.text();
  console.log("Status:", res.status);
  try {
    const json = JSON.parse(text);
    if (json.history && json.history.length > 0) {
      console.log("First point:", json.history[0]);
      console.log("Last point:", json.history[json.history.length - 1]);
    } else {
      console.log("Response JSON:", json);
    }
  } catch (err) {
    console.log("Response text:", text);
  }
}

testBackend().catch(console.error);
