// Fast drop-in for csv-reader 1.0.0 (make.fun): run(input) returns exactly
// {columns, rows, errors} as the reference, but scanned with indexOf/slice
// instead of one character at a time with per-character string building.
//
// How it stays exact (the reference is vendor/csv-reader/index.js; this is
// the same reading, only the mechanics differ):
//   - U+FEFF at the very start is dropped; records end at LF or CRLF;
//     a line left with no characters is no record.
//   - Outside quotes a CR not followed by LF is dropped (stray_cr).
//   - A field opening with a quote runs to the next quote that is not
//     doubled; "" inside is one quote; CRLF/lone CR inside read as LF;
//     text after the closing quote up to the next comma or line break is
//     appended as-is (quote_junk when the field ends); a quote that never
//     closes is a literal character and the text after it is re-read as
//     unquoted (unterminated_quote); a quote inside an unquoted field is
//     literal. Fields stay strings, never trimmed or converted.
//   - columns is the first record when header is true, else null; rows are
//     padded with "" (short_row, with fields: its field count) or cut
//     (long_row, with extra: the cut fields) to the first record's width.
//   - Errors are {code, line, row} in the order met; a record's short_row
//     or long_row when it ends. line is the 1-based line its record starts
//     on, counting every LF, CRLF and lone CR inside quotes; row is its
//     record's index in rows, null for the header.
//
// Speed: one left-to-right pass. Records with no quote and no stray CR in
// the line are split whole (one indexOf per comma); quoted and broken
// fields fall back to slice-based reads. The next-CR and next-quote
// positions are cached and only ever searched forward, so the searches
// cost O(text) in total. No regex, no split on the whole text, no
// per-character concatenation in the hot paths.

