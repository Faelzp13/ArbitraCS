import { Inter } from 'next/font/google';
import './globals.css';
import ThemeProvider from './components/ThemeProvider';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import { Analytics } from "@vercel/analytics/next";

const inter = Inter({ subsets: ['latin'] });

export const metadata = {
  title: 'ArbitraCS',
  description: 'Acompanhe os melhores preços de skins de CS2',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body className={`${inter.className} antialiased bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-50 min-h-screen flex flex-col transition-colors`} suppressHydrationWarning>
        <ThemeProvider>
          <Navbar />
          <div className="flex-grow">
            {children}
          </div>
          <Footer />
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}