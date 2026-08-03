import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { formatCents } from '../lib/money';
import type { VoiceOrderResult } from '../types';

// Not in lib.dom.d.ts yet - the Web Speech API types are still non-standard.
interface SpeechRecognitionResultLike {
  0: { transcript: string };
}
interface SpeechRecognitionEventLike {
  results: { [index: number]: SpeechRecognitionResultLike; length: number };
}
interface SpeechRecognitionErrorLike {
  error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

// Browsers don't surface a human-readable message for speech recognition
// failures - just a short error code - so map the ones customers will
// actually hit to something they can act on.
const ERROR_MESSAGES: Record<string, string> = {
  'not-allowed': 'Microphone access is blocked for this site. Check your browser\'s site settings and allow the microphone, then try again.',
  'service-not-allowed': 'Microphone access is blocked for this site. Check your browser\'s site settings and allow the microphone, then try again.',
  'audio-capture': "No microphone was found on this device.",
  'no-speech': "Didn't catch that - please try again and speak right after tapping the button.",
  network: 'Connection issue while listening - check your internet and try again.',
};
function messageForSpeechError(code: string): string {
  return ERROR_MESSAGES[code] || 'Could not hear you clearly - please try again.';
}

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

type Stage = 'idle' | 'listening' | 'processing' | 'reviewing' | 'error';

const LANGUAGES = [
  { code: 'en-US', label: '🎤 Order by voice', listening: '🎤 Listening... say your order' },
  { code: 'ar-EG', label: '🎤 اطلب بصوتك', listening: '🎤 بسمعك... قول طلبك' },
  { code: 'es-US', label: '🎤 Ordenar por voz', listening: '🎤 Escuchando... di tu pedido' },
];

export function VoiceOrderButton() {
  const { api, addToCart } = useApp();
  const [supported, setSupported] = useState(true);
  const [stage, setStage] = useState<Stage>('idle');
  const [result, setResult] = useState<VoiceOrderResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<string>('en-US');
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    if (!getSpeechRecognition()) {
      setSupported(false);
      return;
    }
    api
      .getSettings()
      .then((s) => setSupported(s.voiceOrderingEnabled))
      .catch(() => setSupported(false));
  }, [api]);

  function startListening(lang: string) {
    const SpeechRecognitionCtor = getSpeechRecognition();
    if (!SpeechRecognitionCtor) return;
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = lang;
    recognition.interimResults = false;
    recognition.onresult = async (event) => {
      const transcript = event.results[event.results.length - 1][0].transcript;
      setStage('processing');
      try {
        const data = await api.voiceOrder(transcript);
        setResult(data);
        setStage('reviewing');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not process that order');
        setStage('error');
      }
    };
    recognition.onerror = (event) => {
      setError(messageForSpeechError(event.error));
      setStage('error');
    };
    recognition.onend = () => {
      setStage((s) => (s === 'listening' ? 'idle' : s));
    };
    recognitionRef.current = recognition;
    setLang(lang);
    setError(null);
    setStage('listening');
    recognition.start();
  }

  function cancel() {
    recognitionRef.current?.stop();
    setStage('idle');
    setResult(null);
    setError(null);
  }

  function confirmAdd() {
    if (!result) return;
    for (const line of result.items) {
      addToCart({
        menuItemId: line.menuItemId,
        menuItemName: line.menuItemName,
        sizeId: line.sizeId,
        sizeLabel: line.sizeLabel,
        quantity: line.quantity,
        extras: line.extras,
        notes: line.notes,
        unitPriceCents: line.unitPriceCents,
      });
    }
    setStage('idle');
    setResult(null);
  }

  if (!supported) return null;

  return (
    <>
      <div className="voice-order-lang-row">
        {LANGUAGES.map((l) => (
          <button
            key={l.code}
            className="btn voice-order-btn"
            type="button"
            onClick={() => startListening(l.code)}
            disabled={stage !== 'idle'}
          >
            {l.label}
          </button>
        ))}
      </div>

      {stage !== 'idle' && (
        <div className="voice-order-overlay">
          <div className="voice-order-panel">
            {stage === 'listening' && (
              <>
                <p className="voice-order-status">
                  {LANGUAGES.find((l) => l.code === lang)?.listening}
                </p>
                <button className="btn" type="button" onClick={cancel}>
                  Cancel
                </button>
              </>
            )}
            {stage === 'processing' && <p className="voice-order-status">Matching your order to the menu...</p>}
            {stage === 'error' && (
              <>
                <p className="error">{error}</p>
                <button className="btn" type="button" onClick={cancel}>
                  Close
                </button>
              </>
            )}
            {stage === 'reviewing' && result && (
              <>
                <h3>Here's what I heard</h3>
                {result.items.length === 0 && <p className="muted">Couldn't match anything on the menu.</p>}
                {result.items.map((line, i) => (
                  <div className="voice-order-line" key={i}>
                    <span>
                      {line.quantity}x {line.menuItemName} ({line.sizeLabel})
                      {line.extras.length > 0 && (
                        <span className="muted"> + {line.extras.map((e) => e.name).join(', ')}</span>
                      )}
                    </span>
                    <span>{formatCents(line.unitPriceCents * line.quantity)}</span>
                  </div>
                ))}
                {result.unmatched.length > 0 && (
                  <p className="muted">Couldn't find: {result.unmatched.join('; ')}</p>
                )}
                <div className="voice-order-actions">
                  <button className="btn" type="button" onClick={cancel}>
                    Cancel
                  </button>
                  <button
                    className="btn btn-primary"
                    type="button"
                    onClick={confirmAdd}
                    disabled={result.items.length === 0}
                  >
                    Add to cart
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
