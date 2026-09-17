const BULK_DOCUMENT_URL = 'https://docs.google.com/document/d/e/2PACX-1vTE-FPnxSnyqrvh9NlHgRJPQXtctGxt4DSJRFTudmBTTLKKDJ2XkiQGYxPkz_NWyQa6kJ64OcgP7pNM/pub?embedded=true';

export const metadata = {
  title: 'B2B Bulk Orders | Hold My Throttle',
  description: 'Hold My Throttle B2B bulk order information.'
};

export default function BulkPage() {
  return (
    <main style={{ height: '100dvh', width: '100%', background: '#fff' }}>
      <iframe
        src={BULK_DOCUMENT_URL}
        title="Hold My Throttle B2B bulk orders"
        style={{ border: 0, display: 'block', height: '100%', width: '100%' }}
      />
    </main>
  );
}
