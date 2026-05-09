import https from "https";
import http from "http";
import { URL } from "url";

export default async function handler(req: any, res: any) {
  const targetUrl = req.query.url;

  if (!targetUrl || typeof targetUrl !== 'string') {
    return res.status(400).send('Missing URL');
  }

  // CORS headers setup
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Authorization');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const proxyRequest = (url: string, depth = 0) => {
    if (depth > 10) {
      if (!res.headersSent) res.status(502).send("Too many redirects");
      return;
    }

    try {
      const urlObj = new URL(url);
      const options: https.RequestOptions = {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Referer': 'https://tinyvault.space/',
          'Connection': 'keep-alive'
        },
        timeout: 60000 
      };

      if (req.headers.range) {
        options.headers!['Range'] = req.headers.range;
      }

      const protocol = urlObj.protocol === 'https:' ? https : http;

      const request = protocol.get(url, options, (response) => {
        // Handle HTTP Redirects
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          const nextUrl = new URL(response.headers.location, url).toString();
          return proxyRequest(nextUrl, depth + 1);
        }

        // Handle JSON Redirects (TinyVault metadata)
        const contentType = response.headers['content-type'] || '';
        if (contentType.includes('application/json')) {
          let body = '';
          response.on('data', chunk => body += chunk);
          response.on('end', () => {
            try {
              const json = JSON.parse(body);
              const redirectUrl = json.download_url || json.url || (json.data && json.data.download_url);
              if (redirectUrl && redirectUrl !== url && typeof redirectUrl === 'string' && redirectUrl.startsWith('http')) {
                return proxyRequest(redirectUrl, depth + 1);
              }
              if (!res.headersSent) {
                res.status(response.statusCode || 200).setHeader('Content-Type', 'application/json').send(body);
              }
            } catch (e) {
              if (!res.headersSent) {
                res.status(response.statusCode || 200).setHeader('Content-Type', 'application/json').send(body);
              }
            }
          });
          return;
        }

        // Success - Stream the content
        if (!res.headersSent) {
          res.status(response.statusCode || 200);
          
          const headersToMirror = [
            'content-type', 'content-length', 'content-range', 
            'accept-ranges', 'content-disposition', 'cache-control', 'last-modified', 'etag'
          ];
          
          headersToMirror.forEach(h => {
            if (response.headers[h]) res.setHeader(h, response.headers[h]);
          });

          // Ensure PDF type
          if (!res.getHeader('content-type') && url.toLowerCase().includes('.pdf')) {
            res.setHeader('content-type', 'application/pdf');
          }

          response.pipe(res);

          response.on('error', (err) => {
            console.error("[Proxy PDF] In-stream error:", err.message);
            if (!res.writableEnded) res.end();
          });
        }
      });

      request.on('error', (err) => {
        console.error("[Proxy PDF] Protocol error:", err.message);
        if (!res.headersSent) res.status(502).send(`Proxy connection error: ${err.message}`);
      });

      request.on('timeout', () => {
        request.destroy();
        if (!res.headersSent) res.status(504).send("Gateway Timeout");
      });

    } catch (err: any) {
      console.error("[Proxy PDF] URL Parsing error:", err.message);
      if (!res.headersSent) res.status(400).send("Invalid Target URL");
    }
  };

  proxyRequest(targetUrl);
}
