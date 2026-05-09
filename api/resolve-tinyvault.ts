import axios from "axios";

export default async function handler(req: any, res: any) {
  const { token } = req.query;
  
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Missing token' });
  }

  try {
    const url = `https://tinyvault.space/api/download/${token}`;
    console.log("[Resolve TinyVault] Fetching:", url);
    
    const response = await axios({
      method: 'get',
      url: url,
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json,application/pdf,*/*',
        'Referer': 'https://tinyvault.space/'
      },
      timeout: 15000 
    });

    const contentType = response.headers['content-type'] || '';
    
    // Nếu phản hồi là JSON (Metadata từ TinyVault)
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
