import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'TestImpact Playground · Workfonic Labs',
  description: 'Change code. Know what to test. Explore TestImpact analysis results locally.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">{children}</body>
    </html>
  );
}
