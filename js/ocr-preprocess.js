// ── Preprocesamiento de imagen antes de OCR (común a todos los establecimientos) ──
// Escala la imagen si es pequeña, la convierte a escala de grises y la binariza
// con el método de Otsu (umbral automático según el histograma de cada foto).
// Esto ayuda especialmente en tickets térmicos de bajo contraste.
(function () {
    'use strict';

    function loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload  = () => resolve(img);
            img.onerror = reject;
            img.src = src;
        });
    }

    // Umbral automático de Otsu a partir del histograma de grises (0-255).
    function otsuThreshold(hist, total) {
        let sum = 0;
        for (let i = 0; i < 256; i++) sum += i * hist[i];

        let sumB = 0, wB = 0, maxVar = 0, threshold = 0;
        for (let t = 0; t < 256; t++) {
            wB += hist[t];
            if (wB === 0) continue;
            const wF = total - wB;
            if (wF === 0) break;
            sumB += t * hist[t];
            const mB = sumB / wB;
            const mF = (sum - sumB) / wF;
            const varBetween = wB * wF * (mB - mF) * (mB - mF);
            if (varBetween > maxVar) { maxVar = varBetween; threshold = t; }
        }
        return threshold;
    }

    /**
     * Prepara una imagen (dataURL) para OCR: escala, escala de grises y binarización.
     * Devuelve un <canvas> listo para pasarle a Tesseract.recognize().
     */
    async function prepare(dataUrl, opts) {
        opts = opts || {};
        const targetWidth = opts.targetWidth || 1600;

        const img = await loadImage(dataUrl);
        const scale = img.width < targetWidth ? targetWidth / img.width : 1;
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);

        const imageData = ctx.getImageData(0, 0, w, h);
        const data = imageData.data;
        const pixelCount = w * h;
        const hist = new Array(256).fill(0);
        const gray = new Uint8ClampedArray(pixelCount);

        for (let i = 0, p = 0; i < data.length; i += 4, p++) {
            const g = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) | 0;
            gray[p] = g;
            hist[g]++;
        }

        const threshold = otsuThreshold(hist, pixelCount);

        for (let i = 0, p = 0; i < data.length; i += 4, p++) {
            const v = gray[p] >= threshold ? 255 : 0;
            data[i] = data[i + 1] = data[i + 2] = v;
        }
        ctx.putImageData(imageData, 0, 0);

        return canvas;
    }

    window.OCRPreprocess = { prepare };
})();
