import https from 'https';

const req = https.request('https://tinyvault.space/api/upload', {
  method: 'OPTIONS'
}, (res) => {
  console.log('Status:', res.statusCode);
  console.log('Headers:', res.headers);
});
req.end();
