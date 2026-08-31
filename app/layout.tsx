import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'PhotoGit — Every edit, never lose the original',
  description:
    'A visual version-control workspace for photographers to save, compare, restore, and share every photo revision.',
  openGraph: {
    title: 'PhotoGit — Every edit, never lose the original',
    description:
      'A visual version-control workspace for photographers to save, compare, restore, and share every photo revision.',
    images: [{ url: '/og.png', width: 1730, height: 909, alt: 'PhotoGit' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PhotoGit — Every edit, never lose the original',
    description:
      'A visual version-control workspace for photographers to save, compare, restore, and share every photo revision.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