/** How a field ended: at a comma (0), at a line break (1) or at the end of the text (2). */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (n > 0 && text.charCodeAt(0) === 0xFEFF) pos = 1;

  // Next CR / next quote at or after pos (-1: none in the rest of the text).
  // Only ever searched forward, so every character is scanned at most once.
  let nextCR = text.indexOf('\r', pos);
  let nextQ = text.indexOf('"', pos);

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // Next '\n' at or after the current record's start (-1: none to the end of
  // the text). Valid while it is at or after pos; a quoted field that spans
  // lines moves pos past it, and the next use re-searches from pos.
  let recNL = -1;

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    if (nextCR !== -1 && nextCR < pos) nextCR = text.indexOf('\r', pos);
    if (nextQ !== -1 && nextQ < pos) nextQ = text.indexOf('"', pos);

    const nl = text.indexOf('\n', pos);
    const lineEnd = nl === -1 ? n : nl;
    recNL = nl;

    let fields;
    let quoted = false;

    if (
      (nextQ === -1 || nextQ >= lineEnd) &&
      (nextCR === -1 || nextCR >= lineEnd || (nl !== -1 && nextCR === lineEnd - 1))
    ) {
      // Whole record is plain: no quote in this line, and no stray CR in it
      // (the only CR allowed is the CRLF one at the line's end).
      let contentEnd = lineEnd;
      if (nl !== -1 && contentEnd > pos && text.charCodeAt(contentEnd - 1) === 13) contentEnd -= 1;
      fields = [];
      let fpos = pos;
      for (;;) {
        const comma = text.indexOf(',', fpos);
        if (comma !== -1 && comma < contentEnd) {
          fields.push(text.slice(fpos, comma));
          fpos = comma + 1;
        } else {
          fields.push(text.slice(fpos, contentEnd));
          break;
        }
      }
      pos = lineEnd + (nl !== -1 ? 1 : 0);
      if (nl !== -1) line += 1;
    } else {
      // This record holds a quote or a stray CR: read it field by field.
      fields = [];
      for (;;) {
        // If the rest of this record holds no quote and no stray CR, split it whole.
        if (nextQ !== -1 && nextQ < pos) nextQ = text.indexOf('"', pos);
        if (nextCR !== -1 && nextCR < pos) nextCR = text.indexOf('\r', pos);
        if (recNL !== -1 && recNL < pos) recNL = text.indexOf('\n', pos);
        let bulkEnd = recNL === -1 ? n : recNL;
        if (recNL !== -1 && bulkEnd > pos && text.charCodeAt(bulkEnd - 1) === 13) bulkEnd -= 1;
        if (
          (nextQ === -1 || (recNL !== -1 && nextQ >= recNL)) &&
          (nextCR === -1 || nextCR >= bulkEnd)
        ) {
          let fpos = pos;
          for (;;) {
            const comma = text.indexOf(',', fpos);
            if (comma !== -1 && comma < bulkEnd) {
              fields.push(text.slice(fpos, comma));
              fpos = comma + 1;
            } else {
              fields.push(text.slice(fpos, bulkEnd));
              break;
            }
          }
          quoted = false;
          pos = recNL === -1 ? n : recNL + 1;
          if (recNL !== -1) line += 1;
          break;
        }

        let value = '';
        let ended;
        if (text.charCodeAt(pos) === 34) {
          quoted = true;
          const open = pos;
          const openLine = line;
          // The closing quote: the first quote not followed by another quote.
          let q = text.indexOf('"', pos + 1);
          let doubled = false;
          while (q !== -1 && text.charCodeAt(q + 1) === 34) {
            doubled = true;
            q = text.indexOf('"', q + 2);
          }
          if (q === -1) {
            // The quote never closes: it is a literal character, and the text
            // after it is read again as unquoted.
            pos = open + 1;
            line = openLine;
            errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
            value = '"';
            // Fall through to the unquoted read below.
          } else {
            // The quoted content is [pos + 1, q).
            if (nextCR !== -1 && nextCR < pos + 1) nextCR = text.indexOf('\r', pos + 1);
            if (recNL !== -1 && recNL < pos + 1) recNL = text.indexOf('\n', pos + 1);
            const nlIn = recNL;
            if ((nextCR === -1 || nextCR >= q) && (nlIn === -1 || nlIn >= q)) {
              // No line break inside: one slice (doubled quotes unescaped).
              value = doubled ? text.slice(pos + 1, q).replaceAll('""', '"') : text.slice(pos + 1, q);
            } else {
              // Line breaks inside: scan them, each CRLF or lone CR one LF.
              let v = '';
              let i = pos + 1;
              let seg = pos + 1;
              while (i < q) {
                const cc = text.charCodeAt(i);
                if (cc === 34) {
                  v += text.slice(seg, i);
                  v += '"';
                  i += 2;
                  seg = i;
                } else if (cc === 13) {
                  v += text.slice(seg, i);
                  v += '\n';
                  line += 1;
                  i += text.charCodeAt(i + 1) === 10 ? 2 : 1;
                  seg = i;
                } else if (cc === 10) {
                  v += text.slice(seg, i);
                  v += '\n';
                  line += 1;
                  i += 1;
                  seg = i;
                } else {
                  i += 1;
                }
              }
              v += text.slice(seg, q);
              value = v;
            }
            pos = q + 1;
            if (pos >= n) {
              fields.push(value);
              break;
            }
            const c = text.charCodeAt(pos);
            if (c === 44) {
              pos += 1;
              fields.push(value);
              continue;
            }
            if (c === 10) {
              pos += 1;
              line += 1;
              fields.push(value);
              break;
            }
            if (c === 13 && text.charCodeAt(pos + 1) === 10) {
              pos += 2;
              line += 1;
              fields.push(value);
              break;
            }
            // What follows the closing quote is appended as it stands:
            // fall through to the unquoted read below, then quote_junk.
            const beforeLen = value.length;
{
              const comma = text.indexOf(',', pos);
              if (recNL !== -1 && recNL < pos) recNL = text.indexOf('\n', pos);
              const nl2 = recNL;
              let end;
              if (comma !== -1 && (nl2 === -1 || comma < nl2)) { end = comma; ended = COMMA; }
              else if (nl2 !== -1) { end = nl2; ended = LINE_BREAK; }
              else { end = n; ended = END; }
              let contentEnd = end;
              if (ended === LINE_BREAK && end > pos && text.charCodeAt(end - 1) === 13) contentEnd = end - 1;
              if (nextCR !== -1 && nextCR < pos) nextCR = text.indexOf('\r', pos);
              if (nextCR !== -1 && nextCR < contentEnd) {
                let seg = pos;
                let p = nextCR;
                while (p !== -1 && p < contentEnd) {
                  value += text.slice(seg, p);
                  errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
                  seg = p + 1;
                  p = text.indexOf('\r', p + 1);
                }
                value += text.slice(seg, contentEnd);
                nextCR = p;
              } else {
                value += text.slice(pos, contentEnd);
              }
              pos = end + (ended === END ? 0 : 1);
              if (ended === LINE_BREAK) line += 1;
            }
            if (value.length > beforeLen) {
              errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
            }
            fields.push(value);
            if (ended !== COMMA) break;
            continue;
          }
        } else {
          quoted = false;
        }

        // Unquoted read from pos, appending onto `value`.
{
        const comma = text.indexOf(',', pos);
        if (recNL !== -1 && recNL < pos) recNL = text.indexOf('\n', pos);
        const nl2 = recNL;
        let end;
        if (comma !== -1 && (nl2 === -1 || comma < nl2)) { end = comma; ended = COMMA; }
        else if (nl2 !== -1) { end = nl2; ended = LINE_BREAK; }
        else { end = n; ended = END; }
        let contentEnd = end;
        if (ended === LINE_BREAK && end > pos && text.charCodeAt(end - 1) === 13) contentEnd = end - 1;
        if (nextCR !== -1 && nextCR < pos) nextCR = text.indexOf('\r', pos);
        if (nextCR !== -1 && nextCR < contentEnd) {
          let seg = pos;
          let p = nextCR;
          while (p !== -1 && p < contentEnd) {
            value += text.slice(seg, p);
            errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
            seg = p + 1;
            p = text.indexOf('\r', p + 1);
          }
          value += text.slice(seg, contentEnd);
          nextCR = p;
        } else {
          value += text.slice(pos, contentEnd);
        }
        pos = end + (ended === END ? 0 : 1);
        if (ended === LINE_BREAK) line += 1;
        }
        fields.push(value);
        if (ended !== COMMA) break;
      }
    }

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
