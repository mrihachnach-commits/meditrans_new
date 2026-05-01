export default function handler(req: any, res: any) {
  res.status(200).json({ 
    status: "alive", 
    time: new Date().toISOString(),
    env: process.env.NODE_ENV,
    vercel: process.env.VERCEL || "0"
  });
}
