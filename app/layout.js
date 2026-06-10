import './globals.css';

export const metadata = {
  title: 'Watch Party — Watch Together',
  description: 'Synchronized video watching with friends. Create a room, share the link, and enjoy movies together in perfect harmony.',
  keywords: ['watch party', 'watch together', 'sync video', 'movie night'],
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="theme-color" content="#0a0a0f" />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🎬</text></svg>" />
      </head>
      <body>{children}</body>
    </html>
  );
}
