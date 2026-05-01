import { createApp } from "./_app";

let cachedApp: any;

export default async (req: any, res: any) => {
  if (!cachedApp) {
    cachedApp = await createApp();
  }
  return cachedApp(req, res);
};
