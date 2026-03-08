// quick script to exercise badge service
import fetch from 'node-fetch';

(async () => {
  try {
    let res = await fetch('http://localhost:4000/api/badges/award', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({address:'0x1', badgeId:'first-step'})
    });
    console.log('award status', res.status, await res.text());
    res = await fetch('http://localhost:4000/api/badges/user/0x1');
    console.log('user badges', await res.json());
  } catch (e) {
    console.error('error', e);
  }
})();