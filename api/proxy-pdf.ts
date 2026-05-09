import axios from "axios";

export default async function handler(req: any, res: any) {
  const { url } = req.query;
  
  if (!url || typeof url !== 'string') {
    return res.status(400).send('Missing URL');
  }

  try {
    console.log(`[Proxy PDF] Request: ${url}`);
    
    const browserHeaders: any = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/pdf,application/json,application/octet-stream,*/*',
      'Referer': 'https://tinyvault.space/',
    };

    if (req.headers.range) {
      browserHeaders['range'] = req.headers.range;
    }

    const response = await axios({
      method: 'get',
      url: url,
      responseType: 'stream',
      headers: browserHeaders,
      timeout: 120000, 
      maxRedirects: 10,
      validateStatus: (status) => status < 400 || status === 206
    });

    const contentType = response.headers['content-type'] || 'application/pdf';
    
    if (contentType.includes('application/json')) {
      // Re-read JSON if it's metadata
      let chunks: any[] = [];
      for await (const chunk of response.data) {
        chunks.push(chunk);
      }
      const dataBuffer = Buffer.concat(chunks);
      const dataText = dataBuffer.toString();
      
      try {
        const jsonData = JSON.parse(dataText);
        const nextUrl = jsonData.download_url || jsonData.url;
        
        if (nextUrl && nextUrl !== url) {
          console.log(`[Proxy PDF] Internal Redirect: ${nextUrl}`);
          const secondRes = await axios({
            method: 'get',
            url: nextUrl,
            responseType: 'stream',
            headers: browserHeaders,
            timeout: 180000, 
            maxRedirects: 10,
            validateStatus: (status) => status < 400 || status === 206
          });
          
          res.status(secondRes.status);
          Object.keys(secondRes.headers).forEach(key => {
            if (['content-type', 'content-length', 'content-range', 'accept-ranges', 'content-disposition', 'cache-control'].includes(key.toLowerCase())) {
              res.setHeader(key, secondRes.headers[key]);
            }
          });
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
          res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
          
          return secondRes.data.pipe(res);
        }
      } catch (e) {
        console.warn("[Proxy PDF] JSON parse error, piping original metadata");
      }
      
      // If we're here, it means we consumed the stream but it wasn't a valid redirect or failed.
      // Return the buffered JSON metadata.
      res.status(response.status);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.send(dataBuffer);
    }

    // Direct pipe for PDF - the stream was NOT consumed yet
    res.status(response.status);
    Object.keys(response.headers).forEach(key => {
      if (['content-type', 'content-length', 'content-range', 'accept-ranges', 'content-disposition', 'cache-control'].includes(key.toLowerCase())) {
        res.setHeader(key, response.headers[key]);
      }
    });

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
    
    response.data.pipe(res);
    
    response.data.on('error', (err: any) => {
      console.error("[Proxy PDF] Stream error:", err.message);
    });

  } catch (error: any) {
    console.error(`[Proxy PDF] Fatal: ${error.message} (${url})`);
    if (!res.headersSent) {
      res.status(500).send(`Proxy Error: ${error.message}`);
    }
  }
}


