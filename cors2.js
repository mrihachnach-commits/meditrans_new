import https from 'https';

console.log("Starting...");
const req = https.request('https://tinyvault.space/api/upload', {
  method: 'OPTIONS',
  headers: {
    'Origin': 'http://localhost:3000',
    'Access-Control-Request-Method': 'POST'
  }
}, (res) => {
  console.log('StatusCode:', res.statusCode);
  if (res.headers['access-control-allow-origin']) {
     console.log('CORS supported:', res.headers['access-control-allow-origin']);
  } else {
     console.log('Headers:', res.headers);
  }
});
req.on('error', (e) => console.log('Error:', e.message));
req.end();
