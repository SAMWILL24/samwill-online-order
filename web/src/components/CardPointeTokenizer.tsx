import { useEffect, useRef, useState } from 'react';

interface Props {
  site: string;
  testMode: boolean;
  onToken: (token: string) => void;
}

// Embeds CardPointe's Hosted iFrame Tokenizer. The card number, expiry, and
// CVV are entered inside the iframe and never touch our own page or servers -
// CardSecure tokenizes them and posts the token back via window.postMessage.
// See https://developer.cardpointe.com/hosted-iframe-tokenizer.
export function CardPointeTokenizer({ site, testMode, onToken }: Props) {
  const [error, setError] = useState<string | null>(null);
  const lastTokenRef = useRef<string | null>(null);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      let data: { token?: string; message?: string; errorCode?: string; errorMessage?: string; validationError?: string };
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (data.validationError) {
        setError(data.validationError);
        return;
      }
      const token = data.token || data.message;
      if (token && token !== lastTokenRef.current) {
        lastTokenRef.current = token;
        setError(null);
        onToken(token);
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onToken]);

  const host = testMode ? `${site}-uat` : site;
  const params = new URLSearchParams({
    useexpiry: 'true',
    usecvv: 'true',
    formatinput: 'true',
    orientation: 'vertical',
    enhancedresponse: 'true',
    invalidcreditcardevent: 'true',
    invalidexpiryevent: 'true',
    invalidcvvevent: 'true',
    tokenizewheninactive: 'true',
    placeholder: 'Card number',
    placeholdermonth: 'MM',
    placeholderyear: 'YYYY',
    placeholdercvv: 'CVV',
  });
  const src = `https://${host}.cardconnect.com/itoke/ajax-tokenizer.html?${params.toString()}`;

  return (
    <div className="cardpointe-tokenizer">
      <iframe title="Card details" src={src} frameBorder="0" scrolling="no" style={{ width: '100%', height: 180, border: 'none' }} />
      {error && <p className="error">{error}</p>}
    </div>
  );
}
