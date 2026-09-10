// ── Parser específico Walmart / Bodega Aurrera ──────────────────────────────
// Extrae TR# (transacción), TC# (ticket/folio), fecha+hora y total a partir
// del texto crudo de OCR, usando etiquetas y contexto — no posiciones fijas.
//
// Formato objetivo (ticket real de prueba, Bodega Aurrera):
//   TR#09283
//   TC#189707147732727277683
//   08/09/26 19:01
//   TOTAL $873.22
(function () {
    'use strict';

    // Normaliza variaciones de OCR: "TR #09283", "TR# 09283", "TR 09283" → "TR#09283"
    function normalize(textoRaw) {
        return textoRaw
            .toUpperCase()
            .replace(/\bTR\s*#\s*(?=\d)/g, 'TR#')
            .replace(/\bTR\s+(?=\d)/g, 'TR#')
            .replace(/\bTC\s*#\s*(?=\d)/g, 'TC#')
            .replace(/\bTC\s+(?=\d)/g, 'TC#');
    }

    // Conserva ceros a la izquierda: se captura como string, nunca se castea a número.
    function extractTransaction(texto) {
        const m = texto.match(/\bTR#(\d{3,8})\b/);
        return m ? m[1] : null;
    }

    // Número largo y variable — no se asume una longitud exacta.
    function extractTicket(texto) {
        const m = texto.match(/\bTC#(\d{8,25})\b/);
        return m ? m[1] : null;
    }

    // DD/MM/YY o DD/MM/YYYY, opcionalmente seguido de hora HH:MM.
    function extractDateTime(texto) {
        const m = texto.match(/\b(\d{2})\/(\d{2})\/(\d{2}|\d{4})\b(?:\D{0,3}(\d{1,2}):(\d{2}))?/);
        if (!m) return { date: null, time: null };

        const [, dd, mm, yy, hh, min] = m;
        const year = yy.length === 2 ? '20' + yy : yy;
        const iso = `${year}-${mm}-${dd}`;
        if (isNaN(new Date(iso).getTime())) return { date: null, time: null };

        const time = hh !== undefined ? `${hh.padStart(2, '0')}:${min}` : null;
        return { date: iso, time };
    }

    // Busca el importe en la(s) línea(s) con la etiqueta TOTAL, nunca SUBTOTAL,
    // y nunca "el importe más grande del ticket".
    function extractTotal(texto) {
        const lineas = texto.split('\n').map(l => l.trim()).filter(Boolean);
        for (let i = 0; i < lineas.length; i++) {
            const upper = lineas[i].toUpperCase();
            if (upper.includes('TOTAL') && !upper.includes('SUBTOTAL')) {
                let m = lineas[i].match(/(\d{1,6}[.,]\d{2})/);
                if (!m && lineas[i + 1]) m = lineas[i + 1].match(/(\d{1,6}[.,]\d{2})/);
                if (m) return m[1].replace(',', '.');
            }
        }
        return null;
    }

    function parseTicket(textoRaw) {
        const texto = normalize(textoRaw);

        const transaction = extractTransaction(texto);
        const ticket = extractTicket(texto);
        const { date: purchaseDate, time: purchaseTime } = extractDateTime(texto);
        const total = extractTotal(texto);

        return {
            ticket,
            transaction,
            purchaseDate,
            purchaseTime,
            total,
            source: 'ocr',
            confidence: {
                ticket:       ticket ? 'high' : 'missing',
                transaction:  transaction ? 'high' : 'missing',
                purchaseDate: purchaseDate ? 'high' : 'missing',
                total:        total ? 'high' : 'missing',
            },
        };
    }

    // Vuelve a validar los datos ya sea que vengan de OCR o de edición manual.
    // Nunca inventa valores: solo confirma si lo que hay es válido.
    function validate(d) {
        const errors = {};
        const soloDigitos = s => /^\d+$/.test(s || '');

        if (!soloDigitos(d.ticket) || d.ticket.length < 8 || d.ticket.length > 25) {
            errors.ticket = 'Ticket/Folio (TC#) obligatorio: solo dígitos, longitud razonable';
        }
        if (!soloDigitos(d.transaction) || d.transaction.length < 3 || d.transaction.length > 8) {
            errors.transaction = 'Transacción (TR#) obligatoria: solo dígitos';
        }
        if (!d.purchaseDate || isNaN(new Date(d.purchaseDate).getTime())) {
            errors.purchaseDate = 'Fecha de compra inválida';
        }
        const totalNum = parseFloat(d.total);
        if (d.total == null || d.total === '' || isNaN(totalNum) || totalNum <= 0) {
            errors.total = 'Total inválido';
        }

        return { valid: Object.keys(errors).length === 0, errors };
    }

    window.WalmartParser = { normalize, parseTicket, validate };
})();
