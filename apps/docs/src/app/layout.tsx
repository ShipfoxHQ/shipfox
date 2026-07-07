import '@/app/global.css';
import {RootProvider} from 'fumadocs-ui/provider/next';
import {Inter} from 'next/font/google';
import type {ReactNode} from 'react';

const inter = Inter({
  subsets: ['latin'],
});

export default function Layout({children}: {children: ReactNode}) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <head>
        <link rel="alternate" type="text/markdown" href="/llms.txt" />
      </head>
      <body className="flex flex-col min-h-screen">
        <RootProvider theme={{enabled: false}}>{children}</RootProvider>
      </body>
    </html>
  );
}
