import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Seabrook Texas Town Assistant',
  description: 'Ask me about the town, events, parks, and more',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}