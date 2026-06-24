import './globals.css';

export const metadata = {
  title: 'Hold My Throttle Ops CRM',
  description: 'Internal operations CRM for Hold My Throttle fulfillment, installation, feedback, and support.'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
