import axios from "axios";
import https from "https";

const httpsAgent = new https.Agent({ keepAlive: true, timeout: 30000 });

export default async function handler(req: any, res: any) {
  const { token } = req.query;
  
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Missing token' });
  }

  try {
    let url = token;
    
    // If it's just a token, construct the TinyVault API URL
    if (!token.startsWith('http')) {
      url = `https://tinyvault.space/api/download/${token}`;
    } else {
      // If it's a view URL, try to convert it to a download URL
      if (url.includes('tinyvault.space') && !url.includes('/api/')) {
        url = url.replace('tinyvault.space/', 'tinyvault.space/api/download/');
      }
    }

    console.log("[Resolve TinyVault] Fetching:", url);
    
    const fetchWithUrl = async (targetUrl: string) => {
      return await axios({
        method: 'get',
        url: targetUrl,
        responseType: 'stream',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          'Accept': 'application/json,application/pdf,*/*',
          'Referer': 'https://tinyvault.space/',
          'Connection': 'keep-alive'
        },
        timeout: 45000,
        httpsAgent,
        validateStatus: (status) => status < 500
      });
    };

    let response = await fetchWithUrl(url);

    // Fallback logic for 404
    if (response.status === 404 && !token.startsWith('http')) {
      console.log("[Resolve TinyVault] 404 on default API, trying alternative...");
      // Try without /api/download/ if it was a direct ID
      const altUrl = `https://tinyvault.space/${token}`;
      const altResponse = await fetchWithUrl(altUrl);
      if (altResponse.status < 400) {
        response = altResponse;
        url = altUrl;
      }
    }

    if (response.status >= 400) {
      throw new Error(`Upstream returned ${response.status} for ${url}`);
    }

    const contentType = response.headers['content-type'] || '';
    console.log(`[Resolve TinyVault] Status: ${response.status}, Content-Type: ${contentType}`);
    
    // If it's HTML, it's likely a login or error page from TinyVault
    if (contentType.includes('text/html')) {
      // If we got HTML but expected a file/json, it might be a redirect or error
      if (token.startsWith('http') && !token.includes('/api/')) {
        // Try the API version anyway if we haven't already
        console.log("[Resolve TinyVault] Received HTML, trying API alternative...");
        const apiAltUrl = token.replace('tinyvault.space/', 'tinyvault.space/api/download/');
        if (apiAltUrl !== url) {
           const apiResponse = await fetchWithUrl(apiAltUrl);
           if (apiResponse.status < 400 && !apiResponse.headers['content-type']?.includes('text/html')) {
             response = apiResponse;
             url = apiAltUrl;
           } else {
             throw new Error("Received HTML content. The link might require login or is not a direct file link.");
           }
        } else {
          throw new Error("Received HTML content. The link might require login or is not a direct file link.");
        }
      } else {
        throw new Error("Received HTML content instead of metadata.");
      }
    }
    if (contentType.includes('application/json')) {
      let chunks: any[] = [];
      for await (const chunk of response.data) {
        chunks.push(chunk);
      }
      const jsonData = JSON.parse(Buffer.concat(chunks).toString());
      return res.status(200).json(jsonData);
    }

    // Nếu phản hồi là file nhị phân trực tiếp (PDF/Octet)
    // Chúng ta không cần tải hết file, chỉ cần báo về metadata từ headers
    // Nhớ đóng stream để tránh rò rỉ bộ nhớ
    response.data.destroy();
    return res.status(200).json({
      name: `Tài liệu_${token.substring(0, 6)}.pdf`,
      size: parseInt(response.headers['content-length'] || '0'),
      type: contentType || 'application/pdf',
      download_url: url
    });
  } catch (error: any) {
    const status = error.response?.status || 500;
    console.error(`[Resolve TinyVault] Error ${status}:`, error.message);
    return res.status(status).json({ 
      error: 'Failed to resolve token',
      message: error.message 
    });
  }
}
