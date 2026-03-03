/**
 * TinyBERT Verdict Classifier — Browser-side ONNX Inference
 * 
 * Runs the trained TinyBERT model via ONNX Runtime Web to classify
 * LLM reasoning text as PHISHING or SAFE with a severity score.
 * 
 * Usage:
 *   import { VerdictClassifier } from './verdict-classifier';
 *   const classifier = new VerdictClassifier();
 *   await classifier.load();
 *   const result = classifier.classify("The site mimics a bank login...");
 *   // → { verdict: 'PHISHING', severity: 4, confidence: 0.92 }
 */

// WordPiece tokenizer (minimal browser implementation)
class WordPieceTokenizer {
    constructor(vocab, config) {
        this.vocab = vocab;        // token → id mapping
        this.idToToken = {};       // id → token mapping
        this.clsId = config.cls_token_id;
        this.sepId = config.sep_token_id;
        this.padId = config.pad_token_id;
        this.unkId = config.unk_token_id;

        // Build reverse mapping
        for (const [token, id] of Object.entries(vocab)) {
            this.idToToken[id] = token;
        }
    }

    /**
     * Tokenize text into WordPiece token IDs.
     * Simplified BERT tokenization: lowercase, basic punctuation splitting, WordPiece.
     */
    tokenize(text, maxLength = 256) {
        // Basic pre-tokenization: lowercase, split on whitespace and punctuation
        const cleaned = text.toLowerCase().replace(/[^\w\s'-]/g, ' $& ');
        const words = cleaned.split(/\s+/).filter(w => w.length > 0);

        const tokenIds = [this.clsId]; // Start with [CLS]

        for (const word of words) {
            if (tokenIds.length >= maxLength - 1) break; // Leave room for [SEP]

            // WordPiece: try full word first, then progressively smaller subwords
            const subTokens = this._wordPiece(word);
            for (const subId of subTokens) {
                if (tokenIds.length >= maxLength - 1) break;
                tokenIds.push(subId);
            }
        }

        tokenIds.push(this.sepId); // End with [SEP]

        // Pad to maxLength
        const attentionMask = new Array(maxLength).fill(0);
        const tokenTypeIds = new Array(maxLength).fill(0);

        for (let i = 0; i < tokenIds.length; i++) {
            attentionMask[i] = 1;
        }

        while (tokenIds.length < maxLength) {
            tokenIds.push(this.padId);
        }

        return {
            input_ids: tokenIds,
            attention_mask: attentionMask,
            token_type_ids: tokenTypeIds,
        };
    }

    _wordPiece(word) {
        // Try the full word
        if (this.vocab[word] !== undefined) {
            return [this.vocab[word]];
        }

        const tokens = [];
        let start = 0;

        while (start < word.length) {
            let end = word.length;
            let found = false;

            while (start < end) {
                const substr = start > 0 ? '##' + word.slice(start, end) : word.slice(start, end);
                if (this.vocab[substr] !== undefined) {
                    tokens.push(this.vocab[substr]);
                    found = true;
                    break;
                }
                end--;
            }

            if (!found) {
                tokens.push(this.unkId);
                start++;
            } else {
                start = end;
            }
        }

        return tokens;
    }
}


export class VerdictClassifier {
    constructor() {
        this.session = null;
        this.tokenizer = null;
        this.maxLength = 256;
        this.loaded = false;
        this._loadPromise = null;
    }

    /**
     * Load the ONNX model and vocabulary.
     * Call this once during extension startup.
     */
    async load(modelPath = 'models/verdict-classifier/') {
        if (this._loadPromise) return this._loadPromise;

        this._loadPromise = this._doLoad(modelPath);
        return this._loadPromise;
    }

    async _doLoad(modelPath) {
        try {
            // Load ONNX Runtime Web
            const ort = await import('onnxruntime-web');

            // Configure for extension environment
            ort.env.wasm.wasmPaths = modelPath;

            // Load vocabulary
            const vocabResponse = await fetch(chrome.runtime.getURL(modelPath + 'vocab.json'));
            const vocab = await vocabResponse.json();

            const configResponse = await fetch(chrome.runtime.getURL(modelPath + 'tokenizer_config.json'));
            const config = await configResponse.json();

            this.tokenizer = new WordPieceTokenizer(vocab, config);

            // Load ONNX model
            const modelUrl = chrome.runtime.getURL(modelPath + 'verdict_classifier.onnx');
            this.session = await ort.InferenceSession.create(modelUrl, {
                executionProviders: ['wasm'],
                graphOptimizationLevel: 'all',
            });

            this.loaded = true;
            console.log('[VerdictClassifier] Model loaded successfully');
            return true;
        } catch (error) {
            console.error('[VerdictClassifier] Failed to load model:', error);
            this.loaded = false;
            this._loadPromise = null;
            return false;
        }
    }

    /**
     * Classify reasoning text into verdict + severity.
     * @param {string} reasoningText - The LLM's reasoning output from Step 1
     * @returns {{ verdict: 'PHISHING'|'SAFE', severity: number, confidence: number }}
     */
    async classify(reasoningText) {
        if (!this.loaded || !this.session) {
            throw new Error('VerdictClassifier not loaded. Call load() first.');
        }

        const ort = await import('onnxruntime-web');

        // Tokenize
        const encoded = this.tokenizer.tokenize(reasoningText, this.maxLength);

        // Create tensors
        const inputIds = new ort.Tensor('int64',
            BigInt64Array.from(encoded.input_ids.map(BigInt)),
            [1, this.maxLength]
        );
        const attentionMask = new ort.Tensor('int64',
            BigInt64Array.from(encoded.attention_mask.map(BigInt)),
            [1, this.maxLength]
        );
        const tokenTypeIds = new ort.Tensor('int64',
            BigInt64Array.from(encoded.token_type_ids.map(BigInt)),
            [1, this.maxLength]
        );

        // Run inference
        const startTime = performance.now();
        const results = await this.session.run({
            input_ids: inputIds,
            attention_mask: attentionMask,
            token_type_ids: tokenTypeIds,
        });
        const inferenceTime = performance.now() - startTime;

        // Parse outputs
        const verdictLogits = results.verdict_logits.data; // [safe_score, phishing_score]
        const severityRaw = results.severity.data[0];

        // Softmax for confidence
        const maxLogit = Math.max(verdictLogits[0], verdictLogits[1]);
        const expSafe = Math.exp(verdictLogits[0] - maxLogit);
        const expPhish = Math.exp(verdictLogits[1] - maxLogit);
        const sumExp = expSafe + expPhish;
        const phishProb = expPhish / sumExp;

        const verdict = phishProb > 0.5 ? 'PHISHING' : 'SAFE';
        const confidence = verdict === 'PHISHING' ? phishProb : (1 - phishProb);
        const severity = Math.max(1, Math.min(5, Math.round(severityRaw)));

        console.log(`[VerdictClassifier] ${verdict} (${(confidence * 100).toFixed(1)}%) severity=${severity} in ${inferenceTime.toFixed(1)}ms`);

        return {
            verdict,
            severity,
            confidence,
            inferenceTimeMs: inferenceTime,
        };
    }

    /**
     * Check if the classifier is ready for use.
     */
    isReady() {
        return this.loaded && this.session !== null;
    }
}
