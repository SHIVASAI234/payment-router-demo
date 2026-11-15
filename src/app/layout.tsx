import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Switchboard — Payment Routing Playground',
  description: 'One payment. The right route. Explore safe multi-provider payment routing with simulated payments, real persistence, and a transparent decision timeline.',
  robots: { index: false, follow: false },
};
export default function RootLayout({children}: Readonly<{children:React.ReactNode}>) {
  return <html lang="en"><body>{children}</body></html>;
}
