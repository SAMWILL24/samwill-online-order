import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { formatCents } from '../lib/money';
import type { VoiceOrderLine, VoiceOrderResult } from '../types';

// Not in lib.dom.d.ts yet - the Web Speech API types are still non-standard.
interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  0: SpeechRecognitionAlternativeLike;
  isFinal: boolean;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { [index: number]: SpeechRecognitionResultLike; length: number };
}
interface SpeechRecognitionErrorLike {
  error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
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
  'audio-capture': 'No microphone was found on this device.',
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

const DONE_LABEL: Record<string, string> = { 'en-US': "Done - that's my order", 'ar-EG': 'خلصت - ده طلبي', 'es-US': 'Listo - ese es mi pedido' };
const CANCEL_LABEL: Record<string, string> = { 'en-US': 'Cancel', 'ar-EG': 'إلغاء', 'es-US': 'Cancelar' };

export function VoiceOrderButton() {
  const { api, addToCart } = useApp();
  const [supported, setSupported] = useState(true);
  const [stage, setStage] = useState<Stage>('idle');
  const [result, setResult] = useState<VoiceOrderResult | null>(null);
  const [reviewItems, setReviewItems] = useState<VoiceOrderLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<string>('en-US');
  const [liveText, setLiveText] = useState('');
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalTranscriptRef = useRef('');
  const cancelledRef = useRef(false);

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

  async function processTranscript(transcript: string) {
    setStage('processing');
    try {
      const data = await api.voiceOrder(transcript);
      setResult(data);
      setReviewItems(data.items);
      setStage('reviewing');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not process that order');
      setStage('error');
    }
  }

  function startListening(selectedLang: string) {
    const SpeechRecognitionCtor = getSpeechRecognition();
    if (!SpeechRecognitionCtor) return;
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = selectedLang;
    // Continuous + interim so the customer can order several items in one
    // go (pausing between them) instead of the mic cutting off after the
    // first sentence - they tap "Done" themselves when finished.
    recognition.continuous = true;
    recognition.interimResults = true;
    finalTranscriptRef.current = '';
    cancelledRef.current = false;
    setLiveText('');

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        if (res.isFinal) {
          finalTranscriptRef.current += `${res[0].transcript} `;
        } else {
          interim += res[0].transcript;
        }
      }
      setLiveText((finalTranscriptRef.current + interim).trim());
    };
    recognition.onerror = (event) => {
      setError(messageForSpeechError(event.error));
      setStage('error');
    };
    recognition.onend = () => {
      if (cancelledRef.current) return;
      const transcript = finalTranscriptRef.current.trim();
      if (transcript) {
        processTranscript(transcript);
      } else {
        setStage('idle');
      }
    };
    recognitionRef.current = recognition;
    setLang(selectedLang);
    setError(null);
    setStage('listening');
    recognition.start();
  }

  function finishListening() {
    recognitionRef.current?.stop();
  }

  function cancel() {
    cancelledRef.current = true;
    recognitionRef.current?.stop();
    setStage('idle');
    setResult(null);
    setReviewItems([]);
    setError(null);
  }

  function removeReviewItem(index: number) {
    setReviewItems((items) => items.filter((_, i) => i !== index));
  }

  function adjustReviewQuantity(index: number, delta: number) {
    setReviewItems((items) =>
      items
        .map((line, i) => (i === index ? { ...line, quantity: line.quantity + delta } : line))
        .filter((line) => line.quantity > 0)
    );
  }

  function confirmAdd() {
    for (const line of reviewItems) {
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
    setReviewItems([]);
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
                <p className="voice-order-status">{LANGUAGES.find((l) => l.code === lang)?.listening}</p>
                {liveText && <p className="voice-order-live-text">{liveText}</p>}
                <div className="voice-order-actions">
                  <button className="btn" type="button" onClick={cancel}>
                    {CANCEL_LABEL[lang]}
                  </button>
                  <button className="btn btn-primary" type="button" onClick={finishListening}>
                    {DONE_LABEL[lang]}
                  </button>
                </div>
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
                <p className="muted">Wrong item or quantity? Fix it below before adding.</p>
                {reviewItems.length === 0 && <p className="muted">Couldn't match anything on the menu.</p>}
                {reviewItems.map((line, i) => (
                  <div className="voice-order-line" key={i}>
                    <span>
                      {line.menuItemName} ({line.sizeLabel})
                      {line.extras.length > 0 && (
                        <span className="muted"> + {line.extras.map((e) => e.name).join(', ')}</span>
                      )}
                    </span>
                    <div className="voice-order-line-controls">
                      <button type="button" className="voice-order-qty-btn" onClick={() => adjustReviewQuantity(i, -1)}>
                        −
                      </button>
                      <span>{line.quantity}</span>
                      <button type="button" className="voice-order-qty-btn" onClick={() => adjustReviewQuantity(i, 1)}>
                        +
                      </button>
                      <span className="voice-order-line-price">{formatCents(line.unitPriceCents * line.quantity)}</span>
                      <button type="button" className="voice-order-remove-btn" onClick={() => removeReviewItem(i)} aria-label="Remove">
                        ✕
                      </button>
                    </div>
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
                    disabled={reviewItems.length === 0}
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
