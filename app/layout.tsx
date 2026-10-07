
import "./globals.css";
export const metadata = { title: "資產成長實驗室", description: "FinMind 自動報價版" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="zh-Hant"><body>{children}</body></html>;
}
