async function testPNL() {
  const wallet = '0x90c2c69d2cfaa0537ce152c2bcc67859626a2a867d7ca624ab2d17de19bac78f';
  const url = `http://localhost:3000/api/analytics/pnl-precise?wallet=${wallet}&timeframe=1W`;
  
  const body = {
    staticExtraUsd: 1000
  };

  console.log('Fetching', url);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    
    const data = await res.json();
    console.log('Response:', JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error:', err);
  }
}

testPNL();
