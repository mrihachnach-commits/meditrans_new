export default function handler(req: any, res: any) {
  return res.status(200).json({
    ok: true,
    message: "API root working",
    time: new Date().toISOString()
  });
}
